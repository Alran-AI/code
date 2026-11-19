/**
 * Ports for the fix orchestrator.
 *
 * The core is GitHub-agnostic on purpose: everything it needs from the outside
 * world arrives through these interfaces. The CLI adapter implements them with
 * `gh`, `git` and the headless Alran runner; tests implement them with fakes.
 * A future GitHub App can drive the same core with its own adapters.
 */

export interface CiFixExecResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
}

export type CiFixExecRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<CiFixExecResult>;

export interface CiFixAgentRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly maxTokens: number;
  /** Declared intent of the restricted toolset; enforced by the adapter. */
  readonly allowedToolIntent: readonly string[];
}

export interface CiFixAgentResult {
  readonly ok: boolean;
  readonly diff: string;
  readonly tokensUsed: number;
  readonly costUsd?: number;
  readonly error?: string;
}

export type CiFixAgentRunner = (request: CiFixAgentRequest) => Promise<CiFixAgentResult>;

export interface CiFixGitPort {
  /** Message of the current HEAD commit. */
  readonly headMessage: () => Promise<string>;
  /** Newest-first commit messages of the current branch chain. */
  readonly commitChain: (limit: number) => Promise<readonly string[]>;
  /** Working-tree diff against HEAD. */
  readonly diff: () => Promise<string>;
  readonly commit: (subject: string, body: string) => Promise<void>;
  readonly createBranch: (name: string) => Promise<void>;
  readonly push: () => Promise<void>;
  readonly createPullRequest: (
    title: string,
    body: string,
    base: string,
    head: string,
  ) => Promise<number>;
  readonly pullRequestNumberForHead: (headSha: string) => Promise<number | undefined>;
  readonly changedFiles: () => Promise<readonly string[]>;
}

export interface CiFixReportPort {
  readonly comment: (pullRequestNumber: number, body: string) => Promise<void>;
}

export interface CiFixRateLimitPort {
  readonly runsToday: () => Promise<number>;
}

export interface CiFixPorts {
  readonly exec: CiFixExecRunner;
  readonly agent: CiFixAgentRunner;
  readonly git: CiFixGitPort;
  readonly report: CiFixReportPort;
  readonly rateLimit: CiFixRateLimitPort;
}
