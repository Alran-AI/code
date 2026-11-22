# alran Code — Ultra Mode (Spec v1.1, CLI first)

Status: draft v1.1, 2026-11-19 · Owner: Willi · Scope: alran Code CLI.
IDE extension and cloud runs are out of scope for now (see §15 for ideas).

> **Implementation status lives in [ultra.md](ultra.md)**, not here. This file is
> the design record: it says what Ultra is for and why each rule exists. Where the
> two disagree, the code and `ultra.md` describe what shipped and this file
> describes the intent — a difference worth resolving in a change, not in silence.

---

## 0. Name

**Ultra** (decided by Willi, 2026-11-19).

- Public name: **Ultra**. CLI: `alran ultra`. TUI: `/ultra`. Branches
  `ultra/<run-id>`, state directory `.alran/ultra/`.
- Naming caution (open decision O-1): "Ultra" is a generic word, but Anthropic's
  Claude Code uses the compound names Ultracode, Ultraplan and Ultrareview, and
  other open-source projects use "ultracode". Therefore do **not** use those
  compound names for our commands or marketing. Use plain descriptions instead:
  "plan-only mode" (`alran ultra plan`) and "review fleet" (`alran ultra review`,
  later).
- Considered and rejected: Schwarm (sounds like "Schwan"), Orkan.
- Trademark/domain check for "Ultra" in the context of developer tools is still
  open (O-1) and should be done before a public announcement. (Willi: not a
  priority.)

## 1. Purpose and non-goals

**Purpose.** Run tasks that are too big for one agent loop (codebase-wide
migrations, bug hunts, refactors, test generation, audits, and — with the
goal-driven loop of §13 — building large features or whole applications) as a
planned, parallel, *verified* workflow, and hand back a ready branch plus an
honest report. Runs may be expensive and long; that is by design, bounded by
budget and time limits.

**Non-goals (now).** No cloud/background runs. No auto-merge into `main`. No
auto-push. No free-form model-written orchestration scripts (recipes first). No
IDE UI.

**Design principles.**

1. **Evidence over claims.** A work packet is done only when its gate commands
   exit 0 and the verifier passes. The worker's own statement counts for nothing.
   (Lesson from MEE/GERMO: commit volume ≠ quality.)
2. **Green tests are not "done".** Done means the acceptance criteria of the goal
   document (§13) are met with evidence.
3. **Strong brain on top, cheap muscle below.** Planner/critic/verifier/acceptor
   may use a stronger model; workers default to Werk.
4. **Bounded.** Hard budget, hard concurrency cap, hard repair cap, round cap,
   optional wall-clock cap.
5. **Resumable.** Every step is in a ledger; a crash or pause loses nothing.
6. **`main` is untouchable.** All work lands on `ultra/<run-id>`; the human
   merges.

## 2. CLI surface

```bash
alran ultra "<task>"                       # plan → (confirm) → execute
alran ultra plan "<task>"                  # plan only, no execution
alran ultra "<task>" --recipe migrate --budget 3 --workers 4 --yes
alran ultra status [run-id]
alran ultra runs                            # every run on disk, newest first
alran ultra pause|kill <run-id>             # stop a running run at its next safe point
alran ultra resume <run-id> [--budget N]   # resume, optionally with a raised budget
alran ultra report <run-id>
alran ultra diff [run-id]                   # what the run produced
alran ultra review [run-id]                 # review fleet (§14)
```

TUI: `/ultra <task>` with the same flags.

| Flag | Default | Meaning |
|---|---|---|
| `--recipe` | auto | `migrate`, `bughunt`, `refactor`, `testgen`, `audit` |
| `--budget` | 2.0 (USD) | hard cap; `none` = no cap (explicit opt-in; `--max-rounds` and `--max-hours` still apply) |
| `--workers` | 4 (max 8) | max parallel workers |
| `--max-repairs` | 2 | repair attempts per packet |
| `--max-rounds` | 10 | max rounds of the outer loop (§13.3); `0` = unlimited |
| `--max-hours` | 0 (off) | optional wall-clock cap |
| `--yes` | off | skip the confirmation step (budget cap still applies) |
| `--base` | current HEAD | commit to branch from |
| `--stash` | off | allow start on a dirty tree by snapshotting it |
| `--reviewers` | 3 (max 8) | lenses in the review fleet (§14) |

