/**
 * Curated run memory (spec 13.5).
 *
 * A long run spans many packets and many rounds. Workers must not read earlier
 * transcripts — that would make round 3 depend on round 1's reasoning instead of
 * on the goal — so the run keeps a small, deliberate memory instead: the
 * decisions, conventions and public interfaces a later packet needs to know.
 *
 * `notes.md` is written by integrate, not by workers. That is the point: the
 * workers' own accounts are claims, and this is the one summary the harness
 * stands behind, assembled from what actually merged.
 */

/** One durable fact a later round should know. */
export interface RunNote {
  readonly round: number;
  readonly kind: 'decision' | 'convention' | 'interface';
  readonly text: string;
}

/** The interface a packet exposes to the rest of the run. */
export interface InterfaceSummary {
  readonly packetId: string;
  readonly module: string;
  readonly summary: string;
}

export interface NotesInput {
  readonly runId: string;
  readonly goal: string;
  readonly notes: readonly RunNote[];
  readonly interfaces?: readonly InterfaceSummary[];
  readonly rounds?: number;
}

const KIND_HEADING: Record<RunNote['kind'], string> = {
  decision: 'Decisions',
  convention: 'Conventions',
  interface: 'Interfaces',
};

/**
 * Renders `notes.md`.
 *
 * Content is grouped by kind rather than by round, because the question a later
 * packet asks is "what is true now", not "what happened in round 2". Each entry
 * still carries its round so a reader can trace it.
 */
export function buildNotes(input: NotesInput): string {
  const lines: string[] = [];
  lines.push(`# Ultra run notes: ${input.runId}`);
  lines.push('');
  lines.push(`Goal: ${input.goal}`);
  if (input.rounds !== undefined) lines.push(`Rounds completed: ${String(input.rounds)}`);
  lines.push('');
  lines.push(
    'Curated by integrate. Workers never read earlier transcripts; this file is the',
    'run\'s only carried memory.',
  );
  lines.push('');

  const kinds: RunNote['kind'][] = ['decision', 'convention', 'interface'];
  for (const kind of kinds) {
    const entries = input.notes.filter((note) => note.kind === kind);
    const interfaces = kind === 'interface' ? (input.interfaces ?? []) : [];
    if (entries.length === 0 && interfaces.length === 0) continue;

    lines.push(`## ${KIND_HEADING[kind]}`);
    lines.push('');
    for (const entry of entries) lines.push(`- (round ${String(entry.round)}) ${entry.text}`);
    for (const entry of interfaces) {
      lines.push(`- **${entry.packetId}** \`${entry.module}\`: ${entry.summary}`);
    }
    lines.push('');
  }

  if (input.notes.length === 0 && (input.interfaces ?? []).length === 0) {
    lines.push('_Nothing curated yet._');
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** The packet context a worker gets: goal, notes and interfaces, never transcripts. */
export function buildPacketContext(input: {
  readonly goal: string;
  readonly notes: string;
  readonly interfaces: readonly InterfaceSummary[];
  readonly criteria?: readonly string[];
}): string {
  const lines: string[] = [];
  lines.push('Run goal:');
  lines.push(input.goal);
  lines.push('');
  if (input.criteria && input.criteria.length > 0) {
    lines.push('Criteria this packet serves:');
    for (const criterion of input.criteria) lines.push(`- ${criterion}`);
    lines.push('');
  }
  if (input.interfaces.length > 0) {
    lines.push('Interfaces already in place:');
    for (const entry of input.interfaces) {
      lines.push(`- \`${entry.module}\` (${entry.packetId}): ${entry.summary}`);
    }
    lines.push('');
  }
  if (input.notes.trim().length > 0) {
    lines.push('Run notes:');
    lines.push(input.notes.trim());
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}