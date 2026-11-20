/**
 * The Ultra ledger: one JSONL line per step.
 *
 * The ledger is the source of truth for resume and for the cost in the report.
 * It is append-only and flushed per line so a hard kill loses at most the line
 * being written. A torn final line is ignored on open instead of aborting the
 * run, because the process can die mid-write.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { maskTokenPatterns, maskSecretAssignments } from '@alran/ci-fix';
import type { LedgerEntry } from './types.js';

/** Secret variable names whose `NAME=value` assignments must never reach disk. */
const SECRET_NAMES = ['ALRAN_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN'];

/**
 * Masks secrets in free-text ledger fields. Values are unknown here, so this
 * combines credential-shaped tokens with known assignment names; the runtime
 * adapter should pass already-masked text where it can. Masked spans become
 * `***`, the marker the CI Fixer's maskers already use.
 */
function redact(text: string): string {
  return maskSecretAssignments(maskTokenPatterns(text), SECRET_NAMES);
}

function redactEntry(entry: LedgerEntry): LedgerEntry {
  return {
    ...entry,
    ...(entry.note ? { note: redact(entry.note) } : {}),
    at: entry.at ?? new Date().toISOString(),
  };
}

export class Ledger {
  private loaded: LedgerEntry[] = [];

  private constructor(private readonly file: string) {}

  /** Opens (or creates) a ledger and replays every readable entry. */
  static open(file: string): Ledger {
    const ledger = new Ledger(file);
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file)) {
      const text = readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          ledger.loaded.push(JSON.parse(trimmed) as LedgerEntry);
        } catch {
          // A torn line from a kill mid-write; drop it and keep the rest.
        }
      }
    }
    return ledger;
  }

  append(entry: LedgerEntry): LedgerEntry {
    const record = redactEntry(entry);
    appendFileSync(this.file, `${JSON.stringify(record)}\n`);
    this.loaded.push(record);
    return record;
  }

  entries(): readonly LedgerEntry[] {
    return this.loaded;
  }

  totalCostUsd(): number {
    return this.loaded.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
  }

  costByRole(): Record<string, number> {
    const byRole: Record<string, number> = {};
    for (const entry of this.loaded) {
      if (!entry.role) continue;
      byRole[entry.role] = (byRole[entry.role] ?? 0) + (entry.costUsd ?? 0);
    }
    return byRole;
  }

  /**
   * Packet ids that reached a terminal outcome. `resume` skips these and redoes
   * everything else, so a crash never repeats finished work.
   */
  finishedPacketIds(): Set<string> {
    const finished = new Set<string>();
    for (const entry of this.loaded) {
      if (entry.kind !== 'packet' || !entry.packetId) continue;
      if (entry.status === 'done' || entry.status === 'blocked' || entry.status === 'skipped') {
        finished.add(entry.packetId);
      }
    }
    return finished;
  }
}