The confirmation step shows the plan and goal document (§13.1). A cost preview in
the confirmation is **open (O-7)**; the live cost counter is always shown.

## 3. Pipeline

Single round:

```
SCOPE → PLAN → EXECUTE (per packet: WORKER → GATE → VERIFIER → REPAIR*) → INTEGRATE → REPORT
```

Goal-driven run (§13): the PLAN→INTEGRATE part repeats in rounds, with an ACCEPT
and GAP-ANALYSIS step after each integrate, until the goal document is satisfied
or a stop condition hits.

### 3.1 Scope check

Cheap routing call: does the task justify Ultra? If not, say so and fall back to
the normal agent. Also refuses to start on a dirty tree unless `--stash` is given.

### 3.2 Plan

- 3 **explorers** (read-only, parallel): structure/dependencies, tests/build
  commands, risk areas.
- 1 **planner**: produces the goal document (§13.1) and the packet DAG, sized to
  the budget (§13.6).
- 1 **critic**: checks packet boundaries, missing dependencies, overlapping
  scopes, unverifiable acceptance criteria.
- Output `plan.json` (DAG of packets) and `goal.json`. The harness validates the
  schema and refuses plans where two parallel packets have overlapping `scope`.
- Gate commands are **auto-detected** from the repo (package.json, pyproject,
  Cargo.toml, Makefile …) and shown in the plan; the user can edit them before
  execution.

### 3.3 Execute

- Each packet runs in its own **git worktree** on branch `ultra/<run>-<packet>`.
  (A packet branch must be a *sibling* of the run branch, not a child: git stores
  a ref as a file, so `ultra/<run>/<packet>` would make the run branch
  `ultra/<run>` impossible to create at all.)
- The scheduler starts packets whose dependencies are `done`, up to `--workers`.
- Worker prompt is self-contained: goal, scope, readonly paths, acceptance
  commands, constraints. Nothing else leaks in.
- **Scope enforcement:** after the worker stops, the harness diffs the worktree.
  Any change outside `scope`, or inside `readonly` (this includes the spec tests
  of §13.2), ⇒ packet rejected, worktree reset, restarted with a violation note
  (counts as a repair).

### 3.4 Gate (no LLM)

The CLI itself runs every `accept` command in the packet worktree. Exit code
decides. Output is stored. Fail ⇒ repair loop (worker gets the failing output),
max `--max-repairs`, then `blocked`.

### 3.5 Verifier (LLM, separate agent)

Reads packet goal + diff + gate output and answers a fixed checklist:

- Does the diff do what the goal says, and only that?
- Fake-fix patterns: deleted or skipped tests, loosened assertions, swallowed
  errors, hard-coded expected values, mocks replacing real logic?
- Obvious side effects outside the scope's intent?

Verdict: `pass` | `fail(reasons)`. A `fail` triggers a repair like a gate failure.
Verifier should be a different model or at least a fresh context from the worker.
A cheap diff-guard pre-check (`@alran/ci-fix`) runs before the LLM verifier.

### 3.6 Integrate

- Merge agent merges `done` packets into `ultra/<run>` in dependency order,
  resolves conflicts.
- Full suite (project-wide gate commands) must pass.
- Final review pass over the combined diff (same checklist as verifier, plus
  cross-packet consistency).
- In a single-round run, only this step may set the run to `succeeded` (or
  `partial` if packets are blocked). In a goal-driven run, `succeeded`
  additionally requires the acceptance result of §13.2.

### 3.7 Report

`report.md`: goal, result (`succeeded` / `partial` / `failed` / `stalled`), packet
table with status, criteria table with evidence (goal-driven runs), diff stats,
gate evidence, blocked packets with reasons, cost (tokens and USD per role and per
round), and the exact merge command for the human.

## 4. Data model

### 4.1 Packet

```json
{
  "id": "p3",
  "round": 1,
  "title": "Scheduler: lock around queue access",
  "goal": "…",
  "criteria": ["C2"],
  "scope": ["src/scheduler/**"],
  "readonly": ["src/types/**", "tests/spec/**"],
  "depends_on": ["p1"],
  "accept": [
    { "cmd": "pnpm test src/scheduler", "must": "exit0" },
    { "cmd": "pnpm tsc --noEmit", "must": "exit0" }
  ],
  "max_repairs": 2,
  "est_tokens": 120000,
  "status": "pending"
}
```

