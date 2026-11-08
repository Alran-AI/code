<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/wordmark-light.svg">
    <img src="docs/assets/wordmark-light.svg" alt="Alran Code" width="760">
  </picture>
</p>

<h1 align="center">Alran Code</h1>
<p align="center">Turn a prompt into something that works. Build, test, and keep iterating from your terminal—with Alran or your own model.</p>
<p align="center">
  <a href="#quick-start">Get started</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/examples.md">Examples</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>
<p align="center"><strong>English</strong> · <a href="README_ZH.md">简体中文</a></p>
<p align="center">
  <img src="docs/assets/source-preview.svg" alt="Source preview">
  <img src="docs/assets/node.svg" alt="Compatibility: Node.js 22.19+, 24.2+, 25, and 26">
  <a href="LICENSE-STATUS.md"><img src="docs/assets/license.svg" alt="First-party default license: MIT"></a>
</p>

Give a blinking pocket pet a focus timer. Then ask: “Make pause a long press, and celebrate when the timer ends.” Watch a request become something you can actually use.

[![Pocket Pet: from a blinking face to a working focus companion](docs/assets/pocket-pet-demo.png)](docs/demo.md)

<p align="center"><a href="docs/demo.md">Watch the build story and browser demo →</a> · <a href="examples/pocket-pet">Build it yourself →</a></p>

**No hardware required.** The example runs locally in your browser, with no frontend dependencies. Asking the CLI to edit code requires an Ottili API key with available credits or your own compatible model API; model calls may incur charges. The finished example runs without a model account.

## Quick start

### 1. Install Alran

Use the official installer for your platform. It installs the latest CLI, prepares a compatible Node.js runtime when needed, and does not require `sudo` or administrator privileges. Alpine / musl Linux is not supported by the one-command installer.

**macOS / Linux / WSL**

```bash
curl -fsSL https://cdn.ottili.one/public/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://cdn.ottili.one/public/install.ps1 | iex
```

