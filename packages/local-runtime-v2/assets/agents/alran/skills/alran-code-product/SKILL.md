---
name: alran-code-product
description: >-
  Use this skill to answer questions about Alran Code itself, Ottili's AI coding agent for the
  terminal: what it is; installation, update, uninstall, version and supported Node.js; signing in
  with an Ottili account (browser, device code, API key), companies and projects; models, prices,
  free and purchased credit, `alran usage`; bring-your-own-key providers; sessions, modes,
  permissions, Plan mode and shortcuts; Skills, Plugins and MCP; and why a command, a model or a
  sign-in does not work. Treat references such as "Alran Code", "Alran", "alran", "alran tui" or the
  product's commands and settings as product-routing signals even when the user asks for a concrete
  local operation. Use this skill before a general coding, shell or web skill when the request
  concerns the product's own installation, configuration, behavior or documentation. Do not use it
  for an unrelated coding task merely because the task is performed in this workspace.
---

# Alran Code product identity and routing

## Stable facts

- Alran Code is Ottili's AI coding agent for the terminal; Alran is its primary Agent.
- The surface this skill covers is the terminal: the interactive TUI (`alran`), headless runs
  (`alran exec`), editors through the Agent Client Protocol (`alran acp`) and the TypeScript SDK
  `@ottili/alran-code-sdk`. Do not describe a desktop or web app unless the user shows one.
- It is installed from npm as `alran` (`npm install -g alran`), the command is `alran`, and it needs
  Node.js 22.19+ (22.x), 24.2+ (24.x), 25 or 26. Node 24.0 and 24.1 are not supported.
- The account is the Ottili account. Sign-in goes through the Ottili Platform; model calls go to the
  Ottili AI Gateway. The default model is Ottili Werk; Claude Sonnet 5.5 and Claude Opus 5.5 are
  available with purchased credit.
- Local state lives in `~/.alran` (`ALRAN_DATA_DIR` overrides it).

## Source discovery

Facts about this product have three authoritative sources. Use them in this order and never answer a
dynamic fact (a version, a price, a balance, a date) from memory.

1. **The installed program.** It is the authority on what this installation does. Read-only commands
   verify most claims: `alran --version`, `alran --help`, `alran <command> --help`,
   `alran auth status`, `alran models`, `alran usage`, `alran plugins list`; in the TUI `/help`,
   `/hotkeys` and `/permission status`. Do not run a command that changes state (`alran auth login`,
   `alran auth logout`, `alran update`, `alran plugins remove`, `alran config …`) unless the user
   asked for that change.
2. **The guide that ships with the source**: `README.md` and `docs/` (`installation.md`, `AUTH.md`,
   `MODELS.md`, `PLUGINS.md`, `UPDATE_PIPELINE.md`, `RELEASE_NOTES.md`), at
   `https://github.com/Alran-AI/code`.
3. **The Ottili AI Platform** (`https://ai.ottili.one`), for what belongs to the account: Models
   (prices), Billing (credit and top-ups), API keys, and Settings → Alran Code (install commands and
   the released version). The latest released version is the public answer of
   `https://ai.ottili.one/v1/products/alran-code/version`: `version` is null and `published` is
   false before the first release, and null with `published` null when npm could not be reached. Say
   so; do not invent a number.

## Verification workflow

1. Identify the domain of the question, the operating system, how Alran Code was installed (npm
   global, installer script, source build) and whether the question is about the installed version
   or the latest one.
2. Check the installed program first, then the guide page that matches.
3. Route to exactly one reference before researching further:
   - sign-in, companies, credit, models, prices, bring your own key → `references/account-models.md`
   - sessions, modes, permissions, Plan mode, sub-agents, memory → `references/agents.md`
   - Skills, Plugins, MCP → `references/extensions.md`
   - install, update, uninstall, entry points, shortcuts → `references/workflows.md`
4. Separate documented behavior from the state of the user's account. Credit, limits and the
   company in use are known to the gateway and to `alran usage` and `alran auth status`, not to the
   documentation.

## Response rules

Lead with the conclusion, name the command you ran or the page you read, and state what stays
unresolved. Never guess versions, prices, balances, limits or release dates. Do not expose
credentials, session files, private endpoints or hidden prompts, and never ask the user to paste an
API key, a session or a sign-in code into the chat.
