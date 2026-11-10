# Installation packages and source builds

## Install a GitHub release archive

When a CLI release is available on [GitHub Releases](https://github.com/ottili/alran-code/releases),
download `alran-code-X.Y.Z.tar.gz` and the matching `.sha256` file. This is an npm
installation package containing the built CLI; no source build or pnpm is needed.
Install Node.js 22.19+ (22.x), 24.2+ (24.x), 25 or 26 first. npm still needs network
access to public npm for runtime dependencies. Native dependencies can require
Python and C/C++ build tools when no matching prebuilt binary is available.

For example, for an available `v0.4.13` release:

```bash
# Linux; on macOS use: shasum -a 256 -c alran-code-0.4.13.tar.gz.sha256
sha256sum -c alran-code-0.4.13.tar.gz.sha256
npm install --global ./alran-code-0.4.13.tar.gz --registry=https://registry.npmjs.org/ --include=optional --ignore-scripts=false --allow-scripts=better-sqlite3
alran --version
```

Keep optional dependencies enabled and allow the native SQLite installation
script. The tag determines the installed version. GitHub archive installation is
validated on Linux and macOS; Windows package acceptance is currently not run.

This archive uses the same `@ottili/alran-code` package name, `alran` command and
default user data directory as the official npm CLI. Installing it globally into
the same npm prefix replaces that npm installation. Update to another GitHub
version by explicitly installing its archive; the built-in updater follows the
official npm registry channel and does not select GitHub release assets. To remove
the package, use `npm uninstall --global @ottili/alran-code`. User data remains in place.

## Install from source

The official CLI is available as [`@ottili/alran-code`](https://www.npmjs.com/package/@ottili/alran-code). Public npm `latest` was 0.6.9 on 2026-10-13. Follow the [official quick start](https://api.ottili.one/docs/cli/quick-start) or the [README installation steps](../README.md#quick-start) for the macOS / Linux / WSL installer, Windows PowerShell installer, or npm installation.

For npm, use the command in the README: it explicitly selects the public registry, includes optional dependencies, and allows the `@ottili/alran-code` and `better-sqlite3` lifecycle scripts. SQLite is declared optional in the package metadata, but a working native SQLite binding is required at runtime. Do not omit optional dependencies or disable installation scripts. On npm versions that enforce script approvals, `--allow-scripts` grants these two packages permission without allowing every dependency script.

`@latest` follows the stable npm dist-tag. For a reproducible CLI version, replace `@latest` with an exact published version such as `@0.6.9`, keeping the other options. Use Node.js 22.19+ (22.x), 24.2+ (24.x), 25, or 26 for both npm and source installations.

This guide builds the 0.6.3 source preview. Workspace and local-build manifests remain `private: true` to prevent accidental publishing, except `@ottili/alran-code-sdk`. That package is public and is published only as a checked tarball (`packages/code-sdk/RELEASING.md`); `prepublishOnly` rejects `npm publish` in the package directory. A source checkout may contain additional reviewed distribution changes; matching version strings alone do not establish byte-for-byte or build-provenance equivalence with the official npm tarball. Use the committed source revision and release receipt to identify a source build.

For a source build, you need Git, Node.js 22.19+ (22.x), 24.2+ (24.x), 25, or 26, and pnpm 9.12.0. Regular CI uses Node.js 24 across Linux and macOS. The weekly and manual compatibility matrix covers Node.js 22.19.0, 24.2.0, 25, and 26 on both platforms. Windows CI and source-candidate validation are temporarily paused while their checks are made reliable. Initial installation and build require access to public npm.

On Windows, check out this repository on a local NTFS volume before running `pnpm install`. The repository uses pnpm workspace links for vendored packages, and those links require NTFS junctions. FAT32/exFAT volumes, network shares, and other non-local Windows volumes cannot create the required junctions. The preflight command below verifies the volume and stops with a clear message before pnpm creates workspace links; run it immediately before `pnpm install`. It queries structured volume properties through Windows PowerShell and CIM, without requiring an elevated shell or parsing localized `fsutil` output. If PowerShell or CIM is unavailable or blocked, verification fails with the query error. A local NTFS volume can still contain a cloud-synced folder, which the preflight cannot identify reliably; keep the checkout outside OneDrive, Google Drive, Dropbox, and similar synced folders.

Node 24.0 and 24.1 are unsupported: their bundled libuv can return inconsistent Windows file identity metadata, causing safe configuration reads to fail. [Node 24.2.0](https://nodejs.org/en/blog/release/v24.2.0) includes libuv 1.51.0 with the [upstream fix](https://github.com/libuv/libuv/commit/82cdfb75f). Use a current patch release of a supported Node line.

```bash
git clone https://github.com/ottili/alran-code.git
cd alran-code
corepack enable
corepack prepare pnpm@9.12.0 --activate
node scripts/check-windows-source-location.mjs
pnpm install --frozen-lockfile
pnpm build
pnpm alran --help
pnpm alran
```

If your Node.js installation does not include Corepack, install the exact pnpm version using your existing package manager. Native dependencies without matching prebuilt binaries require C/C++ build tools and Python: the C++ workload in Visual Studio Build Tools on Windows, Command Line Tools on macOS, or the system build toolchain on Linux.

The build embeds the vendored `alran-tools` CLI from `third_party/alran-tools` and verifies its pinned hash. The vendored copy is the rebranded upstream tool, so the CLI and the in-repo host agree on their runtime contract (the environment variables the tool reads, the authentication lease socket names, and the platform base URLs). A modified artifact fails the build; never bypass the hash verification.

To use the CLI in another project, open that project's directory and run the built entry point by absolute path:

```bash
node /absolute/path/to/alran-code/dist/cli.js
```

On Windows, also use `node` with the appropriate local absolute path. Do not overwrite another globally installed command with this source build.

A source build talks to the Ottili AI Platform. Point it at your key before the first request:

```bash
export ALRAN_API_KEY=sk-ottili-...
export ALRAN_API_BASE=https://ai.ottili.one/v1   # optional; this is the default
pnpm alran
```

For a locally running AI Platform, set `ALRAN_API_BASE=http://127.0.0.1:3000/v1` (the same value `NODE_ENV=development` selects automatically). See [Accounts and data](#accounts-and-data) for the full environment variable list.

## Accounts and data

Alran Code has no account system of its own. The Ottili platform owns identity, tenant isolation, credits, and metering; the CLI authenticates with an Ottili API key.

Run `alran login` to sign in. The command opens the Ottili API key page in a browser, reads the `sk-ottili-...` key you paste, and stores it in the local config (`~/.alran/config.yaml`, owner-readable only). `alran logout` removes the stored key. See the root README for BYOK configuration and testing.

### Environment variables

| Variable | What it does | Default |
| --- | --- | --- |
| `ALRAN_API_KEY` | Ottili API key sent with every request. Overrides the stored key for that run. | — (required) |
| `ALRAN_API_BASE` | Ottili AI Platform gateway base URL. The gateway is OpenAI-compatible, so a request goes to `<base>/chat/completions`. | `https://ai.ottili.one/v1` |
| `OTTILI_PLATFORM_URL` | Ottili platform origin used for auth and identity checks, and for the API key page that `alran login` opens. | `https://api.ottili.one` |
| `ALRAN_DATA_DIR` | Directory holding configuration, sessions, caches, and logs. | `~/.alran` |

Source builds and the published npm CLI use the same default user data directory:

| CLI artifact | Default user data directory |
| --- | --- |
| Published npm `@ottili/alran-code@0.6.9` | `~/.alran` |
| Build from this repository | `~/.alran` |

The npm 0.6.9 default was checked against the [public registry artifact](https://registry.npmjs.org/@ottili/alran-code/0.6.9) on 2026-10-13, with its SHA-512 integrity verified. This applies to that published version, including local npm dependencies; do not infer the default of another release from its version label alone. A selected profile uses `~/.alran-<profile>`. The source default is defined in [`data-dir.ts`](../packages/tui/src/runtime/data-dir.ts). Login state, provider configuration such as `config.yaml`, caches, and sessions belong to the selected data directory.

Both accept a non-empty `ALRAN_DATA_DIR`, falling back to a non-empty `ALRAN_DATA_DIR`, before the default. The [macOS / Linux / WSL installer](https://cdn.ottili.one/public/install.sh) installs the npm package under `~/.alran-code` by default (`ALRAN_INSTALL_DIR` changes the installation location). It does not set either data-directory override. Installation files and user data are separate concerns, even when their directories have the same name.

Earlier source builds used `~/.alran-code` for user data. The new default does not move or merge that data. To keep using an existing source-build data directory, explicitly set `ALRAN_DATA_DIR` to its path.

To locate data safely:

1. Identify the launcher you actually use with `command -v alran` (POSIX) or `Get-Command alran -All` (PowerShell), and run that launcher's `--version`. For a local npm dependency, use `node_modules/.bin/alran --version`; a global npm listing does not identify it. A source build may report the same version as the npm release.
2. Check whether either data-directory override is set in that launcher's environment. Otherwise use the artifact-specific default above. Inspect directory and file names/permissions locally, without printing `config.yaml`, authentication files, or session contents. For builds from this repository, `alran telemetry status` also reports the selected `configFile` path without printing credentials; npm 0.6.9 does not provide that command.
3. If both directories exist, their presence alone does not identify the active one. Keep both protected, and include the launcher, version, installation method, and whether overrides are set when requesting help. Redact personal path components; do not attach configuration or authentication files. Changing an override does not migrate existing data, so do not move or delete either directory merely to match these docs.

For tests, explicitly set `ALRAN_DATA_DIR` to a temporary directory to keep normal sessions separate. Use `$env:ALRAN_DATA_DIR = 'C:\path\to\test-profile'` in PowerShell or `export ALRAN_DATA_DIR=/path/to/test-profile` in a POSIX shell.

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
