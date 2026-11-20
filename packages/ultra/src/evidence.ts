/**
 * Per-packet evidence files (spec 4.3).
 *
 * `.alran/ultra/<run-id>/packets/<id>/` holds what a human needs to review a
 * packet without re-running it: the prompt the worker got, the diff it produced,
 * the gate output and the verifier verdict. This is the durable counterpart to
 * the ledger — the ledger says what happened, the evidence shows it.
 *
 * The writer is deliberately dumb: it creates the packet directory on demand and
 * writes one file. Path safety is the caller's job (`packetId` comes from the
 * validated plan, whose schema restricts it to `[A-Za-z0-9_-]+`), but a guard
 * here keeps a bad id from escaping the packets directory.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Packet ids the plan schema allows; anything else could escape the directory. */
const SAFE_PACKET_ID = /^[A-Za-z0-9_-]+$/u;

export interface FileEvidenceWriter {
  write(input: { readonly packetId: string; readonly name: string; readonly content: string }): void;
}

/**
 * Builds a writer rooted at the run's `packets/` directory. `name` must be a
 * plain filename, never a path, so evidence cannot be written outside the
 * packet's own directory.
 */
export function createFileEvidenceWriter(packetsDir: string): FileEvidenceWriter {
  return {
    write({ packetId, name, content }) {
      if (!SAFE_PACKET_ID.test(packetId)) {
        throw new Error(`unsafe Ultra packet id for evidence: ${packetId}`);
      }
      if (name.includes('/') || name.includes('\\') || name === '..' || name === '.') {
        throw new Error(`unsafe Ultra evidence file name: ${name}`);
      }
      const dir = path.join(packetsDir, packetId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, name), content);
    },
  };
}