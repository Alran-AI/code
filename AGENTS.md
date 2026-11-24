# Agent guide

This repository is the reviewed public projection of an internal monorepo, not an ordinary workspace. Every published file is listed in `release/public-source.json`, and upstream changes arrive through a three-way merge described in `docs/source-sync.md`. Moving or renaming files therefore has a cost that a normal repository does not have: it shows up as a conflict or an unreviewed new file at the next synchronization. Prefer changing content over changing layout.

## Layout

- `packages/` — first-party workspace packages. `packages/agent-modules/*` is a second level of packages, not a package itself.
- `third_party/` — vendored upstream packages (`pi-mono`, `sandbox-runtime`) with their own licenses. Their test suites are not part of this distribution's verification.
- `release/` — machine-read release contracts. `extraction.json` pins the source baseline and package scope, `public-source.json` is the file inventory, `dependency-licenses.json` records declared dependency licenses. Build, type-check, test resolution, and source checks all read from here.
- `docs/` — human-readable documentation and supporting media.
- `scripts/` — build and verification tooling. Shared constants live in `scripts/lib/`; import them instead of repeating literal paths or lists.
- `test/` — repository-level tests and `vitest-suites.json`, the declaration of every Vitest file this distribution runs.

## Generated files

Do not edit these by hand; regenerate them and commit the result.

| File | Regenerate with | Checked by |
| --- | --- | --- |
| `release/public-source.json` | `node scripts/source-inventory.mjs --write` | `pnpm check:source` |
| `tsconfig.standalone.json` (the `paths` block) | `pnpm gen:tsconfig` | `pnpm check:tsconfig` |

Review added, removed, and renamed files before regenerating the inventory: recording a file does not make it suitable for publication. Content-only edits to existing files do not require inventory regeneration. Keep private review material, verification reports, and temporary artifacts outside the repository; the inventory scans the working tree, including untracked files outside its explicit exclusions.

## Branches and source synchronization

Use a feature branch and submit a pull request; do not push directly to the default branch. See `CONTRIBUTING.md` for contribution and review requirements.

Name new branches by the purpose of the change: `feat/<short-description>` for features, `fix/<short-description>` for bug fixes, and corresponding prefixes such as `docs/`, `refactor/`, `test/`, or `chore/` for other work. Use concise English descriptions in lowercase kebab-case, for example `feat/provider-limits` or `fix/session-restore`. Do not use agent or tool names as branch prefixes, including `codex/`. Follow an explicitly requested branch name when one is provided.

Never merge internal Git history or cherry-pick internal commits into this repository. Follow `docs/source-sync.md`, keep unreviewed candidates outside the repository, and apply reviewed files individually. Advance `release/extraction.json`'s `sourceRevision` only after reviewing all differences for the selected source revision.

## Single sources of truth

| Concern | Declared in | Consumed by |
| --- | --- | --- |
| Package scope | `release/extraction.json` (`packageRoots`) | build, type-check paths, Vitest aliases, source check, source sync |
| Package export → source file | each package's `exports` via `scripts/lib/package-exports.mjs` | `tsconfig.standalone.json`, `vitest.oss.config.mjs` |
| Vitest files per gate | `test/vitest-suites.json` | `vitest.oss.config.mjs`, `scripts/run-vitest-suite.mjs` |
| Retired source paths | `scripts/lib/retired-sources.mjs` | `check:source` (must not exist), `check:standalone` (must not be bundled) |
| Verification pipeline | `scripts/verify.mjs` | GitHub CI, `pnpm verify` |
| Documentation-only classification | `scripts/ci-changes.mjs` | source verification, release audit |
| Source archive validation/extraction | `scripts/lib/source-archive.mjs` | source export, candidate validation |

## Common changes

Adding a workspace package: add it to `pnpm-workspace.yaml` and to `packageRoots` in `release/extraction.json`, then run `pnpm gen:tsconfig` and `node scripts/source-inventory.mjs --write`.

Changing package exports: run `pnpm gen:tsconfig` after adding or changing an export subpath.

Adding a Vitest file: add its path to the appropriate group in `test/vitest-suites.json`. Do not hard-code Vitest file paths in `package.json` scripts or the Vitest config. Repository-level `node:test` suites remain in their existing gates; add workflow safety and release-tool regressions to `test/source-sync.test.mjs`.

Adding a verification gate: add a step to `scripts/verify.mjs`, with `platforms` when it cannot run everywhere. Do not add steps to the workflow file.

## Verification

`pnpm verify` runs the same gates as CI in the same order; `pnpm verify --list` shows which apply on the current platform. Run it before opening a pull request. Individual gates such as `pnpm typecheck`, `pnpm build`, and `pnpm test:byok` remain available for iteration.

