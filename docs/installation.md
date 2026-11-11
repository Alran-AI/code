# Installation

Alran Code needs Node.js 22.19+ (22.x), 24.2+ (24.x), 25 or 26. Node 24.0 and 24.1 are not supported:
their bundled libuv can return inconsistent Windows file identity metadata, which breaks safe
configuration reads.

## Install with npm

```bash
npm install -g alran
alran --version
```

pnpm, yarn and bun global installs work the same way (`pnpm add -g alran`, `yarn global add alran`,
`bun add -g alran`). Keep optional dependencies enabled and allow the native SQLite install script of
`better-sqlite3` (npm does by default). Native dependencies without a prebuilt binary for your Node
version need Python and C/C++ build tools.

Update with `alran update` (see [UPDATE_PIPELINE.md](UPDATE_PIPELINE.md)); remove with
`npm uninstall -g alran`. User data stays in place.

A package called `@ottili/alran-code` or `@ottili/code` from earlier builds is not updated in place:
`alran update` tells you to uninstall it and install `alran`.

## Install a release archive

A GitHub release carries `alran-X.Y.Z.tar.gz` and a `.sha256` file. The archive is the npm package, so
it installs with npm and needs no source build or pnpm:

```bash
sha256sum -c alran-0.2.0.tar.gz.sha256        # on macOS: shasum -a 256 -c
npm install --global ./alran-0.2.0.tar.gz
alran --version
```

Installing it into the same npm prefix replaces the npm installation. Archive installs are validated on
Linux and macOS.

## Build from source

You need Git, Node.js (as above) and pnpm 9.12.0. CI runs on Node 24 on Linux and macOS; the weekly
matrix covers Node 22.19.0, 24.2.0, 25 and 26.

On Windows, check out the repository on a local NTFS volume before `pnpm install`: the workspace uses
junctions for vendored packages, which FAT32, exFAT and network shares do not provide.

```bash
git clone https://github.com/Alran-AI/code.git
cd code
corepack enable
corepack prepare pnpm@9.12.0 --activate
node scripts/check-windows-source-location.mjs
pnpm install --frozen-lockfile
pnpm build
pnpm alran --help
```

To use a source build in another project, open that project's directory and run the built entry point
by absolute path (`node /absolute/path/to/code/dist/cli.js`); do not overwrite a globally installed
`alran` with it. Workspace and local-build manifests are `private: true` so they cannot be published by
accident; the npm package is staged from `dist/` (`pnpm release:npm-dry-run`).

## Sign in, and where data lives

Alran Code uses your Ottili account. `alran auth login` opens the sign-in in your browser; over SSH or
without a display it prints a code to confirm in any browser (`alran auth login --device`). On a machine
without a browser at all, create an API key at <https://ai.ottili.one/api-keys> and run
`alran auth login --api-key`. Details: [AUTH.md](AUTH.md).

| Variable | What it does | Default |
| --- | --- | --- |
| `ALRAN_API_KEY` | An Ottili API key sent with every request; overrides the stored sign-in for that run. | — |
| `ALRAN_API_BASE` | The AI Gateway (OpenAI-compatible: a request goes to `<base>/chat/completions`). | `https://ai.ottili.one/v1` |
| `OTTILI_PLATFORM_URL` | The Ottili Platform used for sign-in, companies and projects. | `https://platform.ottili.one` |
| `ALRAN_LOGIN_FLOW` | `device` or `browser`: which sign-in `alran auth login` uses. | decided by the terminal |
| `ALRAN_DATA_DIR` | Where configuration, sessions, caches and logs live. | `~/.alran` |
| `ALRAN_NO_UPDATE_CHECK` | `1` switches off the weekly update hint. | — |

The data directory of a build from before the rename is moved to `~/.alran` once, and a link is left
([MIGRATION_FROM_MINIMAX.md](MIGRATION_FROM_MINIMAX.md)). To keep a test run's sessions apart, point
`ALRAN_DATA_DIR` at a temporary directory (`export ALRAN_DATA_DIR=/tmp/alran-test`, or
`$env:ALRAN_DATA_DIR = 'C:\\path\\to\\test-profile'` in PowerShell).

