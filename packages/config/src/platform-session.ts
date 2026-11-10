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
