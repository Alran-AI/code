# Ultra

Ultra runs a task that is too large for one agent loop — a codebase-wide
migration, a bug hunt, a refactor, test generation, an audit, or a whole feature
built against a goal document — as a planned DAG of bounded work packets on an
isolated branch, and hands back evidence the human can review. It never merges
into `main` and never pushes.

## What this build actually does

Implemented and tested:

- **Run skeleton** — `state.json` (run and per-packet status), an append-only
  `ledger.jsonl`, a budget tracker, and the start guard that refuses a dirty tree.
- **Plan phase** — three read-only explorers, one critic, plan-schema validation
  (overlapping parallel scope, unknown dependencies, cycles, duplicate ids) and
  gate auto-detection shared with the CI Fixer. The runtime adapter reads the
  repository's real project files and calls headless `alran exec` for each role;
  the planner's reply is parsed strictly, so a malformed plan is rejected rather
  than guessed at.
- **The project-wide gates are shown and can be changed** — the commands the
  merge will be checked against are detected from the repository (`package.json`,
  `pyproject`, `Cargo.toml`, `Makefile` …), shown in the confirmation and in
  `/ultra status`, and replaced by the reader when detection guessed wrong:
  `--test-gate`, `--lint-gate` and `--build-gate` take a command each, and an
  override *replaces* the detected group rather than adding to it. The same
  flags work on `resume`, so a run that was planned before the reader knew
  which gate the project uses can be corrected without planning it again. A
  plan edited on disk is validated again before it runs, so an edit cannot
  bypass the rules the planner passed (two parallel packets with overlapping
  scopes stay refused).
- **Budget-aware planning** — the plan is sized to `--budget` before any worker
  starts. Criteria are kept by priority (must → should → could), a
  `repair_reserve` fraction is held back, and a `must` that does not fit is
  reported instead of being dropped silently.
- **Execution** — a dependency-ordered scheduler, one git worktree per packet on
  `ultra/<run>-<packet>`, scope enforcement, a no-LLM gate, a deterministic
  fake-fix pre-check, an LLM verifier, a repair loop and 429 backoff.
- **The work reaches the branch.** A packet is `done` only after its work is
  **committed** on its own branch. This was the worst defect the build had: the
  diff was read from the worktree's index, and the index is not something a
  later `git merge` can carry, so every run merged branches that had never been
  committed. The run reported `succeeded`, the report said so, and the branch
  the human was told to merge was empty. The change is now committed when the
  verifier passes, and a real-git test asserts the file is on the run branch.
- **Live progress.** A pass used to print one line and then nothing until it
  finished — minutes of a frozen terminal. Every decision point the scheduler
  makes (attempt, worker finished, gate ok, verifier passed, repair, done,
  blocked, skipped, throttled, budget pause) is now written as it happens, in
  the foreground, in the TUI and in the detached runner's log. The lines say
  what the harness observed and never repeat the worker's own claim.
- **Packet evidence** — `packets/<id>/prompt.md`, `diff.patch`, `gate.txt` and
  `verdict.json` are written for every packet that reaches the gate.
- **Integrate** — the merge agent merges `done` packets into `ultra/<run>` in
  dependency order, aborts a conflicted merge instead of guessing, runs the
  project-wide suite on the merged tree, and puts the combined diff through a
  final review pass. Only this step may set `succeeded`.
- **Report** — `report.md` is written from durable state: goal, result, criteria
  table (goal-driven runs), packet table, gate evidence, final-review verdict,
  cost by role and per round, every unfinished item with its reason, and the
  exact merge command.
- **Goal document** — a frozen criteria list (`must` / `should` / `could`, each
  with a verification method, a status and evidence), written by a **dedicated
  authoring turn** before anything is planned: the author answers "what does done
  mean", the planner answers "how do I split the work". That separation is what
  lets criteria carry priorities at all — criteria derived from packet titles are
  all `must`, which is exactly what makes a plan impossible to size to a budget.
  `met` without evidence is rejected; a criterion that was `met` and is seen unmet
  again is `regressed` and gets priority next round; an open `needs_human` `must`
  keeps a run `partial`.
