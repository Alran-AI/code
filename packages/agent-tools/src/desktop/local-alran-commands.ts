/**
 * Desktop alran subcommand vocabulary: single source of truth.
 *
 * A separate module lets `builtin-defs.ts` (definitions) and `local-alran.ts` (dispatcher) share
 * the command list without an import cycle. `local-alran.ts` depends on `LocalAlranToolDef` in
 * builtin-defs.ts, so the vocabulary cannot live in the dispatcher.
 *
 * When adding a subcommand, update:
 * 1. `LOCAL_ALRAN_COMMANDS` here.
 * 2. `LOCAL_ALRAN_COMMAND_SCHEMAS` and `HANDLERS` in `local-alran.ts`.
 * 3. The command list in `LocalAlranToolDef.schema.properties.command.description` in
 *   `builtin-defs.ts`.
 * 4. Its PTC routing: add an entry to `PTC_ALRAN_CHILD_TOOLS` and describe it in
 *   `local-alran-ptc.ts`, or keep it top-level (`PTC_ALRAN_DIRECT_COMMANDS`, and
 *   update the top-level description).
 *
 * Type constraints in `local-alran.ts` cause compilation to fail if 1 and 2 drift, and
 * `local-alran-ptc.ts`'s unit test fails when 4 is missed.
 */

import type { ToolExecutionContext } from '@alran/agent-core/tools';

import { normalizeAlranCommand } from '../shared/alran-operation-classifier.js';

export const LOCAL_ALRAN_COMMANDS = [
  'agent list',
  'agent get',
  'agent create',
  'agent update',
  'agent delete',
  'agent help',

  'cron list',
  'cron get',
  'cron resolve-model',
  'cron create',
  'cron self',
  'cron once',
  'cron update',
  'cron delete',
  'cron trigger',
  'cron sessions',
  'cron help',

  'session list',
  'session get',
  'session send',
  'session update',
  'session delete',
  'session messages',
  'session help',

  'mcp list',
  'mcp get',
  'mcp create',
  'mcp update',
  'mcp delete',
  'mcp help',
] as const;

/** Internal command vocabulary reused by the standalone Cron adapters. */
export const LOCAL_CRON_COMMANDS = [
  'cron list',
  'cron get',
  'cron resolve-model',
  'cron create',
  'cron self',
  'cron once',
  'cron update',
  'cron delete',
  'cron trigger',
  'cron sessions',
  'cron help',
] as const;
export type LocalAlranCommandName =
  | (typeof LOCAL_ALRAN_COMMANDS)[number]
  | (typeof LOCAL_CRON_COMMANDS)[number];

/**
 * On a PTC Turn every Desktop alran command except these becomes a run_code
 * tool of its own (`PTC_ALRAN_CHILD_TOOLS`). These two start or continue other
 * work: agent create makes a new Agent with its root Session, session send
 * triggers or continues another Session's Turn. Such spawn and continue calls
 * stay top-level: when v8 kept task and task_append inside run_code only,
 * evals delegated clearly less and never continued a delegated Session, with
 * no score gain, and v9 put them back. session delete is not a command; the
 * alran tool answers it with a refusal, which is harmless at the top level.
 */
const PTC_ALRAN_DIRECT_COMMANDS = new Set<string>([
  'agent create',
  'session send',
  'session delete',
]);

/**
 * The run_code tools of a PTC Turn with the Desktop alran tool: one per
 * command, each with that command's own argument schema (local-alran-ptc.ts),
 * so a program sees and is checked against what each command takes instead
 * of one `alran({ command, args })`. The help commands are not flattened.
 */
export const PTC_ALRAN_CHILD_TOOLS = [
  { name: 'alran_agent_list', command: 'agent list' },
  { name: 'alran_agent_get', command: 'agent get' },
  { name: 'alran_agent_update', command: 'agent update' },
  { name: 'alran_agent_delete', command: 'agent delete' },
  { name: 'alran_session_list', command: 'session list' },
  { name: 'alran_session_get', command: 'session get' },
  { name: 'alran_session_update', command: 'session update' },
  { name: 'alran_session_messages', command: 'session messages' },
  { name: 'alran_mcp_list', command: 'mcp list' },
  { name: 'alran_mcp_get', command: 'mcp get' },
  { name: 'alran_mcp_create', command: 'mcp create' },
  { name: 'alran_mcp_update', command: 'mcp update' },
  { name: 'alran_mcp_delete', command: 'mcp delete' },
] as const satisfies readonly { readonly name: string; readonly command: LocalAlranCommandName }[];

export type PtcAlranChildToolName = (typeof PTC_ALRAN_CHILD_TOOLS)[number]['name'];

