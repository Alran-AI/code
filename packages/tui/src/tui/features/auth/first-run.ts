import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Remembers that the welcome was shown, so a person who skipped it is not asked again at the next start. */
const FIRST_RUN_FILE = 'first-run-welcome.json';

export function firstRunWelcomeSeen(dataDir: string): boolean {
  try {
    return existsSync(path.join(dataDir, FIRST_RUN_FILE));
  } catch {
    // A directory that cannot be read cannot hold the mark either: the welcome is not shown over it.
    return true;
  }
}

/** Written when the welcome opens, not when it is answered: closing the terminal is also an answer. */
export function markFirstRunWelcomeSeen(dataDir: string, now: () => Date = () => new Date()): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      path.join(dataDir, FIRST_RUN_FILE),
      `${JSON.stringify({ shown_at: now().toISOString() })}\n`,
      { flag: 'w' },
    );
  } catch {
    // The welcome is a courtesy; failing to remember it must not break the start.
  }
}
