# Anti-Patterns — skill failures seen in real Alran projects

> This list was not copied from an outside source. It is distilled from real skill failures seen in Alran projects. Each entry states "why it is an anti-pattern + how to fix it".

## 1. Creating `.env` / `.env.example` / `.gitignore` by default

**Where it comes from**: the old `{{DATA_DIR}}/skills/skill-creator/SKILL.md` treated `.env.example` as the default scaffold.

**Why it is an anti-pattern**:
- Most skills need no external credentials (for example `pdf`, `alran`)
- A `.env` created out of thin air gives the user the false impression that configuration is "required"
- `.gitignore` is a repository-level concern and does not belong in a skill package

**How to fix**: create them only when the skill genuinely needs external credentials such as an API key. When creating a skill, ask up front: "Does this need external configuration?"

## 2. Putting README.md / CHANGELOG.md / INSTALLATION.md into the skill directory

**Where it comes from**: a skill imported from an outside marketplace (such as some ClawHub skills) whose directory holds five `.md` files.

**Why it is an anti-pattern**:
- A skill directory is read by an LLM, it is not product documentation for humans
- README/CHANGELOG/INSTALLATION target human readers and take up model context
- The model does not know whether it should read these files, so tokens are wasted

**How to fix**: keep only the files the LLM needs to execute. Put version history in git history, and put usage notes in the `When to use` section of SKILL.md.

## 3. Locking the model down with ALWAYS / NEVER / MUST

**Anti-pattern**:
```markdown
## Procedure
1. ALWAYS read the entire codebase first
2. NEVER use any tool other than Read
3. MUST output JSON
```

**Why it is an anti-pattern**:
- After reading a lot of ALWAYS/NEVER rules the model overfits to the literal rules and loses judgment
- Without a reason, the model can only execute edge cases rigidly or give up entirely
- A reasonable exception ("this time I only need a small patch, not the whole codebase") leaves the model stuck

**How to fix**: write "why this way" and "what happens if you do not". For example:
```markdown
1. Read the rough structure of the codebase first (avoids making assumptions that lead to editing the wrong file)
2. Prefer Read, and use Grep when needed (Read is slow but accurate, Grep is fast but may miss matches)
3. Output JSON, because a downstream script parses it; if JSON does not fit (a purely narrative answer, for example), use markdown instead but state "output format: markdown" explicitly at the end
```

## 4. A description that is only a pile of keywords

**Anti-pattern**:
```yaml
description: PDF, text, extract, OCR, parse, document, file, read
```

**Why it is an anti-pattern**:
- It never says "when to use it", so the LLM triggers on a keyword hit regardless of context
- It never says "when not to use it", so it collides with near-synonym skills (such as `pdf`)

**How to fix**: see `description-rubric.md`; a description must contain What + When + Near misses.

## 5. Packing several sub-skills / sub-agents into one skill package

**Anti-pattern**: a skill copied from an outside source, whose directory ships the full set: `agents/`, `sub-skills/`, `commands/`, `hooks/`.

**Why it is an anti-pattern**:
- A skill is a single capability package, not a mini-platform
- Multiple sub-skills make triggering ambiguous; the LLM does not know which one to activate
- Alran already has the Team Engine for multi-agent collaboration, so a skill does not need to build another one

**How to fix**: one skill, one clear capability. When collaboration across agents is needed, use a Team Engine plan instead of pushing it inside the skill.

## 6. An oversized SKILL.md (>500 lines) with everything in the main file

**Where it comes from**: community skills whose SKILL.md runs to 1000+ lines, with meta-theory such as 11 thinking models / 4-tier complexity.

**Why it is an anti-pattern**:
- After the skill triggers, those 1000 lines all enter context and squeeze the user's conversation space
- Most of that meta-theory is written for skill authors, not for the LLM that executes the skill

**How to fix**: keep the SKILL.md body at ≤ 500 lines, split detailed references into `references/<topic>.md`, and link them from the main file with "see references/foo.md". The LLM reads them only when it needs them.

## 6.5 Writing SKILL.md as a README / tutorial / API doc

**Anti-pattern**: a main file full of "What this tool does", "How it works", "Command line usage", "As a Python module", plus a long list of sample commands.

**Why it is an anti-pattern**:
- A skill is for another model to execute, not for humans to read product documentation
- Background, feature tours, and module examples dilute the execution contract that actually matters
- This kind of content most easily duplicates the trigger information in the frontmatter and burns context for nothing

**How to fix**:
- `description` answers "when to trigger / when not to trigger"
- The body keeps only procedure / output contract / failure handling / a very small number of canonical examples
- When details are needed, prefer sending the model to the script, `--help`, or `references/`

## 7. Using a Python toolchain (inconsistent with the Alran ecosystem)

**Anti-pattern**: a skill copied from an outside source that ships `requirements.txt`, Python scripts, and dependencies that need `pip install`.

**Why it is an anti-pattern**:
- The Alran daemon / CLI is Node.js / TypeScript ESM
- Pulling in Python dependencies adds complexity to the user's environment
- Most scripts a skill needs (validation, aggregation) are fine with Node.js and the built-in fs

**How to fix**: write scripts in Node.js without third-party npm packages (unless Alran already installs them).

## 8. Copying external skill scripts / templates / schemas into Alran

**Anti-pattern**: copying the upstream skill-creator's `quick_validate.py` / `evals.json` schema, renaming it, and using it as is.

**Why it is an anti-pattern**:
- An external schema is designed for an external ecosystem (Python / another coding agent) and may not fit Alran
- Even when it runs, it is a "transplanted organ from a stranger" — later nobody knows why it was written that way
- Alran's own context (Team Engine, scratchpad, agent system) calls for a different design

**How to fix**: borrow the idea, but implement every file originally for what Alran actually needs. See `when-to-bundle-scripts.md`.

## 9. Not explaining "why this skill exists"

**Anti-pattern**: a weak frontmatter `description`, with the body jumping straight to `## Procedure`, so the trigger boundary stays unclear.

**Why it is an anti-pattern**:
- The LLM mainly decides whether to open a skill by reading `description`
- If `description` does not spell out the capability boundary and the near misses, the model may miss the trigger or trigger wrongly

**How to fix**: put What / When / Near misses in `description` first. Add input requirements to the body only when they are genuinely needed; do not repeat the trigger list.

## 10. Depending on an external install script / install.sh by default

**Anti-pattern**: an `install.sh` that edits the user's `~/.bashrc` / `~/.zshrc` automatically.

**Why it is an anti-pattern**:
- A skill is a protocol artifact and should have no side effects
- Users are extremely sensitive about changes to their shell config
- Alran discovers and loads skills on its own, so no install script is needed

**How to fix**: keep install.sh out of the skill package. If a skill genuinely needs an external dependency, state "please run X manually" in the `## Setup` section of SKILL.md (only add that section when it is actually needed).

## 11. Shell commands written only for bash, with no Windows adaptation

**Where it comes from**: early skills that only wrote bash commands such as `python3 scripts/xxx.sh | grep "Page size"`, which Windows users cannot run.

**Why it is an anti-pattern**:
- Alran runs commands directly in PowerShell on Windows, with no Unix fallback layer
- `python3` (usually `python` on Windows), `grep`, `sed`, `/tmp/` and similar do not exist in PowerShell or behave differently
- Users should not have to translate commands themselves just to run a skill

**How to fix**: if a skill contains shell commands, script invocations, or `python3` references, add a `## Windows (win32) platform notes` section with the PowerShell equivalents or a cross-platform alternative. Pure-process skills can skip it.
