// The weekly update hint of the plain subcommands (`alran usage`, `alran models`, …).
//
// The interactive TUI checks for an update when it starts. A person who only runs subcommands would
// never hear of one, so these check too — at most once every seven days, through a stamp file in the
// data directory, with a short timeout, and never in a way that delays or fails the command. The
// hint goes to stderr, so scripts that read stdout are not affected. `ALRAN_NO_UPDATE_CHECK=1` (and
// `CI`) switch it off.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { compareAlranVersions } from './release.js';

export const UPDATE_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_PACKAGE = 'alran';
const REGISTRY_URL = `https://registry.npmjs.org/${UPDATE_CHECK_PACKAGE.replace('/', '%2f')}`;

interface UpdateCheckStamp {
  readonly checkedAtMs: number;
  readonly latestVersion: string | null;
}

export interface UpdateHintOptions {
  readonly currentVersion: string;
  readonly dataDir: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

function stampPath(dataDir: string): string {
  return path.join(dataDir, 'update-check.json');
}

function readStamp(dataDir: string): UpdateCheckStamp | null {
  try {
    const parsed = JSON.parse(readFileSync(stampPath(dataDir), 'utf8')) as Record<string, unknown>;
    if (typeof parsed.checkedAtMs !== 'number') return null;
    return { checkedAtMs: parsed.checkedAtMs, latestVersion: typeof parsed.latestVersion === 'string' ? parsed.latestVersion : null };
  } catch {
    return null;
  }
}

function writeStamp(dataDir: string, stamp: UpdateCheckStamp): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(stampPath(dataDir), `${JSON.stringify(stamp)}\n`);
  } catch {
    // A stamp that cannot be written means the next command checks again; nothing else.
  }
}

async function latestFromRegistry(fetchImpl: typeof fetch, timeoutMs: number): Promise<string | null> {
  const response = await fetchImpl(REGISTRY_URL, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { 'dist-tags'?: { latest?: unknown } };
  const latest = body['dist-tags']?.latest;
  return typeof latest === 'string' ? latest : null;
}

/** The hint to print, or null. Never throws. */
export async function resolveUpdateHint(options: UpdateHintOptions): Promise<string | null> {
  const environment = options.environment ?? process.env;
  if (/^(1|true|yes)$/iu.test(environment.ALRAN_NO_UPDATE_CHECK ?? '') || environment.CI) return null;
  const now = (options.now ?? Date.now)();
  try {
    let stamp = readStamp(options.dataDir);
    if (!stamp || now - stamp.checkedAtMs >= UPDATE_CHECK_INTERVAL_MS || now < stamp.checkedAtMs) {
      const latestVersion = await latestFromRegistry(options.fetchImpl ?? fetch, options.timeoutMs ?? 2_000);
      stamp = { checkedAtMs: now, latestVersion };
      writeStamp(options.dataDir, stamp);
    }
    if (!stamp.latestVersion) return null;
    if (compareAlranVersions(options.currentVersion, stamp.latestVersion) >= 0) return null;
    return `Alran Code ${stamp.latestVersion} is available (you have ${options.currentVersion}). Run \`alran update\`.`;
  } catch {
    return null;
  }
}
