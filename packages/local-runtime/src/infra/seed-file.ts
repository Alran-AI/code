import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

/** Write `content` to `filePath` only when it differs; repair the mode either way. */
export function seedFileIfChanged(filePath: string, content: string, mode?: number): void {
  let existing: string | undefined;
  try {
    existing = readFileSync(filePath, 'utf8');
  } catch {
    existing = undefined;
  }
  if (existing !== content) {
    writeFileSync(filePath, content, mode === undefined ? undefined : { mode });
  }
  if (mode !== undefined) {
    // Repair the execute bit even when the content already matched: a shim that
    // is present but not executable would make bash fall through to /bin/rm.
    try {
      chmodSync(filePath, mode);
    } catch {
      // Best effort — a read-only dataDir surfaces at spawn time instead.
    }
  }
}
