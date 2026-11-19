# CI Fixer

Alran Code CI Fixer watches your GitHub workflows and repairs red CI runs
automatically: it reproduces the failure locally, runs a headless Alran Code
session with a restricted toolset, verifies that the previously failing command
passes, and only then commits and pushes the fix with a summary comment on the
pull request. Nothing is committed unless the command is green again, and a
diff guard rejects any fix that tries to make CI green by weakening it.

The feature is a GitHub Action plus a small config file. The core logic lives
in `packages/ci-fix` and is GitHub-agnostic; the `gh`/`git` adapter in
`packages/tui/src/cli/ci-ports.ts` is the only place that knows GitHub, so a
future GitHub App can reuse the same core.

## Setup in three steps

1. **Install the config and the workflow** in the repository you want to
   protect:

   ```sh
   alran ci init
   ```

   `init` detects the repository (`git remote get-url origin`), the test, lint
   and build commands (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`,
   `Makefile`) and the workflows in `.github/workflows`. It asks for the mode,
   the attempt budget and the monitored workflows, then writes:

   - `.alran/ci.yml` — the reviewed configuration
   - `.github/workflows/alran-ci-fix.yml` — the Action

   In the TUI, `/ci` opens the same setup as a wizard.

   Alran can also do this for you: ask it to "set up CI Fix" and the built-in
   `ci-fixer` skill runs the same steps, verifies them with `alran ci doctor`
   and shows the dry run before anything is committed.

2. **Store the model API key as a GitHub secret.** The key is never written to
   the repository. If `gh` is signed in, `alran ci init` sets it for you when
   `ALRAN_API_KEY` is in your environment; otherwise it prints the exact steps
   (repository Settings → Secrets → Actions → `ALRAN_API_KEY`).

3. **Commit both files and open a pull request.** The workflow activates as
   soon as it is on the default branch. `alran ci doctor` checks the whole
   setup (gh login, secret, workflow permissions, fork state, monitored
   workflows) and points at the re-trigger trade-off below.

The PR comment includes a collapsed block with the masked failure log, and the
Action run writes the same summary to the GitHub step summary, so the outcome
is visible without opening the PR. The diff guard also inspects the pre-change
path: renames out of protected paths and deletions of protected files are
rejected like any other edit.

## Configuration (`.alran/ci.yml`)

```yaml
version: 1
trigger: { workflows: ["CI"] }
mode: { pull_request: push-to-branch, main: fix-pr }
limits: { max_attempts: 2, max_diff_lines: 300, timeout_minutes: 15, max_runs_per_day: 10, max_tokens: 200000 }
guards: { deny_paths: [".github/workflows/**", ".alran/ci.yml", "**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.p12", "**/secrets/**"], forbid_test_weakening: true }
model: { base_url: "https://ai.ottili.one/v1", name: "ottili/werk-1.1", api_key_secret: "ALRAN_API_KEY" }
```

`alran ci status` prints the effective configuration, the detected commands and
the number of fix commits in the recent history. `alran ci disable` sets
`enabled: false` and removes the workflow.

## Modes

| Context | Mode | Behavior |
| --- | --- | --- |
| Pull request | `push-to-branch` (default) | Commit the verified fix onto the PR branch (same repository only). |
| Pull request | `fix-pr` | Open a separate pull request against the failing branch. |
| Pull request | `comment-only` | Verify and report; never commit. |
| Main branch | `fix-pr` (default) | Open a pull request against the main branch. |
| Main branch | `push` | Push directly — explicit opt-in, respects branch protection. |
| Main branch | `comment-only` | Verify and report; never commit. |

## Limits

- `max_attempts` (default 2): fix attempts per failure chain. The counter spans
  the whole commit chain, so a later feature commit cannot reset the budget.
- `max_diff_lines` (default 300): larger diffs are rejected with a comment.
- `timeout_minutes` (default 15): budget for reproduction, the agent run and
  verification.
- `max_runs_per_day` (default 10): runs of the CI Fix workflow per day.
- `max_tokens` (default 200000): token budget handed to the headless run. A run
  that reports more tokens than the budget is stopped without a commit and
  leaves a comment.

On any limit the run stops without a commit and leaves a comment explaining
why.

## Security model

- **Forks are never touched.** The workflow checks out `head_sha` from the same
  repository only, and the core refuses any run whose head repository differs
  from the repository under repair. `pull_request_target` is never used.
- **Minimal permissions.** The installed workflow declares exactly
  `contents: write`, `pull-requests: write` and `actions: read`.
- **Protected paths.** `.github/workflows/**`, `.alran/ci.yml` and
  secret-shaped files (`.env*`, `*.pem`, `*.key`, `secrets/**`, …) can never be
  changed by the fix agent; extend the list in `guards.deny_paths`.
- **Anti-weakening diff guard.** Every proposed diff is checked before it can
  be committed. The guard rejects deleted test files, removed tests,
  skip/only markers (`it.skip`, `xit`, `@pytest.mark.skip`, `@Ignore`,
  `QSKIP`, …), softened or trivial assertions, lowered coverage/lint
  thresholds, dropped coverage collection and disabled checks
  (`continue-on-error`, `|| true`, `set +e`, `exit 0`, `-DskipTests`, emptied
  test scripts). A rejected fix is never committed; the comment explains the
  violation.
- **Loop protection.** Commits created by the fixer carry `[alran-ci-fix]` in
  the body. A head commit with the marker never triggers another fix, and the
  attempt budget counts marker commits across the chain.
- **Prompt injection.** CI logs, PR text, commit messages and file contents are
  data, never instructions. The CI system prompt states this explicitly, the
  headless run has no web search or web fetch, and the diff guard is the hard
  enforcement behind the policy. Commands extracted from CI logs are only
  executed when they are plain project commands (`isSafeProjectCommand`);
  anything with shell metacharacters is ignored in favor of the configured
  test command.

### Known limits

- The restricted toolset is a policy layer (prompt plus the absence of web
  credentials); the diff guard and the protected paths are the hard gates.
- `max_runs_per_day` counts workflow runs via `gh`; when `gh` is unavailable
  the count fails open (0) instead of blocking.
- The fix agent runs with `permission: full` in a throwaway CI checkout; it is
  not a sandbox.

## The re-trigger problem

Pushes made with the default `GITHUB_TOKEN` do not start new workflow runs — a
deliberate GitHub protection against loops. That means a fix pushed with the
default token leaves the last CI result red until something re-runs it. Three
options, in order of fidelity:

1. **`ALRAN_CI_PUSH_TOKEN` secret** (a PAT or GitHub App token with `contents:
   write`): the fix push authenticates with it, and the monitored workflow runs
   again on the fix commit. Highest fidelity, one more secret to manage.
2. **`workflow_dispatch` fallback**: without the token, the fixer dispatches
   the monitored workflows on the fix branch (`gh workflow run <workflow> --ref
   <branch>`). The installed workflow therefore declares `workflow_dispatch`
   and runs the same job on manual dispatch. This exercises the jobs but not
   the push event, so push-only paths stay untested.
3. **Nothing**: the run ends with a green verification and a comment; the next
   real push re-runs CI normally.

`alran ci doctor` reports which of the three applies. When the Action runs
without `ALRAN_CI_RUN_ID` (a manual dispatch), the fixer falls back to the
latest failed run of the first monitored workflow for its logs.

## Costs

One CI Fix run is one headless agent session: reproduction, a bounded fix
attempt and verification. With the default budget that is at most two attempts
per failure chain and ten runs per day; `max_tokens` caps a single run. The PR
comment reports the tokens used and the estimated cost of every run. The model
is configurable (`model.name`, `model.base_url`) for any OpenAI-compatible
endpoint; the API key only ever lives in the GitHub secret named by
`model.api_key_secret`.

## Local dry run

```sh
export ALRAN_API_KEY=...
alran ci fix --dry-run
```

`--dry-run` reproduces the failing command, runs the fix, verifies it and
prints the diff. It never commits, pushes or comments — a useful rehearsal
before the Action does it for real.

## Phase 2 ideas

- Hosted GitHub App that installs without a workflow file in the repository.
- Review comments on code the fixer did not write (cross-PR review).
- Auto-merge for low-risk fix classes.
- Multi-repository dashboard for teams running the fixer at scale.