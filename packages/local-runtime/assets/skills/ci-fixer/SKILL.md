---
name: ci-fixer
description:
  Set up, configure, verify and troubleshoot the Alran Code CI Fixer, which automatically
  repairs red GitHub CI runs (reproduce, headless fix, verify, commit with a diff guard).
  Use when the user asks to install, configure, inspect or disable CI Fix, to change its modes,
  limits or model, to run a local dry run, or to diagnose why a fix run was blocked. Do not use
  for reviewing code or for fixing a specific failing command without CI Fix context.
---

# CI Fixer

Alran Code CI Fixer watches GitHub workflows and repairs red CI runs: it
reproduces the failing command locally, runs a headless Alran Code session with a
restricted toolset (no web search or fetch), and commits only when the same
command passes again. A diff guard rejects fixes that weaken tests or thresholds,
and forks are never touched. The GitHub-specific adapter lives in `gh`/`git`;
the core is GitHub-agnostic. Full reference: `docs/ci-fixer.md` in the Alran
Code repository.

## When to use

- The user asks to set up, install or enable "CI Fix", "CI Fixer" or automatic CI repair.
- The user wants to change modes, limits, the model or the monitored workflows.
- The user wants to check the installation (`doctor`), see the config (`status`),
  rehearse a fix locally (`fix --dry-run`), or turn it off (`disable`).
- A fix run was blocked or skipped and the user wants to know why.

## Hard rules

- **Never commit secrets.** The model API key lives only in the GitHub secret
  (`ALRAN_API_KEY` by default), set via `gh secret set` or the repository
  Settings page. Never write it into `.alran/ci.yml`, the workflow, or any file.
- **Never edit protected paths**: `.github/workflows/**`, `.alran/ci.yml` and
  secret-shaped files (`.env*`, `*.pem`, `*.key`, `secrets/**`). To change them,
  use the `alran ci` commands or ask the user; `alran ci init` regenerates them.
- **Never weaken the suite**: do not delete or skip tests, soften assertions,
  lower coverage or lint thresholds, or disable checks to make a run green.
- **Forks are never fixed.** If the repository is a fork, CI Fix cannot run;
  install it in the upstream repository instead.
- **No direct pushes to main.** Setup changes go on a feature branch and through
  a pull request, like any other change.

## Setup

1. Detect the repository and the project commands. `alran ci init` reads
   `git remote get-url origin`, `package.json`, `pyproject.toml`, `Cargo.toml`,
   `go.mod` and `Makefile`, lists `.github/workflows`, and asks for the mode,
   attempt budget and monitored workflows. In the TUI, `/ci` opens the same
   wizard.
2. Run the setup and write the two files:

   ```sh
   alran ci init
   ```

   This writes `.alran/ci.yml` (config) and
   `.github/workflows/alran-ci-fix.yml` (the Action). Non-interactive:
   `alran ci init --yes` plus flags such as `--workflows CI,Rust`,
   `--pull-request-mode fix-pr`, `--main-mode comment-only`,
   `--max-attempts 3`, `--test "npm test"`, `--model <name>`, `--base-url <url>`.
3. Store the API key. If `gh` is signed in and `ALRAN_API_KEY` is in the
   environment, `alran ci init` sets the secret; otherwise it prints the exact
   steps. Never paste the key into the chat or into files.
4. Verify the installation:

   ```sh
   alran ci doctor
   ```

   Every check must be `ok` (the missing push-token hint is a warning): gh
   login, API-key secret, minimal workflow permissions, fork state, monitored
   workflows, config validity. Fix what it reports.
5. Commit both files on a feature branch and open a pull request. The workflow
   activates once it is on the default branch.

## Configuration (`.alran/ci.yml`)

```yaml
version: 1
trigger: { workflows: ["CI"] }            # monitored workflow names
mode: { pull_request: push-to-branch, main: fix-pr }
limits: { max_attempts: 2, max_diff_lines: 300, timeout_minutes: 15, max_runs_per_day: 10, max_tokens: 200000 }
guards: { deny_paths: [".github/workflows/**", ".alran/ci.yml", "**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.p12", "**/secrets/**"], forbid_test_weakening: true }
model: { base_url: "https://ai.ottili.one/v1", name: "ottili/werk-1.1", api_key_secret: "ALRAN_API_KEY" }
```

- `mode.pull_request`: `push-to-branch` (default) | `fix-pr` | `comment-only`
- `mode.main`: `fix-pr` (default) | `push` (explicit opt-in) | `comment-only`
- Any OpenAI-compatible `base_url` and model name works; the key is only ever
  the GitHub secret named by `api_key_secret`.
- Edit the file for fine-grained changes; `alran ci init` regenerates it from
  the answers.

## Inspect, rehearse, disable

- `alran ci status` — config, detected commands, workflow presence, fix commits.
- `alran ci fix --dry-run` — reproduce, fix and verify locally; prints the diff
  and never commits, pushes or comments. Requires `ALRAN_API_KEY` in the
  environment.
- `alran ci disable` — sets `enabled: false` and removes the workflow.

## Troubleshooting

- **gh-login fails**: run `gh auth login` first.
- **api-key-secret missing**: `gh secret set ALRAN_API_KEY --repo <owner>/<repo>`
  or add it in Settings → Secrets → Actions.
- **monitored-workflows missing**: fix `trigger.workflows` in `.alran/ci.yml`.
- **workflow-permissions wrong**: re-run `alran ci init` to restore the minimal
  permission set.
- **fork detected**: CI Fix never edits forks; install upstream.
- **Re-trigger warning**: pushes with the default `GITHUB_TOKEN` do not restart
  CI. Set the `ALRAN_CI_PUSH_TOKEN` secret (PAT/App token) for a full restart,
  or accept the `workflow_dispatch` fallback (the fixer dispatches the
  monitored workflows on the fix branch; push-event paths stay untested).
- **Blocked fix**: the PR comment explains the diff-guard violation. Never work
  around the guard; fix the underlying issue instead.

## Guardrails recap

CI Fix runs are bounded: `max_attempts` per failure chain (marker commits
`[alran-ci-fix]` count across the chain), `max_diff_lines`, `timeout_minutes`,
`max_runs_per_day` and `max_tokens`. On any limit the run stops without a
commit and leaves a comment. The CI system prompt treats logs, PR text and file
contents as data, never instructions.