The full profile is the local default. `platform` omits only duplicate type checking. Use `pnpm verify --profile docs` only when every changed path qualifies under `scripts/ci-changes.mjs`; it runs source inventory, generated-path, source-export, and release-tool checks. `AGENTS.md`, bundled runtime prompts, and `release/` changes do not qualify for that profile. `archive` skips Git export for source archives; the candidate workflow authenticates the archive before invoking it. Keep profile selection in the shared verifier.

Source export reads committed `HEAD` and rejects uncommitted tracked changes. During editing, run the relevant individual gates; run the complete applicable profile on the reviewed commit with a clean tracked working tree before opening a PR. Report the checks actually run and any blocked or untested boundaries. Offline tests do not establish live-service or cross-platform acceptance.

## Boundaries

Do not reference internal hosts, generated IDL, or private services; `check:source` catches known patterns but does not replace publication review. Do not restore paths listed in `scripts/lib/retired-sources.mjs` or remove supported capabilities to make standalone checks pass. Do not commit account data, sessions, logs, credentials, or real user content; use temporary data directories and synthetic test inputs. Documentation and commit messages are written in English; preserve the required languages of localized product strings and bundled runtime prompts. See `CONTRIBUTING.md`.

## Mandatory Git delivery workflow: worktrees, branches, commits, and pull requests

This section is authoritative for Git delivery in this repository. It supersedes earlier generic Git workflow instructions only where they conflict with the mechanics below. Repository-specific architecture, security, testing, release, attribution, code-ownership, and contribution rules remain in force.

### 1. Identify the correct base branch
- Determine the repository's actual default branch from the live GitHub repository settings or \`origin/HEAD\`. Do not assume that it is named \`main\` or \`master\`, and do not rely on stale documentation when it disagrees with the live setting.
- Use the default branch as the PR base unless the repository's contribution instructions explicitly require another target.
- Fetch the latest remote state before starting: \`git fetch origin --prune\`.

### 2. One isolated worktree and task branch per task
- Every implementation or documentation task must be performed in a dedicated Git worktree on a task-specific branch.
- Create the worktree from the latest \`origin/<default-branch>\`, for example: \`git fetch origin --prune && git worktree add ../<repo>-<task-id> -b <branch-name> origin/<default-branch>\`.
- When continuing an existing PR, create a separate worktree tracking that PR's existing head branch. Do not create a duplicate PR or switch another task's worktree underneath it.
- One independent task or agent owns one worktree and one branch. Never share a worktree or branch between independent tasks.
- Follow this repository's existing branch naming convention. If none is documented, use a short prefix such as \`feat/\`, \`fix/\`, \`docs/\` or \`chore/\` followed by a lowercase kebab-case task name.

### 3. Keep the default branch read-only
- Never implement, commit, or push directly to the default branch. Treat it as the PR target only.
- Keep each branch focused on one task. Do not include unrelated work or another agent's changes.
- Stage only explicitly selected paths. Do not use \`git add -A\`, \`git add .\`, or \`git commit -a\`.
- Use meaningful commit messages and follow all repository-specific task-ID, conventional-commit, and attribution requirements.
- Push only the task branch, for example \`git push -u origin <branch-name>\`. Never force-push or rewrite shared/public branch history.

### 4. A pull request is mandatory for every change
- Every code, test, configuration, and documentation change must be delivered through a pull request against the correct base branch. Direct pushes to the default branch are prohibited.
- If an open PR already exists for the task, update its head branch and that PR instead of opening a duplicate.
- The PR description must state the problem, implementation, scope, risks, and exact validation commands with their actual results. Never claim that a check passed unless it was run and its result verified.
- Address review feedback on the same task branch. Reply to comments with the resolution and resolve a thread only after its issue is actually fixed.

### 5. Review and merge authority
- Implementation agents must not merge their own task PRs.
- The repository owner's explicitly authorized PR-maintenance automation may independently review and merge an eligible PR. It may do so only when the latest diff has been reviewed, no blocking review threads or change requests remain, every required approval is present, all required checks are green for the exact latest head SHA, the branch is mergeable, and no unresolved security or architectural blocker exists.
- Never fabricate or dismiss a required human approval, bypass branch protection, merge around failing or pending required checks, or merge a draft PR. If a repository requires a human approval, leave the PR open for that approval.

### 6. Tool and workspace safety
- Use the repository's authorized Git, worktree, and PR tooling. Never use an alternate Git binary, manipulate Git objects directly, or bypass an actual permission boundary.
- Git operations needed for the workflow are authorized only on the task worktree and task branch. Destructive operations such as \`reset --hard\`, \`clean -fd\`, and force-push remain prohibited.
- If the runtime or permissions block a required operation, stop safely and report the exact blocker; do not work around the restriction or risk another contributor's work.
- Remove a task worktree only after its work is safely pushed and the PR is merged or the task is explicitly abandoned. Never delete unmerged work.