- **Spec-test protection** — the criteria's executable form lives in
  `tests/spec/**`, frozen before any worker starts. A plan whose packet scope
  could reach that directory is rejected at validation, and a worker that edits
  a spec test anyway has the change reverted as a repair. A `spec_tester` agent
  authors the files (one per criterion) and they are committed to
  `ultra/<run>-spec-tests`, the branch every packet worktree starts from, so the
  gate can run them and no worker's diff can contain them. The acceptor is told
  where they are and to run them first: a check that fails makes its criterion
  `unmet` however convincing the diff looks. If authoring fails, the run stops
  rather than starting workers with no acceptance checks.
- **Acceptance reporting** — the acceptor's free-text reply is parsed
  fail-closed: a `met` without evidence is rejected, an unknown criterion is
  dropped, and a malformed verdict line is never guessed.
- **Run memory** — `notes.md`, written by integrate, is the run's only carried
  memory: decisions, conventions and interfaces, grouped by kind with their
  round. Workers get that plus the goal and interface summaries, never an
  earlier transcript.
- **Recipes** — `--recipe migrate|bughunt|refactor|testgen|audit` is a real
  constraint, not a label. Each recipe states how to cut the packets, which
  ordering the planner has to respect, and the checks a separate verifier must
  make after every packet — the questions a packet's own tests cannot answer
  (is an old call site left behind, did the reproduction fail before the fix, did
  a refactor change behaviour). The planner and the critic are told the recipe;
  the verifier gets its checks appended to the fixed fake-fix checklist; an audit
  run is read-only by construction, so a packet that edits code is rejected. An
  unknown `--recipe` is a usage error rather than a plan that silently lost its
  rules. `auto` (the default) names the recipes for the planner and offers a
  keyword guess as a hint it may ignore.
- **Goal loop** — rounds of execute → integrate → accept → gap analysis, with
  `stall_rounds` stagnation detection and a round cap. Reachable from the CLI as
  `alran ultra goal "<task>"`.
- **Interim audits** — every `--audit-every` rounds (default 3) an auditor reviews
  the whole run against the goal for *drift*: an early wrong decision every later
  packet kept building on. A high-severity finding becomes a real rework packet in
  the next round; a failed audit is recorded in the ledger and never ends a
  healthy run.
- **Attaching to a run.** `alran ultra attach [run-id]` follows the detached
  runner's log the way you would attach to a process: it shows the last lines
  first, then streams what is appended, and when the process goes away it says
  whether the run finished or was `interrupted` and which command resumes it.
  `--no-follow` prints the tail and exits. In the TUI, `/ultra attach` and the
  board's `l` key open the same log as a panel that repaints itself, and the
  board shows the newest three lines inline.
- **Board** — `alran ultra board [run-id]` and `/ultra` in the TUI render the
  spec's board from durable state: the round and phase, cost against the cap,
  elapsed time, the criteria progress, and one row per packet with its glyph and
  its reason (what it is waiting for, how many repairs it has used, why it is
  blocked). Every row fits `--width`. The renderer is pure, so the layout is
  tested once and both surfaces share it. In the TUI the board is live: it
  repaints once a second while open, and `p` `k` `+` `-` `d` `l` `g` `r` `s` act on
  the run (`esc` closes). `d` runs a real `git diff --stat` of what the run
  produced and names the command for the full patch. The worker cap changed with
  `+`/`-` is persisted on the run, so the next pass really uses it.
- **Guards on the board's keys.** The TUI refuses the actions that would
  contradict the run's state instead of writing nonsense into it: a finished run
  cannot be killed (that would relabel a success as `killed` and lose the
  verdict), a run that is still running cannot be resumed (that would start a
  second execute pass over the same worktrees), and only a run that is not
  already in the requested state can be paused or killed. `RunStore` guards the
  transition *into* `succeeded` but not the ones out of it, so these live in the
  flow.
- **Resume** — a killed or paused run redoes only non-terminal packets. A packet
  that is already `done`, `blocked`, `skipped` or `cancelled` is reported, never
  re-run. A resumed goal-driven run also rediscovers the branch that carries the
  frozen checks (`ultra/<run>-spec-tests`) instead of falling back to `HEAD`, so
  the worktrees it recreates still contain them; an explicit `--base` wins.
