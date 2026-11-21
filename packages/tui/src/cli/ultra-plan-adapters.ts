/**
 * Runtime adapters for Ultra planning.
 *
 * The plan phase in `@alran/ultra` is pure orchestration over ports. This file is
 * the other half: it reads the repository's real project files, builds the
 * prompts, calls a headless `alran exec` for each role, and parses the replies
 * back into the shapes the core validates.
 *
 * Two properties matter here:
 *
 *   - **Structured output.** The planner answers against a JSON schema, so a
 *     malformed reply is rejected loudly instead of being guessed at. A plan that
 *     cannot be parsed cannot be validated, and a plan that cannot be validated
 *     cannot be executed.
 *   - **Honest boundaries.** The scope check is a routing decision and the
 *     explorers are read-only. If a model call fails, the port throws and the CLI
 *     reports it rather than inventing a plan.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as ultra from '@alran/ultra';
import type { UltraGateSources } from '@alran/ultra';
import { normalizeLLMError, toLLMRetryDecision } from '@alran/shared/llm-error-classifier';

export interface UltraPlanAdapterContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Command that starts Alran Code; defaults to the running CLI entry. */
  readonly alranCommand?: readonly string[];
  readonly explorerTimeoutMs?: number;
  readonly plannerTimeoutMs?: number;
  readonly criticTimeoutMs?: number;
  readonly goalAuthorTimeoutMs?: number;
  /** Per-repository recipe files (spec §8). */
  readonly recipeOverrides?: ultra.RecipeOverrides;
  /**
   * Called before each slow model call, so a caller can say what is happening.
   * A detached run has no terminal to print to, but it does have a log, and a
   * reader who attaches should see the run move instead of a frozen screen.
   */
  readonly onProgress?: (message: string) => void;
}

/** The planner's structured output schema, kept next to the parser that reads it. */
export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['packets'],
  properties: {
    packets: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'goal', 'scope', 'depends_on'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
          title: { type: 'string', minLength: 1 },
          goal: { type: 'string', minLength: 1 },
          scope: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          readonly: { type: 'array', items: { type: 'string', minLength: 1 } },
          depends_on: { type: 'array', items: { type: 'string', minLength: 1 } },
          accept: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['cmd'],
              properties: {
                cmd: { type: 'string', minLength: 1 },
                must: { type: 'string', enum: ['exit0'] },
              },
            },
          },
          max_repairs: { type: 'integer', minimum: 0 },
          est_tokens: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const;

/** The explorer prompts, shared with the core so the two cannot drift. */
const EXPLORER_SYSTEM_PROMPTS: Record<ExplorerRole, string> = {
  structure:
    'You are a repository analyst. You are read-only: do not edit, create or delete any file. Map the repository structure and dependency graph, and report what you find as plain prose.',
  tests:
    'You are a build analyst. You are read-only: do not edit, create or delete any file. Report how tests and builds work in this repository: which commands run which suites, and which are slow or flaky.',
  risk:
    'You are a risk analyst. You are read-only: do not edit, create or delete any file. Identify the risky parts of a large change here: shared mutable state, generated files, ordering hazards, and files that must not be touched.',
};

type ExplorerRole = 'structure' | 'tests' | 'risk';

export function buildExplorerPrompt(input: {
  readonly role: ExplorerRole;
  readonly systemPrompt: string;
  readonly userPrompt: string;
}): string {
  void input.systemPrompt;
  return [
    'You are read-only. Do not edit, create or delete any file.',
    '',
    input.userPrompt,
    '',
    'Report your findings as plain prose. Be specific: name the directories,',
    'commands and files you actually saw.',
  ].join('\n');
}

export function buildScopePrompt(input: { readonly goal: string; readonly structure: string }): string {
  return [
    'Decide whether this task justifies a large, multi-agent run (Ultra) or is',
    'small enough for a single agent loop.',
    '',
    'Task:',
    input.goal,
    '',
    'Repository summary:',
    input.structure,
    '',
    'Answer with exactly one line: `YES` followed by a short reason, or `NO`',
    'followed by the reason.',
  ].join('\n');
}