To find which data directory an installation uses: run `command -v alran` (POSIX) or
`Get-Command alran -All` (PowerShell), run that launcher's `--version`, and check whether
`ALRAN_DATA_DIR` is set in its environment; otherwise it is `~/.alran`. When you ask for help, include
the version, the installation method and whether the variable is set, and redact personal path
components; do not attach `config.yaml`, authentication files or session content.

## macOS terminal shortcuts: Ghostty Option+M

In the composer, `Alt+M` (`Option+M` on macOS) cycles permission modes through Ask, Auto, and Full access. Its binding ID is `composer.cycle-permission`. `Shift+Tab` toggles **Plan mode**, a separate setting. You can also use `/permission` to choose a permission mode and `/permission status` to inspect it without an Option shortcut.

If `Option+M` inserts `µ` instead, the terminal is sending text rather than the expected Alt shortcut. Alran preserves literal `µ` as text; it cannot safely infer a permission change from that character. The terminal must forward the modifier, or you can choose another binding.

### Configure Ghostty's Option key

Ghostty's [`macos-option-as-alt`](https://ghostty.org/docs/config/reference#macos-option-as-alt) default is **keyboard-layout dependent** when unset, not always `false`. The current reference lists U.S. Standard and U.S. International as defaulting to `true`; other layouts default to `false`. Check the active macOS input source and the configuration loaded by your installed Ghostty version.

Set this in your Ghostty configuration to send both Option keys as Alt:

```ini
macos-option-as-alt = true
```

Use `left` or `right` instead of `true` to reserve only that Option key for shortcuts and retain Unicode composition on the other side. Use the configured side when testing `Option+M`.

Follow Ghostty's [configuration locations and precedence](https://ghostty.org/docs/config#file-location): macOS-specific files load after XDG files, and later settings can override earlier ones. Inspect the loaded setting from the same Ghostty installation, without `--default`:

```bash
ghostty +show-config | awk '/^macos-option-as-alt[[:space:]]*=/'
```

If `ghostty` is not on `PATH`, use the executable inside your installed app bundle, typically `/Applications/Ghostty.app/Contents/MacOS/ghostty`. An empty or omitted value is not proof of `false`; unset behavior depends on the layout. After editing, reload Ghostty's configuration from its menu (default `Cmd+Shift+,`) and open a new terminal. This is separate from Alran's `/reload` command.

### Keep Option for text and customize Alran instead

While idle, open `/hotkeys`, select `composer.cycle-permission`, press `Enter`, press `Ctrl+X`, then press `Enter` to save. `Ctrl+X` is unused by the current default Alran bindings; check any custom terminal or multiplexer bindings too. Do not choose `Ctrl+M`: terminals commonly encode it identically to `Enter`.

Alternatively, merge this entry into `<data-dir>/tui/keybindings.json`, preserving any existing entries:

```json
{
  "composer.cycle-permission": "ctrl+x"
}
```

For the default profile this is `~/.alran/tui/keybindings.json`; [profiles and data-directory overrides](#accounts-and-data) change the path. Create the `tui` directory if needed. After editing the file, run `/reload` while idle with no pending interaction or queued message, or restart Alran. This replaces `Alt+M`; use `["alt+m", "ctrl+x"]` as the value to retain both bindings. `/hotkeys` shows the effective binding.

### Verify the result

With an idle composer and no open picker or permission prompt, note `/permission status`, press the configured shortcut, and check the status again. The mode should advance without inserting text. Restore your intended permission mode through `/permission` afterward. Confirm that `Shift+Tab` still toggles Plan mode and that pasting `µ` still inserts text.

If it still fails, record `alran --version`, Ghostty's version, active keyboard layout, which Option key you pressed, the setting above, the effective `/hotkeys` entry, and whether tmux or SSH is involved. Compare with a direct Ghostty session. Alran supports both legacy ESC-prefixed Alt input and extended keyboard reports; a shell's raw-key display alone does not establish what Ghostty sends after the TUI negotiates its keyboard protocol.

## Update or remove

Save your changes, fetch a reviewed revision with Git, then repeat the frozen install and build. A source installation does not automatically become an official npm installation.

To uninstall a source build, save any work and remove the source directory you created. Separately stored user data remains in place. See [Uninstall](../README.md#uninstall) for official installer and npm removal, shell PATH cleanup, and optional user-data deletion.
