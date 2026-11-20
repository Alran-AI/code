/**
 * Goal-document authoring (spec 13.1).
 *
 * The goal document is the contract a long run is judged against, so it needs to
 * exist *before* packets are planned: what fits in the budget, when the run may
 * stop, and what "done" means are all read from the criteria.
 *
 * Deriving criteria from the planner's packet titles — the earlier behaviour —
 * looks reasonable and fails in three specific ways:
 *
 *   - every criterion becomes a `must`, so budget-aware planning (spec 13.6) has
 *     nothing it may drop and a small budget produces a plan that cannot fit;
 *   - a description is a packet name, not something a human can verify, so the
 *     acceptor has nothing to exercise;
 *   - `partial` becomes unreachable, because no criterion is ever optional.
 *
 * So this module is a dedicated authoring turn: it asks for criteria with a
 * priority and a verification method, validates the reply against the same rules
 * the rest of Ultra uses, and refuses a reply that would freeze an empty or
 * unreadable goal.
 */

import { GoalDocumentError, parseGoalDocument, type Criterion, type GoalDocument } from './goal.js';

/**
 * JSON Schema for the authoring turn.
 *
 * Kept next to the prompt so `alran exec --output-schema` rejects the same
 * replies this parser rejects, instead of the model discovering the rules one
 * failed run at a time.
 */
export const GOAL_AUTHOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['criteria'],
  properties: {
    criteria: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'priority', 'verification', 'description'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
          priority: { type: 'string', enum: ['must', 'should', 'could'] },
          verification: { type: 'string', enum: ['test', 'command', 'scenario', 'manual'] },
          description: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const;

export interface GoalAuthorInput {
  readonly goal: string;
  readonly recipe: string;
  /** The structure explorer's map, so the criteria match this repository. */
  readonly structure?: string;
}

/** The prompt for the authoring turn. */
export function buildGoalAuthorPrompt(input: GoalAuthorInput): string {
  return [
    'Write the goal document for a long autonomous run: the acceptance criteria',
    'the run will be judged against. You are not planning the work and not',
    'writing code; you are stating, in plain language, what must be true when',
    'the run is done.',
    '',
    'Task:',
    input.goal,
    ...(input.recipe && input.recipe !== 'auto' ? [`Recipe: ${input.recipe}`] : []),
    '',
    ...(input.structure && input.structure.trim().length > 0
      ? ['What is known about the repository:', input.structure.trim(), '']
      : []),
    'Rules:',
    '- Three to nine criteria. Fewer is usually too coarse to verify; more is',
    '  usually a plan in disguise.',
    '- Each criterion has a priority: `must` (the run is not succeeded without',
    '  it), `should` (expected, but a run may finish without it) or `could`',
    '  (nice to have). Not everything is a `must`: a plan where every criterion',
    '  is a must cannot be sized to a budget.',
    '- Each criterion has a verification method: `test` (an automated test can',
    '  decide), `command` (a CLI command shows it), `scenario` (someone has to',
    '  drive the product) or `manual` (a human has to judge look and feel).',
    '- Write each description in plain language, as one sentence a person can',
    '  read and check. Say what is observable, not how to build it.',
    '- Criteria must be independent: one criterion, one thing to check.',
    '',
    'Reply with JSON only, in exactly this shape:',
    '',
    '{"criteria": [{"id": "C1", "priority": "must", "verification": "scenario",',
    '  "description": "…"}]}',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

/** Parses the authoring reply, refusing anything that would freeze a bad goal. */
export function parseGoalAuthorReply(text: string, goalText: string): GoalDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new GoalDocumentError('the goal author did not reply with JSON');
  }

  const criteria = authorCriteria(parsed);
  if (criteria.length === 0) {
    throw new GoalDocumentError('the goal author produced no criteria');
  }
  const ids = new Set<string>();
  for (const criterion of criteria) {
    if (ids.has(criterion.id)) {
      throw new GoalDocumentError(`the goal author used the id ${criterion.id} twice`);
    }
    ids.add(criterion.id);
  }

  // `parseGoalDocument` owns the rules for priorities, verification methods and
  // evidence, so the authoring turn cannot drift from what the acceptor and the
  // report already enforce.
  return { ...parseGoalDocument({ goal: goalText, criteria }), goal: goalText };
}

function authorCriteria(parsed: unknown): Criterion[] {
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const raw = Array.isArray(record.criteria) ? record.criteria : [];
  return raw.map((entry, index) => {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (description.length === 0) {
      const id = typeof item.id === 'string' && item.id.length > 0 ? item.id : `C${index + 1}`;
      throw new GoalDocumentError(`criterion ${id} has no description`);
    }
    return {
      id: typeof item.id === 'string' ? item.id : `C${index + 1}`,
      priority: item.priority,
      verification: item.verification,
      description,
      // Authoring states what done means; it never pre-judges whether it is done.
      status: 'unmet',
      evidence: [],
    } as unknown as Criterion;
  });
}

/**
 * The JSON object inside a reply.
 *
 * Models like to wrap JSON in prose or a fence. Taking the outermost object is
 * enough, and refusing a reply with no object at all keeps a chatty non-answer
 * from being read as an empty goal.
 */
function extractJson(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return trimmed;
  return trimmed.slice(start, end + 1);
}