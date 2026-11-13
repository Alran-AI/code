# Install, update, entry points and shortcuts

Use this reference for installing, updating and uninstalling, the ways to start Alran Code,
configuration paths, environment variables and shortcuts.

## Install, update, uninstall

- **npm:** `npm install -g alran`, then `alran --version`. pnpm, yarn and bun global installs work
  the same way. An installer script installs into `~/.alran-code` (or `ALRAN_INSTALL_DIR`) without
  administrator rights: the exact command is shown in the AI Platform under Settings → Alran Code,
  and it needs an installed Node.js. `ALRAN_NO_MODIFY_PATH` keeps it from editing shell files.
- **Update:** `alran update` detects how Alran Code was installed and either runs the package
  manager's global install after a confirmation, updates an installer-managed prefix, or prints the
  command. The plain commands (`alran usage`, `alran models`, …) print a one-line hint at most once
  a week when a newer version exists; `ALRAN_NO_UPDATE_CHECK=1` and `CI` switch it off.
- **Uninstall:** `npm uninstall -g alran` for a global npm install. For an installer-managed prefix
  remove the install directory and the `# Alran Code CLI` PATH line the installer added; the README
  lists the exact steps. User data in `~/.alran` stays unless the user deletes it.
- A package called `@ottili/alran-code` or `@ottili/code` from earlier builds is not updated in place:
  `alran update` says to uninstall it and install `alran`.

## Entry points

| Command | Use |
| --- | --- |
| `alran [prompt]` | The interactive TUI in the current directory |
| `alran exec [prompt]` | Headless runs: scripts, CI, batch work |
| `alran acp` | Editors and clients that speak the Agent Client Protocol |

## Environment

`ALRAN_API_KEY` (an API key for scripted use), `ALRAN_API_BASE` (the gateway),
`OTTILI_PLATFORM_URL` (the Platform), `ALRAN_LOGIN_FLOW` (`device` or `browser`), `ALRAN_DATA_DIR`
(default `~/.alran`), `ALRAN_NO_UPDATE_CHECK`.

## Shortcuts

`Enter` sends or steers the running task · `Alt+Enter` queues a follow-up · `Shift+Enter` inserts a
newline · `@` references a file or directory · `Shift+Tab` toggles Plan mode · `Alt+M` cycles the
permission modes · `Esc` closes a panel or interrupts a running task. `/help` lists every command and
shortcut and `/hotkeys` shows and edits the bindings. If `Option+M` types `µ` in a terminal, the
terminal is not forwarding the modifier (Ghostty: `macos-option-as-alt`).

## Diagnostic workflow

1. Identify the operating system, the installation method and `alran --version`.
2. Compare with the latest release from the public version endpoint named in `SKILL.md`; say "not
   released yet" when it reports `published: false`.
3. Check the documented behavior against what the user sees, and give the shortest concrete next
   action. Separate documented behavior from the state of their account.

## Boundaries

Explain what the user can observe. Do not bypass a permission prompt, and do not claim that an
update, an installation or a configuration change happened without the output of the command that did
it.