Packet status: `pending → running → gating → verifying → done` or `repairing`,
`blocked`, `skipped` (a dependency is blocked), `cancelled`.

### 4.2 Run state

Run status: `planning → awaiting_confirm → running → paused → integrating →
accepting → succeeded | partial | failed | killed | stalled`.
Within `running`, a goal-driven run cycles through round phases: `executing →
integrating → accepting → analyzing`.

### 4.3 Files

```
.alran/ultra/<run-id>/
  plan.json
  goal.json                 # goal document: criteria, priorities, status, evidence (§13.1)
  state.json                # for resume
  ledger.jsonl              # every step: role, model, tool calls, tokens, cost, timestamps
  notes.md                  # curated run memory written by integrate (§13.5)
  rounds/<n>/               # per round: plan delta, acceptance report, gap analysis
  packets/<id>/             # prompt, transcript, diff, gate output, verifier verdict
  report.md
.alran/worktrees/<run-id>/<id>/
```

`.alran/` must be git-ignored by default (already implemented: `.alran/.gitignore`
is written on first run, never overwriting a user file).

## 5. Config

```toml
[ultra]
planner      = "ottili/werk-1.1"
critic       = "ottili/werk-1.1"
worker       = "ottili/werk-1.1"
verifier     = "ottili/werk-1.1"   # prefer a different model than worker
merger       = "ottili/werk-1.1"
acceptor     = "ottili/werk-1.1"   # §13.2; prefer the strongest configured model
spec_tester  = "ottili/werk-1.1"   # §13.2; must differ in context from workers
workers      = 4
max_workers  = 8
budget_usd   = 2.0
max_repairs  = 2
backoff_429  = true

[ultra.loop]
max_rounds     = 10
stall_rounds   = 2       # stop as `stalled` if no criterion improved for this many rounds
audit_every    = 3       # interim audit every N rounds (§13.4)
max_hours      = 0       # 0 = off
```

BYOK models (e.g. a Claude model) can be set per role. Recommended split for
quality: stronger model for `planner`, `critic`, `verifier`, `acceptor`.

## 6. Guardrails

| Area | Rule |
|---|---|
| Budget | warn at 80 %, **pause** at 100 % (not kill) so `resume` works; per-role cost shown live; `resume --budget N` raises the cap |
| Concurrency | cap per `--workers`; on HTTP 429 the scheduler reduces parallelism and backs off, never crashes |
| Git | no `git push`, no remote writes by workers; `main` untouched; dirty tree refused |
| Tools | workers get local tools only (files, shell inside worktree); network tools off by default |
| Success | only INTEGRATE/ACCEPT can set `succeeded`; a packet is `done` only after gate **and** verifier |
| Failure | blocked packet ⇒ dependents `skipped`; independent packets continue; report lists everything honestly |
| Kill | `kill` stops workers, keeps worktrees and ledger for inspection. A stop request from another process reaches the driver through its own file, because the run's state belongs to the driver |
| Secrets | `.env*` and key files are in `readonly`/denylist by default; ledger redacts secret-looking strings |
| Long runs | round cap, stagnation stop, optional wall-clock cap; budget `none` is explicit opt-in |

### 6.1 Stopping a run

`pause` and `kill` are commands in one process; the run is another. The run's
`state.json` belongs to the process that drives the run, so a second process
cannot stop it by writing that file — the driver would overwrite the change
with its next save. The request therefore travels through a file of its own,
and the driver reads it at its next safe point: between packets, and before a
repair is spent. A run with no driver behind it gets its state changed
straight away, so `pause` on a run whose process died still means what it says.

Two rules follow from that:

- **A stopped pass is not integrated.** The packets that did not run are still
  to do. Merging them would spend the budget a pause was protecting and write
  a verdict over a run that is waiting to be resumed.
- **An interrupted worker is not a failure.** A worker cut short by Ctrl+C did
  not fail on its own work, so it does not spend a repair; the packet is redone
  by the resume. The same Ctrl+C leaves the run `paused` rather than `running`
  with nobody behind it — a state the resume refuses, which would strand the
  work until somebody edited the state by hand.

## 7. TUI board