- **One rule about what may be continued.** The CLI and the TUI apply the same
  rule, and it lives in the core: a planned, paused, killed, partial, failed or
  stalled run may be continued; a running run may not (a second execute pass
  would race the first over the same worktrees); a successful run may not (it
  has a verdict, and moving it to `running` threw that verdict away — the CLI
  used to do exactly that). A run with nothing left to execute still integrates:
  a run killed between its packets and its merge has finished its work and
  would otherwise never be merged at all. The one exception is a running run
  whose process is *gone*: `status` calls that `interrupted` and tells the
  reader to resume it, so the resume must not refuse it.
- **Stopping a run that is under way.** `alran ultra pause` and `alran ultra
  kill` used to do nothing to a run that was actually running. The run's
  `state.json` belongs to the process that drives the run, so a second process
  writing that file had its change overwritten by the driver's next save: the
  command wrote `paused`, the driver wrote `running` a second later, and the
  run carried on as if it had never been asked. The request now travels through
  a file of its own (`control.json`), the driver reads it at its next safe
  point — between packets, and before a repair is spent — and stops there. A
  run with no driver gets its state changed straight away, so `pause` on a run
  whose process died still means what it says. The TUI's `p` and `k` keys use
  the same rule and the same code.
- **Ctrl+C pauses a run instead of orphaning it.** Without a handler, Ctrl+C
  killed the CLI outright and left the run saying `running` with nobody behind
  it — a state `resume` refused, so the work was stranded until somebody
  edited the state by hand. The CLI now writes the stop request and lets the
  scheduler stop at the next safe point; a second Ctrl+C quits at once. A
  worker that was cut short by the interrupt is not a failure: it does not
  spend a repair, and the packet is redone by the resume.
- **A stopped pass is not integrated.** A paused or killed run keeps the
  packets that have not run, so integrating them would merge a half-finished
  plan, spend the budget the pause was protecting, and write a verdict over a
  run that is waiting to be resumed. The run stays `paused` (or `killed`), its
  report is written, and the resume continues from exactly there.
- **Finding a run again.** `alran ultra runs` lists every run on disk, newest
  first, with its status, its packets, its criteria and its spend. The CLI's
  `status` refuses to guess between several runs, and that refusal is only fair
  if the user can see them; `/ultra runs` prints the same list.
- **Seeing what a run produced.** `alran ultra diff <run-id>` shows the diff
  against HEAD and the command for the full patch. It is the same function the
  board's `d` key uses, so the two surfaces cannot drift.
- **Reviewing a run** — `alran ultra review <run-id>` puts a *fleet* of
  independent reviewers over what the run produced. Each reviewer gets its own
  lens (correctness, safety, tests, compatibility, concurrency), because N
  reviewers with the same prompt are an echo, not a second opinion. Every
  finding is then checked by a separate agent that sees the claim and the code
  but not the reviewer's reasoning; a finding that cannot be confirmed is
  dropped with the reason. The report (`review.md`, `review.json` in the run
  directory) lists the confirmed findings with their evidence *and* the
  rejected ones, because a report that only shows what survived hides how much
  the fleet argued with itself.

Starting a run:

- **From the TUI.** `/ultra "<task>"` starts a run with the documented defaults;
  `/ultra` with no task opens a wizard that collects the task, whether the run is
  one pass or loops until the goal is met, the budget, the worker cap and the
  recipe, shows a summary, and only then starts.
- **In the background.** A run does not depend on an open shell. `--detach` (and
  the TUI, always) starts a **detached child of the same CLI** — the same
  foreground code path, with its output going to `.alran/ultra/<run>/runner.log`
  — and returns at once. The child is told to `--adopt` the run id, so it
  continues the run the parent created instead of allocating a second one.
  `runner.json` records the pid, so `status` and the board can say whether the
  run is still going, finished, or was `interrupted` by a closed laptop; a
  resumable run names the command that resumes it. A restarted child with an
  existing `plan.json` continues from that plan rather than planning twice.

Not implemented, and not claimed:

- **A review of something other than a run.** `alran ultra review` reviews what
  an Ultra run produced. Reviewing an arbitrary branch, a directory or a pull
  request is not built; the run is the unit the rest of Ultra works in.
