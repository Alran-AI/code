# Parallel background subagents and bounded waiting

Date: 2026-11-18

## Intent

The existing `task` tool already starts child Agents, but it is declared
`executionMode: 'sequential'`, so Pi serializes an entire tool batch containing
a `task` call. Background tasks are admitted without a cap, and a parent that
wants to collect several results has no native way to park its turn until those
tasks settle. This change makes parallel delegation a first-class native
capability of Alran Code: fan out to several background Agents in one call,
bound the fan-out, and let the parent park until the work finishes (or until its
own timeout) before the normal completion notice resumes it.

## Goals

- Multiple `task` calls in one assistant message run concurrently.
- One `task_spawn` call starts a bounded group of background child Agents and
  returns all task handles in a single receipt.
- One `task_wait` call parks the current turn until the named tasks (or all
  active tasks in the session) settle, or until an agent-supplied timeout.
- Completion of a background shell or Agent keeps waking the owning
  conversation through the existing `background-task-finished` delivery.
- Canonical Agent role ceilings (Explore / Worker / Verifier) keep applying.

## Non-goals

- No cloud/runtime RPC surface, no new HTTP endpoint, no IPC format change.
- No shared working set between child Agents: parallel writers still need
  disjoint file ownership; the runtime does not add a filesystem transaction.
- No removal or replacement of the existing foreground `task` path.

## Constraints

- `executionMode: 'parallel'` is the switch Pi uses to run a tool batch
  concurrently (`third_party/pi-mono/packages/agent/src/agent-loop.ts`).
- New published files must be recorded through
  `node scripts/source-inventory.mjs --write`.
- New Vitest files must be registered in `test/vitest-suites.json`.
- Documentation and code comments stay in English.

## Approaches

1. Flip `task` to parallel and add a semaphore for subagent admission.
   Smallest change; covers the common "three research calls in one message"
   case. Kept as the foundation.
2. Add a dedicated `task_spawn` group tool so a single model call can declare
   the whole fan-out and receive one aggregated receipt. Kept as the explicit
   way to request parallel background Agents.
3. Extend `task_output.wait_ms` into a general wait tool. Rejected as the only
   solution: it is per-task, read-oriented, and capped at 30 s; the new tool
   needs to wait on a set and return statuses.

All three pieces share the existing task state machine, waiter registry, and
completion delivery, so no second delegation concept is introduced.

## Design

- `LocalTaskToolDef.executionMode` becomes `parallel`.
- Admission stays immediate and gives every entry a durable task row and id.
  A separate `waitForSubagentSlot` semaphore (default 8) is acquired by the
  child turn just before it starts; excess entries stay `queued`. The parent
  therefore gets the complete receipt and returns to the user without waiting
  for free slots. Exceeding the cap never silently drops work.
- `task_spawn` takes `label` plus an `agents` array of the same fields as
  `task` and calls `startBackground` for every entry. It returns one XML
  receipt listing each `task_id`, optional `session_id`, and status.
- `task_wait` takes `task_ids` (optional; defaults to every active task owned
  by the session) and `wait_ms` (default 30 000, hard cap 600 000). It blocks
  on the existing `TaskWaiterRegistry` (per task and per session), re-reads
  durable statuses after each wake-up, and returns one status line per task
  plus `timed_out`. It never stops work and never cancels delivery.
- Gating mirrors the existing delegation tools: `task_spawn` follows
  `features.delegation`; `task_wait` follows the task-control adapter and is
  blocked for canonical subagent roles so a child cannot park its parent.
- Completion notices are unchanged: each terminal task still wakes the owner
  through `background-task-finished`, which is the mechanism that resumes the
  parent after `task_wait` returned or timed out.