export function buildPlannerPrompt(input: {
  readonly goal: string;
  readonly recipe: ultra.UltraRecipeChoice;
  readonly findings: readonly ultra.ExplorerFinding[];
  /** Per-repository recipe files (spec §8). */
  readonly recipeOverrides?: ultra.RecipeOverrides;
}): string {
  const findings = input.findings
    .map((finding) => `### ${finding.role}\n${finding.text}`)
    .join('\n\n');
  return [
    'Decompose this task into a DAG of work packets.',
    '',
    'Task:',
    input.goal,
    '',
    // The recipe is a constraint, not a label: it states how to cut the packets
    // and what a separate verifier will check afterwards (spec 8).
    ultra.buildRecipePromptBlock(
      ultra.selectRecipe(input.recipe, input.goal, input.recipeOverrides ?? {}),
    ),
    '',
    'Explorer findings:',
    findings.length > 0 ? findings : '(none)',
    '',
    'Rules:',
    '- Every packet has an id, a title, a goal, a writable scope and a depends_on list.',
    '- Two packets that run in parallel must NOT have overlapping scope. If they',
    '  must touch the same files, order them with depends_on instead.',
    '- Never write to tests/spec/ — those are the frozen acceptance checks and are',
    '  read-only for every worker.',
    '- Give each packet at least one accept command whose exit code decides.',
    '- Keep packets small enough to finish; prefer more packets over one huge one.',
    '',
    'Answer with JSON only, matching this shape:',
    '{"packets":[{"id":"p1","title":"…","goal":"…","scope":["src/a/**"],',
    '"readonly":[],"depends_on":[],"accept":[{"cmd":"pnpm test"}],"est_tokens":50000}]}',
  ].join('\n');
}

export function buildCriticPrompt(input: {
  readonly goal: string;
  readonly recipe: ultra.UltraRecipeChoice;
  readonly draft: readonly ultra.PlanPacket[];
  readonly validation: ultra.PlanValidation;
  /** Per-repository recipe files (spec §8). */
  readonly recipeOverrides?: ultra.RecipeOverrides;
}): string {
  const packets = input.draft
    .map(
      (packet) =>
        `- ${packet.id}: ${packet.title} scope=${packet.scope.join(',')} after=[${packet.depends_on.join(',')}]`,
    )
    .join('\n');
  const recipe = ultra.selectRecipe(input.recipe, input.goal, input.recipeOverrides ?? {}).recipe;
  return [
    'You are reviewing a proposed work plan before any code is written.',
    '',
    'Task:',
    input.goal,
    '',
    ...(recipe
      ? [
          `Recipe: ${recipe.id} — ${recipe.title}.`,
          'Check the plan against it:',
          ...recipe.ordering.map((rule) => `- ${rule}`),
          `Cut: ${recipe.decomposition}`,
          '',
        ]
      : []),
    'Proposed packets:',
    packets,
    '',
    `Harness validation: ${input.validation.ok ? 'passed' : 'FAILED'}`,
    ...input.validation.problems.map((problem) => `- ${problem}`),
    '',
    'Look for: packet boundaries that do not match the work, missing dependencies,',
    'overlapping scope, and acceptance criteria that cannot be verified.',
    '',
    'Answer with exactly one line first: `OK` or `PROBLEMS`. Then one problem per',
    'line beginning with `- `.',
  ].join('\n');
}

/** Reads the well-known project files so gate detection matches the CI Fixer. */
export function readGateSources(root: string): UltraGateSources {
  const read = (file: string): string | undefined => {
    const full = path.join(root, file);
    if (!existsSync(full)) return undefined;
    try {
      return readFileSync(full, 'utf8');
    } catch {
      return undefined;
    }
  };

  const packageJsonText = read('package.json');
  let packageJson: UltraGateSources['packageJson'];
  if (packageJsonText) {
    try {
      packageJson = JSON.parse(packageJsonText) as UltraGateSources['packageJson'];
    } catch {
      packageJson = undefined;
    }
  }

  return {
    ...(packageJson ? { packageJson } : {}),
    ...(read('pyproject.toml') ? { pyproject: read('pyproject.toml') } : {}),
    ...(read('Cargo.toml') ? { cargo: read('Cargo.toml') } : {}),
    ...(read('go.mod') ? { goMod: read('go.mod') } : {}),
    ...(read('Makefile') ? { makefile: read('Makefile') } : {}),
  };
}