- **A review that reads the whole change.** The reviewers see the diff, the
  list of changed files and the repository. The diff is truncated at 40 000
  characters, and the report says so when it was: a review that silently saw
  half the change is worse than one that admits it.
- **`--stash` in the TUI.** The wizard does not offer stashing: a detached run
  that stashed the tree would leave the user's changes hidden inside a process
  they cannot see. Use the CLI for that.
- **Recipes as data.** The five recipes are built in; a repository can override any
  of them from `.alran/recipes/<id>.md` — markdown with a small YAML frontmatter
  (`title`, `summary`, `decomposition`, `ordering`, `verifier_checks`,
  `criteria_seeds`, `readonly_paths`). The body is the decomposition if no key
  sets one, and a key the file omits keeps the built-in rule, so a small override
  does not have to restate the whole recipe. The format is a deliberate subset:
  anything else is refused with file and line rather than guessed at, and a file
  whose name is not one of the five is an error instead of a silent no-op. New
  *kinds* of recipe are not supported — the value is in tuning the five shapes a
  project already has.
- **Recipes as Alran Store skills** — the file format exists and is read, but
  distribution through the Alran Store is not built.
- **A real price per token.** `alran exec --output-format json` reports tokens,
  not dollars, so every cost figure is an estimate derived from the single
  declared constant `PLAN_TOKENS_PER_USD` (the same constant plan sizing uses).
  A call that reports `usage.costUsd` wins over the estimate, so a runtime that
  starts reporting real prices is picked up with no change here. What this means
  in practice: the budget cap is enforced, but against an estimated spend, and
  the report says so rather than presenting the number as a billed amount.
- **Cost preview in the confirmation** (spec O-7). The confirmation shows the
  plan and the goal document, not a price; the live counter during the run is the
  number to watch. A preview would only be as good as the plan's `est_tokens`,
  which is exactly what the ledger exists to calibrate.
- **Placing authored spec tests into the working tree.** They are frozen on
  `ultra/<run>-spec-tests`, a branch every packet worktree starts from, so the
  gate can run them and no worker can edit one. They are *not* copied into the
  user's checkout: that would put unreviewed files into a tree the run does not
  own. They arrive with `git merge ultra/<run>` like everything else.

## Commands

```sh
alran ultra "<task>"        # plan, confirm, then execute (spec 2's primary form)
alran ultra plan "<task>"    # plan only; no execution, nothing changes
alran ultra run  "<task>"    # plan, execute, integrate and report
alran ultra goal "<task>"    # plan against a goal document, then loop rounds
alran ultra status [run-id]
alran ultra runs             # every run on disk, newest first
alran ultra board  [run-id]  # the board: round, cost and every packet at a glance
alran ultra diff   [run-id]  # what the run produced, and the command for the full patch
alran ultra review [run-id]  # a fleet of independent reviewers, every finding verified
alran ultra run    "<task>" --detach   # start it in the background, return at once
alran ultra pause <run-id>    # stop the run at its next safe point, resumable
alran ultra kill  <run-id>    # stop it and keep the worktrees for inspection
alran ultra resume <run-id>
alran ultra report <run-id>
alran ultra attach [run-id]  # follow the run's log live (Ctrl+C to stop)
```

In the TUI, `/ultra "<task>"` starts a run and `/ultra` opens the start wizard;
`/ultra board` opens the same board and keeps it live. `/ultra status`,
`/ultra attach`, `/ultra report`, `/ultra runs`, `/ultra diff`, `/ultra review`,
`/ultra pause`, `/ultra kill` and `/ultra resume` mirror the CLI subcommands, and
`p` `k` `+` `-` `d` `l` `g` `r` `s` act on the open board. `l` opens the log
itself rather than pasting it, and it keeps repainting while the run writes.
Anything `/ultra` does not recognise as a subcommand is treated as the task to
run, so `/ultra build a drawing app` works.

A run started from the TUI or with `--detach` keeps running after the terminal
closes. `alran ultra status <run-id>` and the board header say who is driving
it; if that process is gone and the run never finished, they say `interrupted`
and name the command that resumes it.

`/ultra runs` and `alran ultra runs` print the same list: every run on disk,
newest first, with its status, its packets, its criteria and its spend. The CLI
has it too, because a CLI whose `status` refuses to guess between several runs
owes the user a way to see them.

