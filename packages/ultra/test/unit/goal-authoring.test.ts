/**
 * Goal-document authoring (spec 13.1, 13.2).
 *
 * A goal-driven run is judged against its criteria, so the criteria decide
 * everything downstream: what fits in the budget, when the run may stop, and
 * what the report means by "done". Seeding them from the planner's packet titles
 * (the earlier behaviour) makes every criterion a `must` and every description a
 * packet name, which quietly breaks budget sizing (nothing can be dropped by
 * priority) and makes `partial` unreachable.
 *
 * These tests pin the authoring turn: what it must produce, what it must refuse,
 * and what the prompt has to tell the model so a human can actually read the
 * result.
 */

import { describe, expect, it } from 'vitest';
import {
  GOAL_AUTHOR_SCHEMA,
  buildGoalAuthorPrompt,
  parseGoalAuthorReply,
} from '../../src/goal-authoring.js';
import { GoalDocumentError } from '../../src/goal.js';

const TASK = 'Build a drawing app with layers and PNG export';

const REPLY = JSON.stringify({
  criteria: [
    {
      id: 'C1',
      priority: 'must',
      verification: 'scenario',
      description: 'A user can create, move and hide layers.',
    },
    {
      id: 'C2',
      priority: 'should',
      verification: 'command',
      description: 'The result can be exported as PNG via `app export out.png`.',
    },
    {
      id: 'C3',
      priority: 'could',
      verification: 'manual',
      description: 'The canvas feels smooth while dragging a large layer.',
    },
  ],
});

describe('parseGoalAuthorReply', () => {
  it('keeps the priorities and verification methods the author chose', () => {
    const goal = parseGoalAuthorReply(REPLY, TASK);
    expect(goal.goal).toBe(TASK);
    expect(goal.criteria.map((criterion) => criterion.priority)).toEqual(['must', 'should', 'could']);
    expect(goal.criteria.map((criterion) => criterion.verification)).toEqual([
      'scenario',
      'command',
      'manual',
    ]);
    expect(goal.criteria[0]!.description).toBe('A user can create, move and hide layers.');
  });

  it('freezes every criterion as unmet with no evidence', () => {
    // Authoring states what "done" means; it must not pre-judge any of it.
    const goal = parseGoalAuthorReply(REPLY, TASK);
    for (const criterion of goal.criteria) {
      expect(criterion.status).toBe('unmet');
      expect(criterion.evidence).toEqual([]);
    }
    expect(goal.amendments).toEqual([]);
  });

  it('ignores ids, statuses and evidence the author invented', () => {
    // The model does not get to declare its own work finished at authoring time.
    const goal = parseGoalAuthorReply(
      JSON.stringify({
        criteria: [
          { id: 'C1', priority: 'must', verification: 'test', description: 'X', status: 'met', evidence: ['trust me'] },
        ],
      }),
      TASK,
    );
    expect(goal.criteria[0]!.status).toBe('unmet');
    expect(goal.criteria[0]!.evidence).toEqual([]);
  });

  it('refuses a reply with no criteria instead of freezing an empty goal', () => {
    // An empty goal document would make every run trivially "succeeded".
    expect(() => parseGoalAuthorReply(JSON.stringify({ criteria: [] }), TASK)).toThrow(
      GoalDocumentError,
    );
    expect(() => parseGoalAuthorReply('I could not do that.', TASK)).toThrow(GoalDocumentError);
  });

  it('refuses a criterion with an unknown priority or verification method', () => {
    expect(() =>
      parseGoalAuthorReply(
        JSON.stringify({ criteria: [{ id: 'C1', priority: 'critical', verification: 'test', description: 'X' }] }),
        TASK,
      ),
    ).toThrow(/priority/u);
    expect(() =>
      parseGoalAuthorReply(
        JSON.stringify({ criteria: [{ id: 'C1', priority: 'must', verification: 'vibes', description: 'X' }] }),
        TASK,
      ),
    ).toThrow(/verification/u);
  });

  it('refuses a criterion with no description', () => {
    // A criterion nobody can read is a criterion nobody can verify or prioritise.
    expect(() =>
      parseGoalAuthorReply(
        JSON.stringify({ criteria: [{ id: 'C1', priority: 'must', verification: 'test', description: '  ' }] }),
        TASK,
      ),
    ).toThrow(/description/u);
  });
});

describe('buildGoalAuthorPrompt', () => {
  it('states the allowed values and demands plain language', () => {
    const prompt = buildGoalAuthorPrompt({ goal: TASK, recipe: 'auto', structure: 'src/app/**' });
    expect(prompt).toContain(TASK);
    expect(prompt).toContain('must');
    expect(prompt).toContain('should');
    expect(prompt).toContain('could');
    for (const verification of ['test', 'command', 'scenario', 'manual']) {
      expect(prompt).toContain(verification);
    }
    expect(prompt).toMatch(/plain language/iu);
    // The model answers with JSON only; prose would not survive the parser.
    expect(prompt).toMatch(/JSON/);
  });
});

describe('GOAL_AUTHOR_SCHEMA', () => {
  it('requires at least one criterion and rejects extra keys', () => {
    expect(GOAL_AUTHOR_SCHEMA.required).toEqual(['criteria']);
    expect(GOAL_AUTHOR_SCHEMA.properties.criteria.minItems).toBe(1);
    expect(GOAL_AUTHOR_SCHEMA.additionalProperties).toBe(false);
  });
});