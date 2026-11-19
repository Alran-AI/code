/**
 * GitHub repository reference detection.
 *
 * `alran ci init` reads `git remote get-url origin` and turns it into an
 * `owner/repo` pair. Only GitHub remotes are accepted; everything else (a
 * self-hosted GitLab, a local path) fails with a clear "not GitHub" result so
 * the CLI can print next steps instead of a crash.
 */

export interface GitHubRepoRef {
  readonly owner: string;
  readonly repo: string;
  /** Full name in GitHub's `owner/repo` form. */
  readonly fullName: string;
}

const GITHUB_HOST = /^github\.com$/iu;
const OWNER_REPO = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/u;

/** True when both references name the same GitHub repository. */
export function sameGitHubRepo(a: GitHubRepoRef, b: GitHubRepoRef): boolean {
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();
}

/**
 * Parses a git remote URL into an owner/repo reference. Accepts the https,
 * ssh, git:// and scp-like forms GitHub emits; returns undefined for anything
 * that is not github.com or is not shaped like owner/repo.
 */
export function parseGitHubRemote(input: string): GitHubRepoRef | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;

  let candidate: string;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(trimmed)) {
    // A real URL: https, ssh, git.
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return undefined;
    }
    if (!GITHUB_HOST.test(url.hostname.replace(/^www\./u, ''))) return undefined;
    candidate = url.pathname.replace(/^\/+/u, '');
  } else {
    // scp-like syntax: git@github.com:owner/repo.git or github.com:owner/repo.
    const scp = /^([^@]+@)?([^:]+):(.+)$/u.exec(trimmed);
    if (!scp) return undefined;
    if (!GITHUB_HOST.test(scp[2])) return undefined;
    candidate = scp[3];
  }

  const match = OWNER_REPO.exec(candidate);
  if (!match) return undefined;
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) return undefined;
  return { owner, repo, fullName: `${owner}/${repo}` };
}
