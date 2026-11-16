import path from 'node:path';


import type { SessionRunLocation } from '../sessions/repo/contract.js';
import { normalizeAbsolutePath, pathFlavor } from './path-normalization.js';
import { collapseWorktreePath } from './worktree-path.js';

export function canonicalProjectWorkspaceDir(
  workspaceDir: string | undefined,
  runLocation?: Pick<SessionRunLocation, 'parentRepoDir'>,
): string | undefined {
  const parentRepoDir = normalizeAbsolutePath(runLocation?.parentRepoDir);
  if (parentRepoDir) return collapseWorktreePath(parentRepoDir);
  const normalizedWorkspaceDir = normalizeAbsolutePath(workspaceDir);
  return normalizedWorkspaceDir ? collapseWorktreePath(normalizedWorkspaceDir) : undefined;
}

/**
 * Recognize the historical runtime-owned `<dataDir>/sessions/<sessionId>/workspace`
 * execution directory without depending on the dataDir's symlink or profile name.
 */
export function isSessionDefaultWorkspaceDir(
  workspaceDir: string | null | undefined,
  sessionId: string,
): boolean {
  if (!sessionId || /[\\/]/u.test(sessionId)) return false;
  const normalized = normalizeAbsolutePath(workspaceDir ?? undefined);
  if (!normalized) return false;
  const windows = /^[A-Za-z]:[\\/]/u.test(normalized) || normalized.startsWith('\\\\');
  const parts = normalized.split(windows ? /[\\/]+/u : /\/+/u).filter(Boolean);
  const samePart = (value: string | undefined, expected: string): boolean =>
    value !== undefined &&
    (windows ? value.toLowerCase() === expected.toLowerCase() : value === expected);
  return (
    samePart(parts.at(-1), 'workspace') &&
    samePart(parts.at(-2), sessionId) &&
    samePart(parts.at(-3), 'sessions')
  );
}

/** Match current and historical internal Agent fallback workspaces without filesystem access. */
export function isAgentInternalDefaultWorkspaceDir(
  workspaceDir: string | undefined,
  currentAgentInternalWorkspaceDir: string | undefined,
  agentName: string,
): boolean {
  if (!isValidAgentWorkspaceName(agentName)) return false;
  const paths = normalizeAgentWorkspacePaths(workspaceDir, currentAgentInternalWorkspaceDir);
  if (!paths) return false;
  const currentFlavor = pathFlavor(paths.current);
  if (pathFlavor(paths.workspace) !== currentFlavor) return false;
  const windows = currentFlavor === path.win32;
  return pathsEqual(paths.workspace, paths.current, windows);
}

function isValidAgentWorkspaceName(agentName: string): boolean {
  return agentName.trim().length > 0 && !/[\\/]/u.test(agentName);
}

function normalizeAgentWorkspacePaths(
  workspaceDir: string | undefined,
  currentAgentInternalWorkspaceDir: string | undefined,
): { readonly workspace: string; readonly current: string } | undefined {
  const workspace = normalizeAbsolutePath(workspaceDir);
  const current = normalizeAbsolutePath(currentAgentInternalWorkspaceDir);
  return workspace && current ? { workspace, current } : undefined;
}

function pathsEqual(left: string, right: string, windows: boolean): boolean {
  return windows ? left.toLowerCase() === right.toLowerCase() : left === right;
}
