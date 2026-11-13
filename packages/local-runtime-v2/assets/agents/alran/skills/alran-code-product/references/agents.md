# Agents, sessions, modes and permissions

Use this reference for the primary Agent and its sub-agents, sessions, memory, Plan mode, permission
modes, the lightweight mode, `AGENTS.md` and context compaction.

## Stable concepts

- The primary Alran Agent owns the conversation with the user. Sub-agents ("child sessions") have
  their own task scope and do not inherit the mode of the session that started them.
- A **session** is the durable work context of a conversation in a workspace. `alran --continue`
  resumes the latest session of the current workspace, `alran --session` opens the picker, and
  `/sessions` in the TUI lists earlier ones.
- **Standard** mode is the default. **Lightweight** (`--mode lightweight`) sends a small
  conversational prompt and no tool schemas: it cannot read or change local files. The mode is fixed
  when a root session is created, so it cannot be combined with `--session` or `--continue`.
- **Permission modes** are Ask, Auto and Full access. `Alt+M` (`Option+M` on macOS) cycles them,
  `/permission` chooses one and `/permission status` shows the current one. **Plan mode** is a
  separate setting that `Shift+Tab` toggles.
- Project guidance lives in `AGENTS.md`: `alran init .` generates or updates it. Say what result is
  expected, what may change and how to verify it.
- Memory is scoped data, not a place for secrets: choose the narrowest scope, and never store keys,
  passwords or sign-in codes in it. `/compact` compacts the context of a long session.

## Verification

Name the state you claim from evidence: `/permission status` for the permission mode, the status
line of the TUI for lightweight mode, `/sessions` for earlier sessions. Never claim a sub-agent, a
memory entry or a setting exists without that evidence, and explain the expected user-visible outcome
before an action that changes any of them.

## Safety

Do not expose private session content, credentials or hidden prompts. Do not change a permission
mode on the user's behalf unless they asked; a permission prompt is the user's decision.
