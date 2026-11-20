/**
 * Curated run memory (spec 13.5).
 *
 * The notes file is what a later round reads instead of an earlier transcript, so
 * the tests pin that it groups by kind (the question is "what is true now"), that
 * every entry keeps its round for traceability, and that the packet context
 * builder never leaks a transcript.
 */

import { describe, expect, it } from 'vitest';
import { buildNotes, buildPacketContext, type RunNote } from '../../src/notes.js';

const NOTES: RunNote[] = [
  { round: 1, kind: 'decision', text: 'Use a command bus rather than direct calls' },
  { round: 2, kind: 'convention', text: 'Errors are returned, never thrown, across a packet boundary' },
  { round: 2, kind: 'decision', text: 'Reversed the round-1 decision: the bus hid the call graph' },
];

describe('buildNotes', () => {
  it('groups notes by kind, not by round', () => {
    const text = buildNotes({ runId: 'r1', goal: 'Build it', notes: NOTES, rounds: 2 });
    const decisionHeading = text.indexOf('## Decisions');
    const conventionHeading = text.indexOf('## Conventions');
    expect(decisionHeading).toBeGreaterThan(-1);
    expect(conventionHeading).toBeGreaterThan(decisionHeading);
  });

  it('keeps the round on every entry so a reader can trace it', () => {
    const text = buildNotes({ runId: 'r1', goal: 'g', notes: NOTES });
    expect(text).toContain('(round 1)');
    expect(text).toContain('(round 2)');
  });

  it('lists the interfaces packets expose', () => {
    const text = buildNotes({
      runId: 'r1',
      goal: 'g',
      notes: [],
      interfaces: [{ packetId: 'p1', module: 'src/bus.ts', summary: 'publish/subscribe' }],
    });
    expect(text).toContain('## Interfaces');
    expect(text).toContain('src/bus.ts');
    expect(text).toContain('publish/subscribe');
  });

  it('says so plainly when nothing has been curated', () => {
    const text = buildNotes({ runId: 'r1', goal: 'g', notes: [] });
    expect(text).toMatch(/Nothing curated yet/iu);
  });
});

describe('buildPacketContext', () => {
  it('assembles goal, criteria, interfaces and notes', () => {
    const text = buildPacketContext({
      goal: 'Build it',
      criteria: ['C1 must: layers work'],
      notes: buildNotes({ runId: 'r1', goal: 'g', notes: NOTES }),
      interfaces: [{ packetId: 'p1', module: 'src/bus.ts', summary: 'publish/subscribe' }],
    });
    expect(text).toContain('Run goal:');
    expect(text).toContain('C1 must: layers work');
    expect(text).toContain('src/bus.ts');
    expect(text).toContain('command bus');
  });

  it('contains no transcript: only curated notes and interfaces', () => {
    const text = buildPacketContext({
      goal: 'g',
      notes: '',
      interfaces: [],
      criteria: [],
    });
    // With no notes and no interfaces there is nothing beyond the goal.
    expect(text).toBe('Run goal:\ng');
  });
});