With no run id, every `/ultra` subcommand acts on the newest run on disk — the
flow keeps no memory of the last board it showed, so `/ultra pause` can never act
on a run you stopped looking at.

`run` and `goal` both reach the model through headless `alran exec` calls. In a
test or a sandbox without a reachable model they report the failure and mark the
run `failed` rather than inventing a plan.

`report` prints the full `report.md`, rebuilding it from `state.json`,
`plan.json`, `goal.json` and the ledger when the file is missing — the report is
derived data, so it is never simply "not there yet". `status` shows goal criteria
progress (met/total, must, needs_human, regressed) for goal-driven runs alongside
the packet table.

## Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--recipe` | `auto` | `migrate`, `bughunt`, `refactor`, `testgen`, `audit`. Each constrains the plan and the verifier; an unknown name is refused |
| `--budget` | `2` | hard USD cap; also sizes the plan. `none` = no cap (explicit opt-in) |
| `--workers` | `4` | max parallel workers (clamped to 1-8) |
| `--max-repairs` | `2` | repair attempts per packet |
| `--max-rounds` | `10` | `goal` only: max rounds of the outer loop |
| `--stall-rounds` | `2` | `goal` only: stop as `stalled` after this many rounds without progress |
| `--max-hours` | `0` | `goal` only: optional wall-clock cap (0 = off) |
| `--audit-every` | `3` | `goal` only: run an interim drift audit every N rounds (0 = off) |
| `--base` | current HEAD | commit to branch from |
| `--stash` | off | allow starting on a dirty tree by snapshotting it |
| `--yes` | off | skip the confirmation step (the budget cap still applies) |
| `--model` | the configured model | model for every Ultra role at once |
| `--force-scope` | off | plan and run even when the scope check says the task does not need Ultra |
| `--force-critic` | off | execute a plan the critic rejected (its objections are still printed) |
| `--reviewers` | `3` | `review` only: how many lenses of the fleet to run (1-8) |
| `--test-gate` | detected | replace the detected project-wide test gate (repeatable) |
| `--lint-gate` | detected | replace the detected project-wide lint gate (repeatable) |
| `--build-gate` | detected | replace the detected project-wide build gate (repeatable) |

Before a run executes it shows the plan, the goal criteria and where the work will
land, and asks `Continue with this plan? [y/N]`. Only an explicit yes proceeds; an
empty line, a typo or a non-interactive shell is a no, because starting a run
spends money. `--yes` skips the question. A cost preview is deliberately not
shown: a preview is only as good as the plan's `est_tokens` (O-7), and a
confident wrong number is worse than none.

## When Ultra says no

Two checks can stop a run before any packet starts, and both can be overruled by a
human because both are judgements rather than facts.

- **The scope check** (spec 3.1) asks whether the task justifies a multi-agent
  run. It is deliberately conservative, and in live use it declined three tasks
  in a row with good reasons. A human who knows the repository better than a
  two-minute routing call needs the override: `--force-scope` plans anyway, and
  the router's verdict is still printed, because a run that hides having
  overruled its own routing check is worse than one that follows it or stops.
- **The critic** (spec 3.2) reviews the drafted packets before anything is
  written. A rejected plan is no longer printed and executed anyway: the run
  stops with the objections on screen, and `--force-critic` executes it for
  someone who has read them and disagrees.

Every Ultra role runs on the model the CLI is configured with, the same as the
rest of the product; `--model` pins one model for all roles instead. An earlier
build hard-coded a provider-qualified id here, which is a silent assumption about
which providers a user is signed in to — a live run died at the planner with
`401 This session is not valid` while the explorers, which passed no model,
worked.

`alran ultra board` takes `--width <columns>` (40-200, default 100): every row is
truncated to fit, so the board can go into a fixed-width terminal or a log without
wrapping.

`--workers` and `--max-repairs` are clamped in the core, so a non-numeric value
cannot make the scheduler spin or run unbounded. `--budget none` removes the cap
for any run; `--max-rounds` and `--max-hours` still bound a `goal` run. A budget
value that is neither a number nor `none` is rejected as a usage error rather than
silently becoming an unlimited run.

`resume --budget N` raises the cap for the resumed pass — that is how a run paused
at 100 % continues without repeating finished work.