```
ULTRA run-8f2a  ▸ Round 2 · Execute   $0.84 / $2.00     06:12
 Goal: 5/9 criteria met (3 must, 2 should open)
 ✅ p1 Extract types              gate ok · verified
 ✅ p2 Client wrapper             gate ok · verified
 🔧 p3 Scheduler lock    [repair 1/2]
 ⏳ p4 Call sites A–F    (waits for p2)
 ⛔ p5 Legacy adapter    blocked: tsc errors
 [p]ause [k]ill [+/-] workers [d]iff [l]og [g]oal [r]eport
```

## 8. Recipes (v1)

Markdown with YAML frontmatter (decomposition rules, default gates, verifier
checklist additions, default criteria templates). Later distributable through the
Alran Store as skills.

| Recipe | Decomposition | Extra verifier checks |
|---|---|---|
| `migrate` | by module/directory; shared types first | no leftover old-API calls (grep gate) |
| `bughunt` | by suspect module; each packet must first **reproduce** (failing test) then fix | reproducing test existed and now passes |
| `refactor` | extract → move → rewire in dependency order | behavior unchanged, tests untouched unless justified |
| `testgen` | by untested module | tests assert real behavior, no tautologies, mutation sanity check optional |
| `audit` | by area (auth, input handling, deps, secrets) | read-only; report only, no edits |

## 9. Acceptance tests

| ID | Test | Evidence |
|---|---|---|
| ULT-01 | A packet whose worker claims success but whose gate fails never becomes `done` | fixture repo with failing test |
| ULT-02 | Change outside `scope` is rejected and reset | scope-violation fixture |
| ULT-03 | Verifier catches a deleted/skipped test as a fake fix | fake-fix fixture |
| ULT-04 | Budget at 100 % pauses the run; `resume` continues without repeating finished packets | budget + resume test |
| ULT-05 | Killing the process mid-run and running `resume` yields the same final state as an uninterrupted run (ledger replay) | crash test |
| ULT-06 | HTTP 429 from upstream lowers parallelism, run still completes | mock upstream |
| ULT-07 | Two parallel packets with overlapping scope are rejected at plan validation | plan test |
| ULT-08 | `main` and all remotes unchanged after any run, including `failed` and `killed` | git state assertion |
| ULT-09 | One blocked packet ⇒ dependents `skipped`, run ends `partial`, report names the cause | DAG fixture |
| ULT-10 | No code path other than INTEGRATE/ACCEPT writes `succeeded` | static scan + runtime assertion |
| ULT-11 | Dirty working tree is refused without `--stash` | fixture |
| ULT-12 | Cost shown in report equals the sum of ledger entries | arithmetic test |
| ULT-13 | Spec tests are created before any worker starts and cannot be modified by workers (readonly enforcement) | scope-violation fixture on `tests/spec/**` |
| ULT-14 | All gates green but one `must` criterion unmet ⇒ run does not end `succeeded`; a new round starts | fixture with a missing feature |
| ULT-15 | A criterion cannot be `met` without an evidence reference; acceptor output without evidence is rejected | schema test |
| ULT-16 | No criterion improves for `stall_rounds` rounds ⇒ run ends `stalled` with a report | mock acceptor |
| ULT-17 | A criterion that was `met` and becomes `unmet` is flagged `regressed` and gets priority in the next round | mock acceptor |
| ULT-18 | Planner sizing: sum of packet `est_tokens` ≤ budget × (1 − `repair_reserve`); lower budgets drop `could`, then `should` criteria first, never `must` silently (a `must` that does not fit is reported) | property test over fixtures |
| ULT-19 | Resume at every phase boundary of a multi-round run yields the same final state as an uninterrupted run (extends ULT-05) | crash matrix test |
| ULT-20 | Each round creates a checkpoint tag `ultra/<run>/round-N`; `needs_human` criteria appear in the report and a run with an open `needs_human` `must` criterion ends `partial`, not `succeeded` | git + report assertion |

## 10. Build order

1. **Run skeleton:** state, ledger, budget tracker, `status/pause/resume/kill`. — done
2. **Plan phase:** explorers, critic, schema validation, gate auto-detection,
   `alran ultra plan` (usable on its own as plan-only mode). — done
3. **Worker + worktrees + gate:** sequential first, then parallel scheduler with
   429 backoff. — done
