// Stored Ottili Platform session credentials.
//
// `alran login` completes an OpenID Connect sign-in against the Platform and
// stores the resulting Platform session locally. The Platform gateway accepts
// that session id as an `Authorization: Bearer` credential, so nothing else has
// to be minted: the session the user signed in with is the credential the
// model calls use, and revoking it in Keycloak revokes model access.
//
// The session file is per environment so a development sign-in can never leak
// into production model traffic.

import fs from 'node:fs';
import path from 'node:path';

import { getRuntimeBuildEnv, type AlranBuildEnv } from './config.js';
import { writePrivateConfigFileSync } from './private-config-file.js';

export type PlatformEnvironment = 'dev' | 'prod';

/**
 * The Platform a build signs in to. Only a production build talks to the real
 * `ottili.one` endpoints; development, test, and staging builds stay on the
 * local Platform.
 */
export function resolvePlatformEnvironmentForBuild(
  buildEnv: AlranBuildEnv = getRuntimeBuildEnv(),
): PlatformEnvironment {
  return buildEnv === 'prod' ? 'prod' : 'dev';
}

export interface StoredPlatformSession {
  readonly sessionId: string;
  readonly companyId: string;
  readonly subjectId: string;
  readonly platformEnv: PlatformEnvironment;
  readonly baseUrl: string;
  readonly storedAtMs: number;
}

/** Directory that holds the Platform sessions of one data dir. */
export function platformSessionDir(dataDir: string, platformEnv: PlatformEnvironment): string {
  return path.join(dataDir, 'auth', 'platform', platformEnv);
}

export function platformSessionPath(
  dataDir: string,
  platformEnv: PlatformEnvironment,
): string {
  return path.join(platformSessionDir(dataDir, platformEnv), 'platform-session.json');
}

/** Read one stored Platform session; `null` when absent or unreadable. */
export function readStoredPlatformSession(
  dataDir: string,
  platformEnv: PlatformEnvironment,
): StoredPlatformSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(platformSessionPath(dataDir, platformEnv), 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : '';
  if (!sessionId) return null;
  return {
    sessionId,
    companyId: typeof record.companyId === 'string' ? record.companyId : '',
    subjectId: typeof record.subjectId === 'string' ? record.subjectId : '',
    platformEnv,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
    storedAtMs: typeof record.storedAtMs === 'number' ? record.storedAtMs : 0,
  };
}

/** Remove one stored Platform session. Missing files are not an error. */
export function clearStoredPlatformSession(
  dataDir: string,
  platformEnv: PlatformEnvironment,
): void {
  try {
    fs.rmSync(platformSessionPath(dataDir, platformEnv), { force: true });
  } catch {
    // Signing out locally must not fail on an already-unreadable session file.
  }
}

/** The environments a build might have signed in to, least trusted last. */
export function platformEnvironmentOrder(preferred: PlatformEnvironment): PlatformEnvironment[] {
  return preferred === 'prod' ? ['prod', 'dev'] : ['dev', 'prod'];
}

/**
 * The session the model calls should use: the one for `preferred`, else any
 * stored session. Returning a session from the other environment is
 * deliberate — a developer who signed in to the local Platform should still
 * get model access, and the gateway URL follows the session's environment.
 */
export function resolveStoredPlatformSession(
  dataDir: string,
  preferred: PlatformEnvironment,
): StoredPlatformSession | null {
  for (const platformEnv of platformEnvironmentOrder(preferred)) {
    const session = readStoredPlatformSession(dataDir, platformEnv);
    if (session) return session;
  }
  return null;
}

/**
 * Write one Platform session, readable by the owner only (0600, in a 0700 directory).
 *
 * The session id is a bearer credential for the Platform and for the AI gateway, so it is stored
 * like one. `extra` keeps fields a writer added (`via`) that this module does not interpret.
 */
export function writeStoredPlatformSession(
  dataDir: string,
  platformEnv: PlatformEnvironment,
  session: Omit<StoredPlatformSession, 'platformEnv' | 'storedAtMs'> & { readonly storedAtMs?: number },
  extra: Record<string, unknown> = {},
): void {
  const dir = platformSessionDir(dataDir, platformEnv);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(dir, 0o700); } catch { /* a directory we cannot tighten is still written to */ }
  }
  const document = {
    ...extra,
    sessionId: session.sessionId,
    companyId: session.companyId,
    subjectId: session.subjectId,
    baseUrl: session.baseUrl,
    storedAtMs: session.storedAtMs ?? Date.now(),
  };
  writePrivateConfigFileSync(platformSessionPath(dataDir, platformEnv), `${JSON.stringify(document, null, 2)}\n`);
}

/** The CLI's per-company choices that are not part of the session: the current project. */
export interface OttiliAccountPreferences {
  readonly version: 1;
  /** company id -> project id the CLI works in (sent as `x-ottili-project`). */
  readonly projects: Readonly<Record<string, string>>;
}

export function ottiliAccountPreferencesPath(dataDir: string): string {
  return path.join(dataDir, 'auth', 'platform', 'account.json');
}

export function readOttiliAccountPreferences(dataDir: string): OttiliAccountPreferences {
  try {
    const parsed = JSON.parse(fs.readFileSync(ottiliAccountPreferencesPath(dataDir), 'utf8')) as Record<string, unknown>;
    const projects: Record<string, string> = {};
    const raw = parsed?.projects;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [company, project] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof project === 'string' && project.trim()) projects[company] = project.trim();
      }
    }
    return { version: 1, projects };
  } catch {
    return { version: 1, projects: {} };
  }
}

/** Set (or with `null`, clear) the project of one company. */
export function writeOttiliProjectPreference(dataDir: string, companyId: string, projectId: string | null): void {
  const current = readOttiliAccountPreferences(dataDir);
  const projects: Record<string, string> = { ...current.projects };
  if (projectId) projects[companyId] = projectId;
  else delete projects[companyId];
  const file = ottiliAccountPreferencesPath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writePrivateConfigFileSync(file, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
}