The scripts install into `~/.alran-code` on macOS / Linux / WSL and `%USERPROFILE%\.alran-code` on Windows. The launchers are `bin/alran` and `bin/alran-tools` on POSIX, or `alran.cmd` / `alran.ps1` and `alran-tools.cmd` / `alran-tools.ps1` on Windows. Set `ALRAN_INSTALL_DIR` before installation to choose a different location. See [Uninstall](#uninstall) to remove the CLI.

**npm** — if you already have **Node.js 22.19+ (22.x), 24.2+ (24.x), 25, or 26**:

```bash
npm install -g @ottili/alran-code@latest --registry=https://registry.npmjs.org/ --ignore-scripts=false --include=optional --allow-scripts=@ottili/alran-code,better-sqlite3
```

The npm command uses the public registry, includes the optional SQLite dependency, and permits the package and SQLite installation scripts. See the [installation guide](docs/installation.md) for version pinning and Node.js compatibility.

Reopen your terminal and check the installation:

```bash
alran --version
alran --help
```

See the official [quick start](https://api.ottili.one/docs/cli/quick-start), [features](https://api.ottili.one/docs/cli/features), and [troubleshooting](https://api.ottili.one/docs/cli/faq).

### 2. Connect Alran Code to the Ottili AI Platform

Alran Code has no account of its own. The Ottili platform owns identity, tenant isolation, credits, and metering; the CLI authenticates with an Ottili API key.

```bash
alran login
```

`alran login` opens the Ottili API key page in your browser. Copy a key — it starts with `sk-ottili-` — paste it at the prompt, and the CLI stores it in `~/.alran/config.yaml` with owner-only permissions. Run `alran logout` to remove the stored key.

The same key can come from the environment, which overrides the stored key for that run:

```bash
ALRAN_API_KEY=sk-ottili-... alran
```

Open `alran` and use `/status` to check the connection and `/provider` to choose a model.

### Environment variables

| Variable | What it does | Default |
| --- | --- | --- |
| `ALRAN_API_KEY` | Ottili API key sent with every request. | — (required) |
| `ALRAN_API_BASE` | Ottili AI Platform gateway base URL. The gateway is OpenAI-compatible, so a request goes to `<base>/chat/completions`. | `https://api.ottili.one/v1` (`http://127.0.0.1:3000/v1` when `NODE_ENV=development`) |
| `OTTILI_PLATFORM_URL` | Ottili platform origin used for auth and identity checks, and for the API key page that `alran login` opens. | `https://api.ottili.one` |
| `ALRAN_DATA_DIR` | Directory holding configuration, sessions, and logs. | `~/.alran` |

### Models

Alran Code keeps its own model identities — they drive thinking modes, effort levels, and context selection — and translates each one to an Ottili AI Platform model id at the request boundary.

| CLI model | Ottili model id | Tier |
| --- | --- | --- |
| `Alran-M2.7-highspeed` | `ottili/kern-1.1` | Fast / Router — a routing model, not intended for coding work |
| `Alran-M2.7` | `ottili/fels-1.1` | Standard |
| `Alran-M3.1-Flash` | `ottili/werk-1.1` | Smart / Coding (default) |
| `Alran-M3` | `ottili/werk-1.1-pro` | Premium |

Requests are billed and metered by the Ottili platform against the key that made them. Builds from this repository and the published npm CLI `@ottili/alran-code@0.6.9` default to `~/.alran` for user data (or `~/.alran-<profile>` when a profile is selected). `ALRAN_DATA_DIR` or `MAVIS_DATA_DIR` can override the data directory. The installer's `~/.alran-code` installation directory is separate from this choice. See [Accounts and data](docs/installation.md#accounts-and-data) before locating or removing configuration and sessions.

<details>
<summary>Use your own API key (BYOK)</summary>

BYOK does not require an Ottili API key. Set `ALRAN_PROVIDER_API_KEY` in your current shell, then add a provider. Replace the example URL and model name with your provider's values:

```bash
alran provider add --name my-provider --base-url https://example.com/v1 \
  --api-format openai-completions --model my-model \
  --api-key-env ALRAN_PROVIDER_API_KEY --use
alran
```

`--use` tests the first listed model before saving and selecting it. A failed connection test saves nothing. Omit `--use` to save without testing or changing the default model. For custom/local models, add `--context-limit 32768 --output-limit 4096` (use your server's actual limits). Each value must be a positive safe integer and applies to every repeated `--model`. Inspect configured limits with `alran provider list --json`. Omitting these flags preserves the existing model-limit defaults.

Supported API formats: `openai-completions`, `openai-responses`, and `anthropic-messages`. See the [model examples](docs/examples.md#2-choose-your-own-model) for environment variable setup, connection checks, and model overrides for a single run.

Providers added this way are stored under `custom_provider` in the active profile's `config.yaml`; this is the supported path for third-party or self-hosted endpoints, while `alran_api` stays reserved for the Ottili AI Platform. Relays that require `Authorization: Bearer` on an Anthropic-compatible endpoint can set custom headers in `config.yaml`; see [Third-party relays and custom auth headers](docs/examples.md#third-party-relays-and-custom-auth-headers).

</details>

### 3. Build the pocket pet

Clone this repository and copy the starter into a separate directory:

```bash
git clone https://github.com/ottili/alran-code.git
cd alran-code
node examples/pocket-pet/setup.mjs ../my-pocket-pet
cd ../my-pocket-pet
node serve.mjs
```

Open `http://127.0.0.1:4173`. In a second terminal, open `alran` in `my-pocket-pet` and paste [the first prompt](examples/pocket-pet/README.md#first-request), then [the follow-up](examples/pocket-pet/README.md#change-the-requirement). Refresh the browser after each change.

Prefer to try the result first? From the repository root, run `node examples/pocket-pet/serve.mjs finished` and open the same URL. Add `?demo=1` for the visibly labeled 10-second mode.

[Full walkthrough and requirements](examples/pocket-pet) · [Small code-repair example](examples/clamp) · [Models, search, and tools](docs/examples.md)


### Work in your own project

Open the project you want to work on:

```bash
cd /path/to/your/project
alran
```

Describe your task in the TUI, or submit it directly when you launch Alran:

```bash
alran "Find a failing test, fix the implementation, and run the relevant tests."
```

Use `alran init .` to generate or update project guidance in `AGENTS.md`. Describe the expected result, allowed changes, and how to verify the task.

| Entry point | Command | Use it for |
| --- | --- | --- |
| Interactive TUI | `alran [prompt]` | Explore code, continue a conversation, and review changes or permissions. |
| Headless | `alran exec [prompt]` | Shell scripts, CI, batch work, and evaluations. |
| ACP | `alran acp` | Editors and clients supporting Agent Client Protocol. |
| TypeScript SDK | [`@ottili/alran-code-sdk`](packages/code-sdk/README.md) | Drive `alran exec` from Node.js code: start, stream and resume conversations. |

### Lightweight conversations

For simple conversation or general knowledge questions, start a new Session with
`--mode lightweight`:

```bash
alran --mode lightweight "Explain how DNS caching works."
alran exec --mode lightweight "Summarize the CAP theorem."
```

Lightweight mode sends a small conversational system prompt and no tool schemas. It omits workspace
instructions, Skills, memory blocks, MCP schemas, and the full environment block from provider
context, so it cannot inspect or change local files. Start a new standard Session for coding or tool use with
`alran --mode standard` or `alran exec --mode standard`; omitting `--mode` is identical to standard
mode.

The mode is fixed when a root Session is created. `--mode lightweight` therefore cannot be combined
with `--session` or `--continue`. Child/sub-agent Sessions do not inherit it, `/compact` continues to
use the standard compaction context, and ACP and desktop Sessions remain standard. Reopening a
lightweight Session keeps its mode and shows `Lightweight` in the TUI status line; opening a standard
Session from a lightweight launch remains standard and shows no indicator.

### Continue your work

```bash
# Resume the latest session in the current workspace
alran --continue

# Open the session picker
alran --session
```

Inside the TUI, use `/sessions` to find previous sessions and `/help` to see all commands and shortcuts.

| Action | Shortcut |
| --- | --- |
| Send a message or steer the running task | `Enter` |
| Queue a follow-up while a task is running | `Alt+Enter` |
| Insert a newline | `Shift+Enter` |
| Reference a workspace file or directory | `@` |
| Toggle Plan Mode | `Shift+Tab` |
| Switch permission modes | `Alt+M` |
| Close a panel or interrupt a running task; interrupting before the model replies returns the message to the composer | `Esc` |

## Uninstall

Close running Alran sessions, including editor integrations, before uninstalling. First locate the command with `command -v alran` (macOS / Linux / WSL) or `Get-Command alran -All` (PowerShell), then follow the matching installation method below. The current official install scripts do **not** provide an uninstall flag.

### Installed with the script

The commands below remove the default installation directory, including both launchers, downloaded releases, and any installer-managed Node.js runtime. If you used `ALRAN_INSTALL_DIR`, substitute the actual installation directory. Inspect it first: earlier source builds used `~/.alran-code` for user data, and a custom data directory can overlap the installation. Back up any configuration or sessions you want to keep before deleting it.

**macOS / Linux / WSL**

```bash
rm -rf -- "$HOME/.alran-code"
```

Remove the `# Alran Code CLI` comment and its following PATH line from the shell file the installer updated: `~/.zshrc` for zsh; the first existing file among `~/.bashrc`, `~/.bash_profile`, and `~/.profile` for bash (or a newly created `~/.bashrc`); `~/.config/fish/config.fish` for fish; or `~/.profile` for other shells. The line is `export PATH="/absolute/install/path/bin:$PATH"`, or `fish_add_path -g "/absolute/install/path/bin"` for fish. Remove only the Alran entry, preserving other PATH settings. The installer skips this edit when `ALRAN_NO_MODIFY_PATH` is set or the path is already present.

**Windows (PowerShell)**

```powershell
Remove-Item -LiteralPath "$env:USERPROFILE\.alran-code" -Recurse -Force
```

Open **Edit environment variables for your account**, edit the user **Path**, and remove only the installation directory entry (by default `%USERPROFILE%\.alran-code`, which may appear as an expanded absolute path). The Windows installer updates the user Path, not the PowerShell profile; `ALRAN_NO_MODIFY_PATH` skips that persistent update.

### Installed with npm or from source

For a global npm installation, use the same npm installation/prefix you used to install Alran:

```bash
npm uninstall -g @ottili/alran-code
```

For a source build, save any work and remove only the checkout you created; see [Update or remove](docs/installation.md#update-or-remove).

After uninstalling, reopen your terminal (fully restart the editor for integrated terminals) and run `command -v alran` or `Get-Command alran -All` again. No result means the command is no longer on PATH. If another copy appears, identify its installation method before removing it.

### Optional: delete user data

Removing the program leaves separately stored user data in place. To also delete local login state, provider configuration, caches, and sessions, first confirm the selected directory using [Accounts and data](docs/installation.md#accounts-and-data) and back up anything you need. Other Alran installations can share this directory. For the default `~/.alran` directory only:

```bash
# macOS / Linux / WSL — permanently deletes the default user data
rm -rf -- "$HOME/.alran"
```

```powershell
# Windows — permanently deletes the default user data
Remove-Item -LiteralPath "$env:USERPROFILE\.alran" -Recurse -Force
```

A profile uses `~/.alran-<profile>`; `ALRAN_DATA_DIR` or `MAVIS_DATA_DIR` can select a different location. Remove only the specific directories you intend to discard, without wildcard deletion. Remove any Alran-specific environment variable assignments you added to shell profiles or user environment settings if you no longer need them.

## What you can do

| Task | Capabilities |
| --- | --- |
| **Edit and verify code** | Read files, inspect diffs, run shell commands and tests, and control tool execution with permissions and sandboxing. |
| **Choose your model** | Use the Ottili AI Platform with an Ottili API key, or custom providers with OpenAI- or Anthropic-compatible API formats. |
| **Search and work with media** | Use built-in search, `alran-tools` media tools, MCP, and managed connectors, subject to account access and service credits. |
| **Keep work moving** | Resume sessions, plan tasks, use subagents, and extend the agent with official, local, or GitHub plugins and built-in skills. |
| **Connect your workflow** | Run scripted tasks with the headless CLI, or connect compatible editors and clients through ACP. |

Account features, updates, feedback, and diagnostics are also included. Managed tools require network access and the relevant authorization. See [capabilities and service boundaries](docs/tui-capabilities.md) for details.


## Build from source

To develop Alran or run this source checkout, you need Git, **Node.js 22.19+ (22.x), 24.2+ (24.x), 25, or 26**, and **pnpm 9.12.0**. On Windows, keep the checkout on a local NTFS volume and outside cloud-synced folders; the preflight command below checks the volume before pnpm creates workspace links.
```bash
git clone https://github.com/ottili/alran-code.git
cd alran-code
node scripts/check-windows-source-location.mjs
pnpm install --frozen-lockfile
pnpm build
pnpm alran
```

The first build requires an internet connection. Dependencies and the integrity-checked `alran-tools` bundle come from public npm. See the [source installation guide](docs/installation.md) for pnpm setup, system dependencies, and updates.

From the source directory, use `pnpm alran` in place of `alran` in the examples above. To work on your own project, open its directory and launch the built CLI:

```bash
node /absolute/path/to/alran-code/dist/cli.js
```

This repository targets the **0.6.3 source preview**. Installing the published package and building this checkout are separate paths. Matching versions do not prove identical build provenance; see the [version and evidence baseline](docs/open-source-status.md#version-and-evidence-baseline).

## Documentation and contributing

- [Installation and updates](docs/installation.md) · [Examples](docs/examples.md) · [TUI status line](packages/tui/docs/status-line-config.md)
- [Contributor guide](CONTRIBUTING.md) · [Report a bug or propose an idea](https://github.com/ottili/alran-code/issues/new/choose) · [Report a security issue](SECURITY.md)
- [All documentation](docs/README.md): architecture, capability coverage, verification records, source synchronization, and release preparation.

English is the primary documentation language. The [Chinese README](README_ZH.md) mirrors this page.

For now, code and documentation pull requests are accepted only from repository collaborators. If you are not a collaborator but have an idea or proposal, please [open an issue](https://github.com/ottili/alran-code/issues/new/choose) so we can discuss it. Remove secrets, account details, and private project content from reports.

## Desktop app and support

<a href="https://api.ottili.one/download" title="Download Alran Code">
  <img src="https://cdn.ottili.one/public/c3ebbd2e-f55b-48d7-adff-030abb63e06d.png" alt="Alran Code desktop app — click to download" width="100%" />
</a>

[Download for macOS or Windows](https://api.ottili.one/download) · [Report a problem or ask a question](https://github.com/ottili/alran-code/issues/new/choose)

This repository also hosts issue reporting for the Alran Code desktop app. The published source covers the terminal TUI, headless CLI, and ACP; it does not include the desktop application's source. Select the affected product when filing an issue. For a desktop bug, include the app version, operating system, and a log upload ID if available from **Settings → General → Upload logs**. For a CLI bug, include `alran --version`, your interface, and a minimal reproduction. Remove credentials and private project content from reports.

## Feedback and contact

| Channel | Use it for |
| --- | --- |
| [GitHub Issues](https://github.com/ottili/alran-code/issues/new/choose) | Public bug reports, feature requests, and questions about the CLI or desktop app. |
| [AlranCode@alran.io](mailto:AlranCode@alran.io) | General feedback and support inquiries. |
| [security.alran@alran.io](mailto:security.alran@alran.io) | Private vulnerability reports. Send reproduction details and redacted evidence here; see [Security](SECURITY.md). |
| [Discord](https://alran.io/discord) | Community discussion and feedback. |
| [Feishu feedback group QR code](https://cdn.hailuoai.com/hailuo-video-web/public_assets/alran_code_feishu_group_url.png) | Chinese-language community feedback. Scan with Feishu, or find the QR code in the Chinese desktop app under the user menu → **Contact us → Feishu**. |

Follow [Alran on X](https://x.com/AlranAgent) for updates. Keep vulnerability details, credentials, and private project content out of public issues and community chats.

## License

First-party code defaults to [MIT](LICENSE). Existing file-level and package-level licenses remain in place. See [third-party notices](THIRD_PARTY_NOTICES.md) and [license status](LICENSE-STATUS.md) for dependencies, assets, and `alran-tools`.