4. **Verifier, scope enforcement, repair loop.** — done
5. **Integrate + report.** — done
6. **Goal document, spec tests, acceptance agent (§13.1–13.2).** — done
7. **Outer loop: rounds, gap analysis, stagnation stop, interim audits,
   checkpoints (§13.3–13.5).** — done
8. **Budget-aware planning (§13.6).** — done
9. **TUI board + recipes.** — done
10. **Review fleet** (`alran ultra review`): independent reviewers with
    different lenses, every finding verified by a separate agent. — done
11. Later: model-written orchestration scripts, ideas of §15.

## 11. Open decisions

| ID | Question | Recommendation |
|---|---|---|
| O-1 | Trademark/domain check for "Ultra"; avoid Anthropic's compound names (Ultracode, Ultraplan, Ultrareview) | do before public announcement (Willi: not a priority) |
| O-3 | Default verifier model | different from worker; BYOK strong model optional |
| O-4 | Default budget cap | 2 USD, confirm above 5 USD even with `--yes` |
| O-5 | Cloud runs and background persistence | idea only, see §15 |
| O-7 | Cost preview in the confirmation step: keep or drop | decide after dogfooding the finished feature; the live cost counter stays either way. A preview is only as good as the plan's `est_tokens`, calibrated against ledger history (plan estimate vs. actual) |
| O-8 | How does the acceptor exercise web UIs (browser agent, Playwright MCP) | reuse existing computer-use/Playwright tooling if available; criteria it cannot check are `needs_human` |

Resolved: O-2 state directory is `.alran/ultra/`. O-6 the codebase already has
reusable primitives (`task`/`task_spawn`/`task_wait` parallel subagents,
`fork-worktree-adapter.ts`, `verifier-port.ts`, and the `packages/ci-fix` layering
with `diff-guard.ts` and `detect-commands.ts`); Ultra reuses them instead of
rebuilding.

## 12. Prompt for the build agent (phases 5–8)

```text
Continue Ultra mode in the alran Code CLI per docs/ultra-spec.md (v1.1). Work in the current working tree on
the current branch (main). Do NOT commit, do NOT switch branches, do NOT touch any remote. First read the
uncommitted changes (git status, git diff) and docs/ultra.md to learn the exact state of steps 3–4; finish
anything unfinished there before starting new work. Do not overwrite or revert uncommitted work you did not write
in this task; other uncommitted edits in the tree belong to the user.

Work phase by phase. After each phase run the full relevant gates (package tests, typecheck, lint, build, brand
and license checks as in the last run) and only proceed if green; if blocked, stop and report.

Rules: tests first (write them, watch them fail, then implement); keep the pure dependency-injected core style of
packages/ultra; reuse existing primitives (task_spawn/task_wait, fork-worktree-adapter, verifier-port,
@alran/ci-fix diff-guard and detectProjectCommands); report anything you had to build new before building it.
```

## 13. Goal-driven long runs (v1.1)

**Why.** Green tests only prove that the existing tests pass. For large goals
("build a drawing app") the tests the workers write check what the workers built,
so a run can end with all gates green and large parts missing or broken. Ultra
therefore works against a goal document and keeps going until that document is
satisfied or a stop condition hits.

### 13.1 Goal document

Created by the planner from the task, shown at confirmation, frozen afterwards
(changes only through an explicit amendment recorded in the ledger).

```json
{
  "criteria": [
    { "id": "C1", "priority": "must", "verification": "scenario",
      "description": "A user can create, move and hide layers.", "status": "unmet", "evidence": [] },
    { "id": "C2", "priority": "should", "verification": "command",
      "description": "The result can be exported as PNG via `app export out.png`.", "status": "unmet", "evidence": [] }
  ]
}
```

Priorities: `must` (run is not `succeeded` without it), `should`, `could`.

### 13.2 Spec tests and acceptance agent

- **Spec tests:** before any worker starts, a separate `spec_tester` agent turns
  the criteria into executable checks under `tests/spec/**` (or equivalent). They
  are `readonly` for all workers (enforced by scope enforcement and diff-guard).
- **Acceptor:** an independent agent with the goal document and run instructions
  but without the workers' reasoning. It exercises the real result (starts the
  app, calls the CLI, drives a browser if tooling exists) and returns for every
  criterion `met | partial | unmet | needs_human` with evidence (command output,
  file refs, screenshot paths). No evidence ⇒ not `met`.