/** The run_code tool standing for a Desktop alran command; undefined for the top-level ones. */
export function ptcAlranChildToolName(command: unknown): PtcAlranChildToolName | undefined {
  if (typeof command !== 'string') return undefined;
  const normalized = normalizeAlranCommand(command);
  return PTC_ALRAN_CHILD_TOOLS.find((entry) => entry.command === normalized)?.name;
}

/** True for the names of the alran_* run_code tools; metrics fold them into `alran`. */
export function isPtcAlranChildToolName(name: string): boolean {
  return PTC_ALRAN_CHILD_TOOLS.some((entry) => entry.name === name);
}

/** Desktop alran commands a PTC Turn runs only through their alran_* run_code tool. */
export function isPtcAlranProgrammaticCommand(command: unknown): boolean {
  return ptcAlranChildToolName(command) !== undefined;
}

/** Desktop alran commands that stay on the top-level alran tool of a PTC Turn. */
export function isPtcAlranDirectCommand(command: unknown): boolean {
  return (
    typeof command === 'string' && PTC_ALRAN_DIRECT_COMMANDS.has(normalizeAlranCommand(command))
  );
}

/** The call a model writes inside run_code for a flattened command. */
export function ptcAlranRunCodeCall(toolName: string, args = '{ ... }'): string {
  return `await tools.${toolName}(${args})`;
}

/**
 * The run_code tool of `command` when this Turn's run_code lists it (the
 * executor resolves only names its run_code registered). Undefined on every
 * other Turn, so the alran tool keeps its wording there byte for byte.
 */
export function ptcAlranRunCodeTool(
  ctx: Pick<ToolExecutionContext, 'ptcExecutor'>,
  command: string,
): PtcAlranChildToolName | undefined {
  const name = ptcAlranChildToolName(command);
  return name && ctx.ptcExecutor?.getToolExecutionMode(name) !== undefined ? name : undefined;
}

/**
 * Help output on a PTC Turn whose run_code lists the alran_* tools: each
 * flattened command names its run_code call and its examples use it, so the
 * model does not copy a `alran({ command })` call the top level refuses.
 * Every other Turn gets the output unchanged.
 */
export function ptcAlranHelpOutput<T extends { readonly ok: boolean; readonly command: string }>(
  ctx: Pick<ToolExecutionContext, 'ptcExecutor'>,
  output: T,
): T {
  if (!output.ok || !output.command.endsWith(' help') || !('response' in output)) return output;
  const response = output.response;
  if (!isRecord(response) || !Array.isArray(response.commands)) return output;
  let changed = false;
  const commands = response.commands.map((entry: unknown) => {
    const command = isRecord(entry) ? entry.command : undefined;
    const tool = typeof command === 'string' ? ptcAlranRunCodeTool(ctx, command) : undefined;
    if (!isRecord(entry) || !tool) return entry;
    changed = true;
    const examples = Array.isArray(entry.examples)
      ? entry.examples.map((example: unknown) =>
          typeof example === 'string'
            ? example.replace(/^alran\(\{ command: "[^"]+", args: (.*) \}\)$/u, (_, args) =>
                ptcAlranRunCodeCall(tool, String(args)),
              )
            : example,
        )
      : undefined;
    return { ...entry, run_code: ptcAlranRunCodeCall(tool), ...(examples ? { examples } : {}) };
  });
  return changed ? { ...output, response: { ...response, commands } } : output;
}

/** How to archive a Session, in the form this Turn accepts. */
export function localAlranArchiveCall(ctx: Pick<ToolExecutionContext, 'ptcExecutor'>): string {
  const tool = ptcAlranRunCodeTool(ctx, 'session update');
  return tool
    ? `${ptcAlranRunCodeCall(tool, '{ session_id, archived: true }')} inside run_code`
    : 'session update (archived: true)';
}

const LOCAL_ALRAN_MUTATION_COMMANDS = new Set([
  'agent create',
  'agent update',
  'agent delete',
  'cron create',
  'cron self',
  'cron once',
  'cron update',
  'cron delete',
  'cron trigger',
  'session update',
  'session interrupt',
  'session send',
  'mcp create',
  'mcp update',
  'mcp delete',
]);

/** Recovery line of a truncated alran response; a mutation is never replayed. */
export function alranRecoveryInstruction(command: string, runCodeTool?: string): string {
  if (LOCAL_ALRAN_MUTATION_COMMANDS.has(command)) {
    return (
      `do not repeat the mutation command ${JSON.stringify(command)} automatically; ` +
      'inspect current state with the corresponding get/list command'
    );
  }
  // A PTC Turn runs this command as its alran_* run_code tool, the only form it accepts there.
  const again = runCodeTool
    ? `tools.${runCodeTool} again inside run_code`
    : `alran again with command=${JSON.stringify(command)}`;
  return (
    `call ${again} and narrower args ` +
    '(prefer a smaller limit, tighter search/filter, pagination cursor, or a specific get command); ' +
    'preserve the same logical query'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
