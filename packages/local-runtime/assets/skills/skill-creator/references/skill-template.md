# Skill Template — the SKILL.md skeleton Alran uses

> This is a fill-in-the-blank template for reference, not a format to apply rigidly. Understand why each section exists first, then decide whether this skill needs it.

## Frontmatter

```yaml
---
name: <kebab-case-name>     # required, same as the directory name
description: |              # required, the trigger surface, what the LLM uses to decide whether to open the skill
  One-sentence capability + the concrete trigger scenario + the adjacent case that must not trigger
---
```

`description` — see `description-rubric.md`.

## Body sections (recommended order)

Principle: `description` handles triggering, the body handles execution. Do not write the same trigger conditions twice in the body.

```markdown
# <Skill Name>

## Inputs to collect
- What the LLM must ask the user or read from context before invoking the skill
- Without this section the model proceeds on wrong assumptions

## Procedure
- Step actions (imperative)
- Each step says "why this way", not just the command
- No ALWAYS / NEVER in the steps; write "why this way" and "what happens if you do not"

## Output contract
- What form this skill should output
- A file, a message, or structured data

## Failure handling
- What to do on failure: give up, degrade gracefully, report back to the user
- Warn about the likely sticking points up front

## Examples
- A real example (input → output), not a fictional placeholder
- One or two is enough, not five
```

Optional section: `Inputs to collect`. If the skill inputs are very direct, you can drop it.

Optional section: `## Windows (win32) platform notes`. If the skill contains shell commands, script invocations, or `python3` references, add a Windows adaptation section with the PowerShell equivalents or a cross-platform alternative. Pure-process skills (no shell commands) can skip it.

Not recommended: `When to use this skill`. Trigger conditions belong in the frontmatter `description`, so the context is not spent twice.

## Template example: filled in

Below is what a fictional `db-migrator` skill looks like when filled in with this template:

```markdown
---
name: db-migrator
description: |
  Generate and apply Postgres schema migrations. Use when the user asks to
  "add a column", "migrate the database", "alter a table" or describes a
  schema change. Do NOT use for one-off SQL queries (use direct psql instead).
---

# DB Migrator

## Inputs to collect
- The target table name (ask the user if it was not given)
- The kind of change and the fields it touches
- Whether it has to run in production (this decides whether to wrap it in a transaction)

## Procedure
1. Read the `migrations/` directory to confirm the next sequence number
   Reason: avoids a sequence conflict
2. Generate the up/down SQL with the template
   Reason: the down migration is the rollback safety net
3. Dry run it against a local docker postgres
   Reason: catches syntax errors without touching a real database

## Output contract
- One file `migrations/NNNN_<description>.sql`
- It contains an `-- up` and a `-- down` section

## Failure handling
- The dry run fails → report the error to the user, do not try to repair the SQL automatically
- A sequence conflict → skip the number, do not overwrite

## Examples
Input: "add a last_login_at timestamp to the users table"
Output: create `migrations/0042_add_users_last_login_at.sql`
```

## Writing constraints checklist

- Body ≤ 500 lines; split into `references/<topic>.md` when it grows past that and link with "see references/..."
- The body leads with execution actions, output constraints, and failure handling; no README-style background, feature tours, or modular API tutorials
- Trigger conditions and near misses belong in the frontmatter `description`, not in a repeated list in the body
- Keep one or two canonical examples; let the model self-check the rest through the script `--help`, the reference files, or the code
- Assume the reader is another model; do not assume it knows the project background
- If a passage is written for humans (teaching or historical background), mark it clearly so it does not pollute the model context
- The section order can change, but the first sections must answer quickly: what inputs are missing, how to execute, what to do on failure