- **Honest limit:** the acceptor is a model and can be wrong, especially on
  visual quality and feel; such criteria are `needs_human`. A run with an open
  `needs_human` `must` criterion ends `partial`.

### 13.3 Outer loop

```
round N: execute packets → integrate → accept → gap analysis → new packets for unmet/partial/regressed criteria → round N+1
```

Stop conditions: all `must` criteria `met` (done) · budget exhausted (pause,
resumable) · stagnation (no criterion improved for `stall_rounds` rounds ⇒
`stalled`) · `max_rounds` · `max_hours` · kill.
Regression guard: a criterion that was `met` and becomes `unmet` is `regressed`
and gets priority in the next round.

### 13.4 Interim audits

Every `audit_every` rounds an auditor reviews the whole state against the goal
document for drift (an early wrong decision that later packets keep building on)
and may open rework packets.

### 13.5 Long-run requirements

- All state on disk (plan, goal, ledger, notes, round artifacts); resume is safe
  at every phase boundary.
- **Fresh context per worker and per round.** Packet context is assembled from
  `goal.json`, the plan, `notes.md` and interface summaries — never from earlier
  transcripts.
- `notes.md` is the curated run memory (decisions, conventions, public
  interfaces), written by the integrate step.
- Checkpoint = git tag `ultra/<run>/round-N`; the human can inspect or roll back
  any round.
- Ledger stays append-only; reports aggregate per round.

### 13.6 Budget-aware planning

The planner receives `budget_usd` as an input and sizes the plan to fit it:

- criteria are included by priority (`must`, then `should`, then `could`); a
  `must` that does not fit is reported, not dropped silently;
- `repair_reserve` (default 25 %) of the budget is held back for repair loops and
  acceptance;
- `est_tokens` per packet is the sizing unit; the ledger records plan estimate vs.
  actual so estimates can be calibrated over time;
- a small budget therefore yields a smaller but finished result; a large budget
  (or `--budget none`) plans the complete goal;
- if the budget still runs out, the run pauses; the report lists the open criteria
  and `resume --budget N` continues.

## 14. The review fleet (`alran ultra review`)

A run ends with a branch and a report. The question that follows is the one no
gate can answer: *is this change actually good?* Gates say the tests pass; they
do not say the change is correct, safe or complete.

The review answers it the way the rest of Ultra answers everything — with
independent agents and evidence:

- **A fleet, not one reviewer.** Each reviewer gets its own *lens*:
  correctness, safety, tests, compatibility, concurrency. N reviewers with the
  same prompt produce N copies of the same opinion; N reviewers with different
  lenses produce N different opinions.
- **Independent verification.** A reviewer's finding is a claim. Every finding
  is checked by a separate agent that sees the finding and the code, not the
  reviewer's reasoning. A finding that cannot be confirmed is dropped with the
  reason it was dropped.
- **Fail closed.** A malformed reply, a crashed reviewer, an unreadable verdict:
  none of these become a finding. A review that cannot confirm a problem does
  not report one.
- **Bounded.** The review has its own budget (`--budget`), and the diff it
  reads is truncated with the truncation stated in the report.
- **Honest output.** `review.md` lists the confirmed findings with their
  evidence *and* the rejected ones with the reason they went. A report that
  only shows what survived hides how much the fleet argued with itself.

The review reads only; it never changes the code it reviews. The reviewers run
under the same read-only guard as the planning roles, because a reviewer that
"helpfully" fixed the bug it found would have destroyed the evidence of it.

## 15. Ideas for later (not planned, no date)

- **Cloud runs on the Ottili AI Platform:** run Ultra in the Platform's agent
  sandbox so long runs do not depend on a laptop. Simplest form: the same binary
  headless in a sandbox (`alran ultra "<task>" --yes --budget X`), ledger streamed
  out, resulting branch returned. Depends on the state of the Platform's
  sandbox/mission layer and on an adapter for the harness this CLI builds on;
  should only run with paid credit (abuse risk). An audit of what exists today is
  the first step when this is picked up.
- **Recipes as Alran Store skills.**
- **Model-written orchestration scripts** once recipes are proven.