## Pipeline

```
SCOPE → PLAN → EXECUTE (WORKER → SCOPE → PRE-CHECK → GATE → VERIFIER → REPAIR*)
       → INTEGRATE → REPORT
```

Goal-driven runs repeat PLAN → INTEGRATE in rounds with ACCEPT and gap analysis
between them:

```
round N: execute packets → integrate → accept → gap analysis → round N+1
```

### Scope and secrets

After the worker stops the harness diffs the worktree. A change outside `scope`,
or inside `readonly`, resets the worktree and restarts the worker with a violation
note; that counts as a repair. A git failure while reading the diff blocks the
packet — failing open would let out-of-scope edits through on no evidence.

`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `secrets/**` and private-key
filenames are read-only for every packet, whatever its scope says.

### Gate and verifier

The CLI runs each packet's `accept` commands; the exit code decides, and a packet
with no acceptance command fails closed. The CI Fixer's diff guard rejects a
deleted or skipped test before the verifier is asked. The verifier is a separate
agent on a separate model when configured, and a verifier 429 retries only the
verifier — it never sends the worker back to redo finished work.

### Integrate

Packets merge in dependency order with `--no-ff`; a conflicted merge is reported
and aborted, never auto-resolved, because a silent resolution is the harness
deciding what the author meant. The full suite runs on the merged tree, then a
final review sees the combined diff (the packet verifier's checklist plus
cross-packet consistency). A failed suite is `failed`; a failed review, a
conflict or a packet that never finished is `partial`. Only integrate may set
`succeeded`, and the state layer refuses any transition into `succeeded` from a
state other than `integrating` / `accepting`.

### Goal document and acceptance

The planner freezes a criteria list at confirmation. Before workers start, a
`spec_tester` would turn the criteria into `tests/spec/**`, read-only for every
worker. After each integrate, an independent acceptor exercises the real result
with the goal but not the workers' reasoning, and returns
`met | partial | unmet | needs_human` per criterion with evidence.

Three rules keep that honest:

- **No evidence, no `met`.** A claim without a reference is rejected and the
  criterion stays where it was.
- **A regression is first-class.** A criterion that was `met` and is observed
  `unmet` becomes `regressed`, is reported as a loss, and is prioritised in the
  next round.
- **`needs_human` is not success.** A criterion no model can judge (visual feel,
  taste) stays open, and an open `needs_human` `must` ends the run `partial`.

The loop stops when every `must` criterion is met (`succeeded`), when no
criterion has improved for `stall_rounds` rounds (`stalled`), when the round cap
or the optional wall-clock cap is hit (`partial`), or when the budget runs out
(`paused`, resumable).

## State on disk

```
.alran/ultra/<run-id>/
  state.json          # run and packet status, for resume
  ledger.jsonl        # every step, append-only, secret-redacted
  plan.json
  goal.json           # criteria, statuses, evidence (goal-driven runs)
  notes.md            # curated run memory, written by integrate
  spec-tests/         # authored spec tests, as committed to ultra/<run>-spec-tests
  rounds/<n>/         # per-round artifacts (goal-driven runs)
  packets/<id>/       # prompt.md, diff.patch, gate.txt, verdict.json
  runner.json         # pid and log path of the process driving the run
  runner.log          # that runner's stdout and stderr
  control.json        # a stop request left for the process driving the run
  report.md
  review.md           # the review fleet's report, when the run has been reviewed
  review.json         # its findings, for other tools to read
```

Two things live outside that directory. Each packet is a git worktree under
`.alran/worktrees/<run-id>/<packet-id>`, on its own `ultra/<run>-<packet>`
branch. And the run's branches are ordinary git branches: `ultra/<run>` holds the
integrated result, `ultra/<run>-<packet>` one per packet, `ultra/<run>-spec-tests` the frozen checks, and
`ultra/<run>/round-N` tags mark each round's checkpoint.

The naming is not cosmetic. Git stores a ref as a file, so `ultra/<run>` and
anything *under* `ultra/<run>/` cannot coexist: creating a packet branch named
`ultra/<run>/<packet>` makes the run branch impossible to create, and every
integrate then fails with `cannot lock ref 'refs/heads/ultra/<run>'`. Packet and
spec-test branches are therefore siblings of the run branch, and all four names
come from one module (`packages/ultra/src/branches.ts`) so a new kind of ref
cannot be added without seeing that rule.

Ultra writes `.alran/.gitignore` on the first run so its own state never makes
the working tree dirty — otherwise the start guard would refuse the next run. A
user-provided `.alran/.gitignore` is never overwritten.

The ledger is the source of truth for resume and for the cost in the report. A
killed process loses at most the line being written; a torn final line is ignored
on open. Secret-looking values are masked before they reach disk.

## Safety

- `main` and all remotes are untouched; work lands on `ultra/<run-id>`. Integrate
  merges in a scratch worktree so the user's own tree is never touched.
- The budget warns at 80 % and **pauses** at 100 % — it never kills — so
  `resume` continues after the cap is raised. A budget pause leaves the packet
  resumable instead of marking it `blocked`.
- Only INTEGRATE/ACCEPT can set `succeeded`, and the state layer refuses
  `running → succeeded`; a packet reaches `done` only from `verifying`, so no
  caller can skip the gate and the verifier.
- A blocked packet skips its dependents; independent packets continue, and the
  run ends `partial` with every cause named.
- `kill` keeps the worktrees, evidence and ledger for inspection.

## Acceptance tests

| ID | Test | Where |
| --- | --- | --- |
| ULT-01 | a worker's success claim never beats a failing gate, and the verifier never runs on a red gate | `execute.test.ts` |
| ULT-02 | an out-of-scope change resets the worktree, restarts the worker and counts as a repair | `execute.test.ts`, `scope-guard.test.ts` |
| ULT-03 | a deleted test is caught by the diff guard before the LLM, and a hard-coded value is caught by the verifier | `execute.test.ts` |
| ULT-04 | the budget pauses at 100 % and the paused packet stays resumable, including when spend is derived from token counts; at CLI level a resumed pass finishes the run without re-executing the packet that was already done (real git, calls counted) | `budget.test.ts`, `execute.test.ts`, `ultra-command.test.ts` |
| ULT-05 | the ledger and state survive a simulated crash and resume does not repeat finished work | `ledger.test.ts`, `run-state.test.ts` |
| ULT-06 | a 429 lowers parallelism, backs off and still finishes; a throttled verifier does not cost a repair | `execute.test.ts` |
| ULT-07 | overlapping parallel scope, unknown dependencies, cycles and duplicate ids are rejected | `plan-schema.test.ts` |
| ULT-08 | `main` and all remotes are unchanged after a run that succeeds and after one whose packets all end `blocked` (real git, a real bare remote, only the model stubbed) | `ultra-command.test.ts`, `branches.test.ts` |
| ULT-09 | a blocked packet skips its dependents, independents continue, the run ends `partial` | `execute.test.ts` |
| ULT-10 | only integrate.ts may set `succeeded` (static scan), and the state layer refuses `running → succeeded` | `integrate.test.ts` |
| ULT-11 | a dirty tree is refused without `--stash`, and Ultra's own output is not "dirt" | `start-guard.test.ts` |
| ULT-12 | cost in the report is the arithmetic sum of the ledger entries, per role and per round, and the report says the figures are estimates from tokens unless a price was reported | `report.test.ts`, `ledger.test.ts`, `budget.test.ts`, `ultra-command.test.ts` |
| ULT-13 | spec tests are authored before workers start, are frozen on `ultra/<run>-spec-tests` so every worktree starts with them, and cannot be edited: a plan reaching that directory is rejected, a worker that edits one is reverted, and the acceptor is told to run them | `spec-tests.test.ts`, `spec-authoring.test.ts`, `ultra-spec-base.test.ts`, `plan-schema.test.ts`, `execute.test.ts`, `acceptance.test.ts`, `ultra-command.test.ts` |
| ULT-14 | green gates with an unmet `must` start another round, not `succeeded` | `loop.test.ts` |
| ULT-15 | a criterion cannot be `met` without evidence; an evidence-free claim is rejected | `goal.test.ts` |
| ULT-16 | no criterion improves for `stall_rounds` rounds ⇒ the run ends `stalled` | `loop.test.ts` |
| ULT-17 | a criterion that regresses is flagged and prioritised in the next round | `goal.test.ts`, `loop.test.ts` |
| ULT-18 | plan sizing keeps `must` first and reports a `must` that does not fit | `plan-budget.test.ts` |
| ULT-19 | a crash at a round boundary replays the ledger and leaves the run resumable | `loop.test.ts` |
| ULT-20 | an open `needs_human` `must` ends the run `partial`, not `succeeded` | `goal.test.ts`, `loop.test.ts` |

Three ULT tests run against real git rather than a fake, because the fakes could
not see the failures they were hiding. `ultra-command.test.ts` creates a
repository with a bare remote and runs whole passes with real worktrees, real
merges and real gates (only the model calls are stubbed, and they append to a
counter file so a test can count model calls). It asserts that `main` and the
remote are byte-for-byte unchanged after a successful run and after one whose
packets all end `blocked` (ULT-08), and that a run paused at the cap resumes
without re-executing the packet that was already done (ULT-04).

That is what caught four defects the unit suites could not:

- packet branches named `ultra/<run>/<packet>` made the run branch
  `ultra/<run>` impossible to create at all — git stores a ref as a file;
- the integrate gate spawned command strings without a shell, so a real suite
  (`npm run test`) exited with no code and the run ended `failed` on a suite
  that never ran;
- the verifier dropped `costUsd`, so its tokens were recorded but never priced
  and the cap paused later than the money ran out;
- a resumed run kept integrate's scratch worktree registered on the run branch,
  and git refuses to force-update a branch that is checked out — so any run that
  reached integrate and was then resumed could never integrate again.

A fifth one was waiting for the same kind of test. The run's work was never
**committed**: the diff was read from the packet worktree's index, and the
integrate merged the packet *branches*. A branch carries commits, not an
index, so every merge was "Already up to date". The run reported `succeeded`,
the report said so, and the branch the human was told to merge was empty. The
real-git suite did not see it because it asserted that `main` and the remote
were untouched — never that the run branch held the work. The test now asserts
that the file the worker wrote is on the run branch, and it fails without the
commit step.

Each fix has a test that fails without it. None of them was visible to the
in-memory ports the rest of the suite uses, which is the argument for keeping the
real-git tests even though they are slower.

Not yet covered: any live-model or end-to-end CLI test against a real provider. The
acceptance *parser* is tested against fixed replies; the acceptor agent's own
judgement is not. The report's cost arithmetic is covered at the writer level and
the CLI's `report` subcommand is covered end to end, including rebuilding a
missing report.

The suites live in `packages/ultra/test/unit`,
`packages/tui/test/unit/ultra-command.test.ts`,
`packages/tui/test/unit/ultra-plan-adapters.test.ts`,
`packages/tui/test/unit/ultra-spec-base.test.ts`,
`packages/tui/test/unit/ultra-diff.test.ts` and
`packages/tui/test/unit/ultra-review-adapters.test.ts`, and run in the
`capability` gate.

The behaviours the spec does not number are covered outside the ULT table:
`progress.test.ts` (the narration of a run), `runs.test.ts` (the listing of the
runs on disk, including one whose state cannot be read), `resume.test.ts` (the
one rule about what may be continued) and `review.test.ts` (the fleet: the
lenses, the merge of duplicate findings, the verification, the budget, and the
fail-closed parsing of both replies).

Two behaviours are covered outside the ULT table because the spec describes the
outcome without numbering it: `goal-authoring.test.ts` (the authoring turn keeps
the priorities it was given, refuses an empty or unreadable goal, and never lets
the author pre-judge its own criteria) and the goal-author case in
`ultra-command.test.ts` (the criteria on disk are the authored ones, the
authoring turn is charged to the ledger, and the checks are frozen on a branch
the packets start from).

Recipes and the board are covered outside the ULT table, which numbers only the
behaviours the spec listed: `recipes.test.ts` (a recipe constrains the plan and
the verifier, an unknown name is refused, an audit packet cannot edit),
`execute.test.ts` (the verifier is told the recipe; an audit packet that changes a
file is blocked), `board.test.ts` (the header, the criteria line, every status
glyph, dependency waiting, the width bound) and the `board` cases in
`ultra-command.test.ts`.