# When to Bundle Scripts — when to write a script vs. use another mechanism

> A common mistake is "see something a script could do, so write a script". Alran already has several mechanisms for different kinds of work; decide what the task fundamentally is first, then pick the mechanism.

## Decision tree

```
Is there an action the skill must run repeatedly →
│
├─ Is it deterministic local computation (no LLM judgment needed)?
│   ├─ Yes → write a Node.js script (put it in scripts/)
│   └─ No  → continue down
│
├─ Does an Alran native tool already handle it?
│   ├─ Yes → call that tool directly (`alran` / `skill`, etc.), no script
│   └─ No  → continue down
│
├─ Does it involve multi-agent collaboration / review / comparison?
│   ├─ Yes → use a background Task subagent, describe the split in the SKILL.md procedure
│   └─ No  → continue down
│
├─ Does it involve passing state across sessions?
│   ├─ Yes → use the scratchpad (no file written)
│   └─ No  → continue down
│
└─ Is it judgment / creative work?
    └─ Let the LLM do it directly in the SKILL.md procedure, no script
```

## Which mechanism fits which kind of work

### Use a script (scripts/*.js)

Fits: **purely local deterministic computation / validation / formatting**

Examples:
- `lint-skill.js` — validates the SKILL.md format and frontmatter
- File parsing, counting, conversion

**Test**: the same input always produces the same output, with no LLM involved.

**Constraint**: use Node.js and the built-in fs, no third-party npm packages.

### Use an Alran native tool

Fits: **capabilities Alran already wraps**

Examples:
- List existing skills → read the `<available_skills>` block in context
- Check session state → `alran({ command: "session list" })`
- Manage scheduled tasks → `alran({ command: "cron list" })`

**Test**: whether the action is already a standard Alran API. If it is, call it directly instead of wrapping it in a script.

### Use a background Task subagent

Fits: **multi-agent collaboration / comparative review / a verify loop** (the task tool with `run_in_background: true`; a foreground task call blocks in sequence, only a background call runs truly in parallel)

Examples:
- Skill evaluation: a producer / baseline pair of background subagents running in parallel, with the main session writing the comparison
- Multi-angle review: 3 reviewers checking one document independently and concurrently

**Test**: whether the action means "assign work to several workers, wait for results, then summarize". If it does, express it as background Task subagents in the SKILL.md procedure; do not orchestrate workers by hand inside a script.

### Use the scratchpad

Fits: **passing information across sessions**

Examples:
- Feedback from cycle N of a skill iteration is passed to cycle N+1
- Several workers share intermediate state

**Test**: whether the information needs to be visible to more than one session. If it does, write a scratchpad file instead of stuffing it into agent memory (agent memory holds accumulated experience, not temporary progress).

### Let the LLM do it directly

Fits: **judgment / creative work / work that needs context understood**

Examples:
- Naming a skill
- Writing the description
- Deciding whether to reuse or create
- Judging which of two skill outputs is better

**Test**: a different input needs a different way of handling it → let the LLM do it directly in the SKILL.md procedure.

## Anti-patterns: scripts written when they are not needed

### Anti-pattern A: a script that scans existing skills

```js
// scan-existing-skills.js — unnecessary
const skills = fs.readdirSync('{{DATA_DIR}}/skills/');
const matches = skills.filter(s => s.includes(query));
```

**Problem**: the `<available_skills>` block in context already lists every skill, so read it instead of writing a script.

### Anti-pattern B: a script that runs the eval

```js
// run-eval.js — unnecessary
runWorker(`load ${skillPath} and handle: ${prompt}`);
runWorker(prompt);  // baseline
compareOutputs();
```

**Problem**: this is the classic producer/baseline/compare workflow and belongs in background Task subagents. Spawning workers by hand inside a script rewrites the subagent orchestration.

### Anti-pattern C: a script that aggregates iteration feedback

```js
// summarize-iteration.js — unnecessary
const feedback = JSON.parse(fs.readFileSync('feedback.json'));
const summary = aggregateByCategory(feedback);
fs.writeFileSync('summary.md', summary);
```

**Problem**: this is judgment work (what counts as "important feedback" and what counts as "noise"), so the LLM should read the eval feedback plus the scratchpad and handle it directly in the SKILL.md procedure.

## The upstream hint: "read the transcript to spot reinvention"

The upstream skill-creator offers a useful test: **after a few eval rounds, read the worker transcripts; only when several workers independently wrote the same helper function does that action deserve to be bundled into a script**.

In other words:
- Scripts are not decided up front, they are **discovered** during iteration
- Do not rush to write scripts for the first version of a skill; let the LLM do the work first and watch which actions are genuinely frequent and deterministic
- Only the frequent and deterministic parts sink down into scripts

## Summary: Occam's razor checklist

Ask before writing a script:
- [ ] Does an Alran native tool already handle it?
- [ ] Does it involve multiple agents (→ background Task subagents)?
- [ ] Does it involve multiple sessions (→ scratchpad)?
- [ ] Can the LLM do it (→ write it straight into the procedure)?
- [ ] Is it really deterministic local computation?

Answer all five questions; write the script only when the last answer is still "yes".
