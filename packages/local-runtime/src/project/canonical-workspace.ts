import path from 'node:path';


import type { LocalSessionRecord } from '../sessions/controller.js';
import { validateAgentName } from '../agent/contract.js';

export const DEFAULT_PROJECT_KEY = 'default';

export function canonicalProjectWorkspaceDir(
  workspaceDir: string | undefined,
  runLocation?: LocalSessionRecord['runLocation'],
): string | undefined {
  const parentRepoDir = normalizeAbsolutePath(runLocation?.parentRepoDir);
  if (parentRepoDir) return collapseWorktreeDir(parentRepoDir);
  const normalizedWorkspace = normalizeAbsolutePath(workspaceDir);
  return normalizedWorkspace ? collapseWorktreeDir(normalizedWorkspace) : undefined;
}

export function projectKeyForWorkspace(workspaceDir: string | undefined): string {
  return workspaceDir ? `workspace:${workspaceDir}` : DEFAULT_PROJECT_KEY;
}

export interface SessionProjectProjectionDeps {
  resolveDefaultWorkspaceDir(): string;
  resolveSessionDefaultWorkspaceDir?(sessionId: string): string;
  resolveAgentInternalWorkspaceDir?(agentName: string): string | undefined;
}

export interface SessionProjectProjection {
  readonly projectKey: string;
  readonly workspaceDir?: string;
  readonly defaultReason?:
    | 'run-default-flag'
    | 'runtime-default'
    | 'session-default'
    | 'agent-default'
    ;
}

/** The single lexical Session → canonical Project projection used by Desktop and Channel. */
export function projectForSession(
  session: LocalSessionRecord,
  deps: SessionProjectProjectionDeps,
): SessionProjectProjection {
  if (session.runLocation !== undefined) {
    const workspaceDir = canonicalProjectWorkspaceDir(session.workspaceDir, session.runLocation);
    return {
      projectKey: projectKeyForWorkspace(workspaceDir),
      ...(workspaceDir ? { workspaceDir } : {}),
    };
  }
  if (session.isDefaultWorkspace === true) {
    return { projectKey: DEFAULT_PROJECT_KEY, defaultReason: 'run-default-flag' };
  }
  const workspaceDir = normalizeAbsolutePath(session.workspaceDir);
  if (workspaceDir === undefined) return { projectKey: DEFAULT_PROJECT_KEY };
  const defaultWorkspaceDir = normalizeAbsolutePath(deps.resolveDefaultWorkspaceDir());
  if (defaultWorkspaceDir !== undefined && workspaceDir === defaultWorkspaceDir) {
    return { projectKey: DEFAULT_PROJECT_KEY, defaultReason: 'runtime-default' };
  }
  const sessionDefaultWorkspaceDir = normalizeAbsolutePath(
    deps.resolveSessionDefaultWorkspaceDir?.(session.sessionId),
  );
  if (sessionDefaultWorkspaceDir !== undefined && workspaceDir === sessionDefaultWorkspaceDir) {
    return { projectKey: DEFAULT_PROJECT_KEY, defaultReason: 'session-default' };
  }
  if (
    isAgentInternalDefaultWorkspaceDir(
      session.workspaceDir,
      deps.resolveAgentInternalWorkspaceDir?.(session.agentName),
      session.agentName,
    )
  ) {
    return { projectKey: DEFAULT_PROJECT_KEY, defaultReason: 'agent-default' };
  }
  const canonical = canonicalProjectWorkspaceDir(session.workspaceDir, session.runLocation);
  return {
    projectKey: projectKeyForWorkspace(canonical),
    ...(canonical ? { workspaceDir: canonical } : {}),
  };
}

export function workspaceDirFromProjectKey(key: string | undefined): string | undefined {
  if (!key?.startsWith('workspace:')) return undefined;
  return normalizeAbsolutePath(key.slice('workspace:'.length));
}

export function projectDisplayName(workspaceDir: string | undefined): string {
  if (!workspaceDir) return 'No project selected';
  const flavor = detectPathFlavor(workspaceDir);
  return flavor.basename(workspaceDir) || workspaceDir;
}

export function normalizeAbsolutePath(value: string | undefined): string | undefined {
  const input = value?.trim();
  if (!input) return undefined;
  const flavor = detectPathFlavor(input);
  if (!flavor.isAbsolute(input)) return undefined;
  const normalized = flavor.normalize(input);
  return trimTrailingSeparators(normalized, flavor.sep);
}

/** Match the internal Agent fallback workspace without filesystem access. */
export function isAgentInternalDefaultWorkspaceDir(
  workspaceDir: string | undefined,
  currentAgentWorkspaceDir: string | undefined,
  agentName: string,
): boolean {
  try {
    validateAgentName(agentName);
  } catch {
    return false;
  }
  const workspace = normalizeAbsolutePath(workspaceDir);
  const current = normalizeAbsolutePath(currentAgentWorkspaceDir);
  if (!workspace || !current) return false;
  const workspaceFlavor = detectPathFlavor(workspace);
  const currentFlavor = detectPathFlavor(current);
  if (workspaceFlavor !== currentFlavor) return false;
  const windows = currentFlavor === path.win32;
  return pathsEqual(workspace, current, windows);
}

function collapseWorktreeDir(workspaceDir: string): string {
  const flavor = detectPathFlavor(workspaceDir);
  const root = flavor.parse(workspaceDir).root;
  const relativePath = workspaceDir.slice(root.length);
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  const markerIndex = findWorktreeMarkerIndex(parts);
  if (markerIndex === undefined) return workspaceDir;
  const parentParts = parts.slice(0, markerIndex);
  const collapsed = `${root}${parentParts.join(flavor.sep)}`;
  return trimTrailingSeparators(collapsed, flavor.sep);
}

function pathsEqual(left: string, right: string, windows: boolean): boolean {
  return windows ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function findWorktreeMarkerIndex(parts: string[]): number | undefined {
  const simpleIndex = parts.findIndex((part) => part === '.worktrees' || part === '.worktree');
  if (simpleIndex >= 0 && simpleIndex < parts.length - 1) return simpleIndex;
  for (let index = 0; index < parts.length - 2; index += 1) {
    if (parts[index] === '.claude' && parts[index + 1] === 'worktrees') return index;
  }
  return undefined;
}

function detectPathFlavor(value: string): typeof path.posix | typeof path.win32 {
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')) return path.win32;
  return path.posix;
}

function trimTrailingSeparators(value: string, sep: string): string {
  if (value === sep) return value;
  if (/^[A-Za-z]:\\$/.test(value)) return value;
  if (value.startsWith('\\\\') && /^\\\\[^\\]+\\[^\\]+\\?$/.test(value)) {
    return value.endsWith('\\') ? value.slice(0, -1) : value;
  }
  let result = value;
  while (result.length > 1 && (result.endsWith('/') || result.endsWith('\\'))) {
    result = result.slice(0, -1);
  }
  return result;
}