interface HeadlessResult {
  readonly ok: boolean;
  readonly text: string;
  readonly tokensUsed: number;
  /** Estimated USD for this call; see `ultra.usdForTokens`. */
  readonly costUsd?: number;
  readonly rateLimited: boolean;
  readonly error?: string;
}

function alranCommandFor(context: UltraPlanAdapterContext): readonly string[] {
  if (context.alranCommand) return context.alranCommand;
  const entry = process.argv[1];
  if (entry && /cli\.[cm]?js$/u.test(entry)) return [process.execPath, entry];
  return ['alran'];
}

/** One headless `alran exec` call with a system prompt file and a text answer. */
function runHeadless(
  context: UltraPlanAdapterContext,
  input: {
    readonly systemPrompt: string;
    readonly prompt: string;
    readonly workspaceDir: string;
    readonly model: string;
    readonly timeoutMs: number;
    readonly permission: 'smart' | 'off';
  },
): HeadlessResult {
  const alran = alranCommandFor(context);
  const dir = mkdtempSync(path.join(tmpdir(), 'alran-ultra-plan-'));
  const systemFile = path.join(dir, 'system-prompt.txt');
  writeFileSync(systemFile, input.systemPrompt);
  try {
    const minutes = Math.max(1, Math.ceil(input.timeoutMs / 60_000));
    const result = spawnSync(
      alran[0]!,
      [
        ...alran.slice(1),
        'exec',
        '--input',
        '-',
        '--input-format',
        'text',
        '--permission',
        input.permission,
        '--timeout',
        `${minutes}m`,
        '--output-format',
        'json',
        '--system-prompt-file',
        systemFile,
        '--cwd',
        input.workspaceDir,
        ...(input.model ? ['--model', input.model] : []),
      ],
      { input: input.prompt, timeout: input.timeoutMs + 30_000, env: context.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout ?? '');
    } catch {
      parsed = undefined;
    }
    const rateLimited = result.status !== 0 && isRateLimited(result, parsed);
    if (result.status !== 0) {
      const message =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? ((parsed as { error?: { message?: string } }).error?.message ?? (result.stderr ?? '').trim())
          : (result.stderr ?? '').trim();
      return {
        ok: false,
        text: '',
        tokensUsed: 0,
        rateLimited,
        error: message || `headless run exited with ${String(result.status)}`,
      };
    }
    const usage =
      parsed && typeof parsed === 'object' && 'usage' in parsed
        ? ((parsed as { usage?: { totalTokens?: number } }).usage?.totalTokens ?? 0)
        : 0;
    // Planning is real spend: explorers, planner and critic all cost tokens, and
    // a budget that only counted workers would understate the run from the
    // first minute. A price the runtime reports still wins over the estimate.
    const costUsd = readReportedCost(parsed) ?? ultra.usdForTokens(usage);
    const text =
      parsed && typeof parsed === 'object' && 'output' in parsed
        ? typeof (parsed as { output?: unknown }).output === 'string'
          ? String((parsed as { output?: unknown }).output)
          : JSON.stringify((parsed as { output?: unknown }).output ?? '')
        : (result.stdout ?? '');
    return { ok: true, text, tokensUsed: usage, costUsd, rateLimited: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A price the headless run reported, when it reports one; otherwise undefined. */
function readReportedCost(parsed: unknown): number | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const usage = (parsed as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const cost = (usage as { costUsd?: unknown }).costUsd;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

function isRateLimited(
  result: { readonly stderr?: string | null },
  parsed: unknown,
): boolean {
  const status =
    parsed && typeof parsed === 'object' && 'error' in parsed
      ? (parsed as { error?: { status?: number } }).error?.status
      : undefined;
  const message =
    parsed && typeof parsed === 'object' && 'error' in parsed
      ? (parsed as { error?: { message?: string } }).error?.message
      : (result.stderr ?? '');
  const normalized = normalizeLLMError({
    ...(typeof status === 'number' ? { statusCode: status } : {}),
    ...(message ? { errorMessage: message } : {}),
  });
  const decision = toLLMRetryDecision(normalized);
  return decision.retryable && (decision.reason === 'rate_limited' || decision.reason === 'tpm_rate_limited');
}

/** Strips a ```json fence if the model added one, then parses. */
function parseJsonReply(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  const body = fenced ? fenced[1]! : trimmed;
  return JSON.parse(body);
}

/**
 * Parses the planner's reply into packets.
 *
 * Throws rather than guessing: a plan that cannot be read is not a plan, and a
 * half-read one would silently drop work the planner intended.
 */
export function parsePlanDraft(text: string): { packets: ultra.PlanPacket[] } {
  let parsed: unknown;
  try {
    parsed = parseJsonReply(text);
  } catch (error) {
    throw new Error(`could not read the plan reply as JSON: ${String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || !('packets' in parsed)) {
    throw new Error('the plan reply has no packets array');
  }
  const packets = (parsed as { packets?: unknown }).packets;
  if (!Array.isArray(packets) || packets.length === 0) {
    throw new Error('the plan reply has no packets');
  }
  return { packets: packets.map((entry, index) => parsePacket(entry, index)) };
}

function parsePacket(entry: unknown, index: number): ultra.PlanPacket {
  const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (id.length === 0) throw new Error(`packet ${index + 1} has no id`);
  const title = typeof record.title === 'string' ? record.title : id;
  const goal = typeof record.goal === 'string' ? record.goal : '';
  if (goal.trim().length === 0) throw new Error(`packet ${id} has no goal`);
  const scope = Array.isArray(record.scope)
    ? record.scope.filter((value): value is string => typeof value === 'string')
    : [];
  if (scope.length === 0) throw new Error(`packet ${id} has an empty scope`);
  const readonly = Array.isArray(record.readonly)
    ? record.readonly.filter((value): value is string => typeof value === 'string')
    : [];
  const dependsOn = Array.isArray(record.depends_on)
    ? record.depends_on.filter((value): value is string => typeof value === 'string')
    : [];
  const accept = Array.isArray(record.accept)
    ? record.accept
        .map((item) => {
          const cmd = item && typeof item === 'object' ? (item as Record<string, unknown>).cmd : undefined;
          return typeof cmd === 'string' ? { cmd } : undefined;
        })
        .filter((item): item is { cmd: string } => item !== undefined)
    : [];

  return {
    id,
    title,
    goal,
    scope,
    ...(readonly.length > 0 ? { readonly } : {}),
    depends_on: dependsOn,
    ...(accept.length > 0 ? { accept } : {}),
    ...(typeof record.max_repairs === 'number' ? { max_repairs: record.max_repairs } : {}),
    ...(typeof record.est_tokens === 'number' ? { est_tokens: record.est_tokens } : {}),
  };
}

/** Builds the five ports the plan phase needs. */
export function createUltraPlanAdapters(context: UltraPlanAdapterContext): ultra.UltraPlanPorts {
  const explorerTimeoutMs = context.explorerTimeoutMs ?? 10 * 60_000;
  const plannerTimeoutMs = context.plannerTimeoutMs ?? 20 * 60_000;
  const criticTimeoutMs = context.criticTimeoutMs ?? 10 * 60_000;

  const call = (
    input: { systemPrompt: string; prompt: string; timeoutMs: number; model: string },
  ): HeadlessResult =>
    runHeadless(context, {
      systemPrompt: input.systemPrompt,
      prompt: input.prompt,
      workspaceDir: context.cwd,
      model: input.model,
      timeoutMs: input.timeoutMs,
      // Planning only reads the repository; `off` keeps a planning call from
      // making changes the plan would then be built on top of.
      permission: 'off',
    });

  return {
    async scope(input) {
      context.onProgress?.('checking whether the task needs Ultra');
      const result = call({
        systemPrompt:
          'You decide whether a task needs a large multi-agent run. Answer YES or NO with a short reason.',
        prompt: buildScopePrompt(input),
        timeoutMs: 3 * 60_000,
        model: '',
      });
      if (!result.ok) return { ok: false, reason: `scope check failed: ${result.error ?? 'unknown error'}` };
      const verdict = /^\s*(YES|NO)\b/iu.exec(result.text);
      const ok = verdict?.[1]?.toUpperCase() === 'YES';
      const reason = result.text.trim().slice(0, 300) || 'no reason given';
      return { ok, reason };
    },

    async explore(brief) {
      context.onProgress?.(`exploring ${brief.role}`);
      const result = call({
        systemPrompt: EXPLORER_SYSTEM_PROMPTS[brief.role as ExplorerRole] ?? EXPLORER_SYSTEM_PROMPTS.structure,
        prompt: buildExplorerPrompt({
          role: brief.role as ExplorerRole,
          systemPrompt: brief.systemPrompt,
          userPrompt: brief.userPrompt,
        }),
        timeoutMs: explorerTimeoutMs,
        model: '',
      });
      return {
        role: brief.role,
        text: result.ok ? result.text.trim() : `explorer failed: ${result.error ?? 'unknown error'}`,
        ...(result.ok ? { tokensUsed: result.tokensUsed } : {}),
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      };
    },

    async plan(input) {
      context.onProgress?.('planning the packets');
      const result = call({
        systemPrompt:
          'You are a planner. You decompose a task into a DAG of bounded work packets and answer with JSON only.',
        prompt: buildPlannerPrompt({
          goal: input.goal,
          recipe: input.recipe,
          findings: input.findings,
        }),
        timeoutMs: plannerTimeoutMs,
        model: input.model,
      });
      if (!result.ok) throw new Error(`planner failed: ${result.error ?? 'unknown error'}`);
      const draft = parsePlanDraft(result.text);
      return {
        packets: draft.packets,
        tokensUsed: result.tokensUsed,
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      };
    },

    async critique(input) {
      context.onProgress?.('criticising the plan');
      const result = call({
        systemPrompt:
          'You review work plans before any code is written. Answer OK or PROBLEMS, then list problems.',
        prompt: buildCriticPrompt(input),
        timeoutMs: criticTimeoutMs,
        model: input.model,
      });
      if (!result.ok) {
        return { ok: false, problems: [`critic failed to run: ${result.error ?? 'unknown error'}`] };
      }
      const lines = result.text.split('\n').map((line) => line.trim());
      const verdictLine = lines.find((line) => /^(OK|PROBLEMS)\b/iu.test(line));
      const ok = verdictLine?.toUpperCase().startsWith('OK') ?? false;
      const problems = lines
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim())
        .filter((line) => line.length > 0);
      return {
        ok,
        problems: ok ? [] : problems.length > 0 ? problems : ['critic found problems but did not list them'],
        tokensUsed: result.tokensUsed,
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      };
    },

    readGateSources: async () => readGateSources(context.cwd),
  };
}
/**
 * The goal-document authoring turn (spec 13.1).
 *
 * Separate from the plan ports because it answers a different question: the
 * planner decides *how* to split the work, the author decides *what done means*.
 * Keeping them apart is what lets the criteria carry priorities — the planner's
 * packet titles cannot, and a goal where everything is a `must` cannot be sized
 * to a budget.
 */
export function createUltraGoalAdapter(context: UltraPlanAdapterContext): {
  author(input: {
    readonly goal: string;
    readonly recipe: string;
    readonly structure?: string;
    readonly model: string;
  }): Promise<{ readonly goal: ultra.GoalDocument; readonly costUsd?: number }>;
} {
  const timeoutMs = context.goalAuthorTimeoutMs ?? 15 * 60_000;

  return {
    async author(input) {
      context.onProgress?.('writing the goal document');
      const result = runHeadless(context, {
        systemPrompt: [
          'You write goal documents for long autonomous software runs.',
          'You state acceptance criteria in plain language and you do not',
          'pre-judge whether they are met. You answer with JSON only.',
        ].join('\n'),
        prompt: ultra.buildGoalAuthorPrompt({
          goal: input.goal,
          recipe: input.recipe,
          ...(input.structure ? { structure: input.structure } : {}),
        }),
        workspaceDir: context.cwd,
        model: input.model,
        timeoutMs,
        // Authoring only reads the repository; `off` keeps it from making the
        // change it is supposed to be describing.
        permission: 'off',
      });
      if (!result.ok) throw new Error(`goal authoring failed: ${result.error ?? 'unknown error'}`);
      return {
        goal: ultra.parseGoalAuthorReply(result.text, input.goal),
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      };
    },
  };
}
