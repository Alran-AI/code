# Alran Code — release notes

## Unreleased

## 1.2.0 — 2026-11-19

Package `alran` (`npm install -g alran`), binary `alran`.

### Added

- **CI Fixer.** `alran ci init` sets up automatic repair of red GitHub CI runs:
  the workflow watches your pipelines, a headless Alran Code session with a
  restricted toolset reproduces and fixes the failure, and only a verified
  green run is committed — guarded against forks, protected paths and
  test-weakening diffs. `/ci` opens the same setup as a TUI wizard.
  `alran ci status`, `alran ci doctor`, `alran ci disable` and
  `alran ci fix --dry-run` manage and rehearse it. See [CI Fixer](ci-fixer.md).
- **Background auto-update.** npm global installs update silently in the background and become active on
  the next start, after which one line says what changed. The check runs at most every six hours, only from
  the official npm registry, and only for the `alran` package. Channels: `latest` (default) and `stable`.
  Opt out with `autoUpdate: false` or `ALRAN_DISABLE_AUTOUPDATE=1`; `ALRAN_OFFLINE=1` makes no network call.
  `alran update --check` and `alran update --channel <latest|stable>` manage it. See [updates](UPDATES.md).

### Fixed

- **Agent requests are no longer refused as "Credit Budget Exhausted" while the balance is fine.** A
  company-wide monthly cap refused requests on the AI Platform, and a request was held for its full
  possible output, so agent turns could be refused where a short chat was not. The cap is gone, and a
  hold now covers only what the model can produce.

## 1.1.1 — 2026-11-19

Package `alran` (`npm install -g alran`), binary `alran`.

### Fixed

- **The Store shows the store that is there.** The index the Alran Store serves grew past what the
  client accepted — about 12 MB with 202 Plugins and 10,375 Skills — so the Store kept offering the old
  copy of 29 Plugins and the new ones never appeared. An index of up to 64 MiB is accepted now.
- **The Store asks less and downloads less.** The index is asked for compressed (`gzip` or `brotli`), an
  unchanged index is revalidated with its ETag instead of being downloaded again, and a cached index is
  used for six hours before the store is asked at all. `alran plugin marketplace upgrade` asks right
  away and ignores the six hours.
- **The Store says what went wrong.** A store that refused the index and a store that could not be
  reached are no longer both reported as "unreachable", and the age of the copy that is on screen is
  shown with it.

## 1.1.0 — 2026-11-18

Package `alran` (`npm install -g alran`), binary `alran`.

### Added

- **Web search on your own key.** `web_search` now calls a provider you chose: Brave, Serper, Tavily or
  Exa with your own API key, or a SearXNG instance you run yourself. The first one you set wins, and the
  request leaves your machine. Brave's free tier covers thousands of queries a month, so search can be
  switched on without a bill. With no key at all, the keyless Exa endpoint answers from your own IP.
- **A search backend you host.** Point `SEARXNG_URL` at your own SearXNG: no account, no per-query fee,
  and your queries never share an IP with anyone else. When the instance sits behind a key-checking
  gateway, `SEARXNG_API_KEY` is sent as `X-Api-Key`. The whole procedure — container, settings, one line
  of configuration — is in [self-hosted web search](self-hosted-search.md).
- **Search settings in one file.** The provider keys can live in `~/.alran/config.yaml` under
  `webSearch:` (`braveApiKey`, `serperApiKey`, `tavilyApiKey`, `exaApiKey`, `searxngUrl`,
  `searxngApiKey`). The environment still wins, so a one-off override never has to edit the file.
- **Parallel and background subagents.** `task_spawn` starts every agent at once and returns all task
  ids; `task_wait` parks the turn until the named background tasks settle (up to 600 seconds, waking on
  completion). Task rows and ids are durable from the first call, and only the child turn waits for one
  of eight execution slots, so a wide fan-out never holds the main agent back.

### Changed

- **A search that cannot work is no longer offered.** With no provider key, no SearXNG and no signed-in
  session, `web_search` is not registered at all. The host names the variables to set at startup instead
  of letting the first call fail.
- **Search failures name their cause** — `http:502`, `code:ENOTFOUND`, `code:timeout`,
  `error:invalid-json` — instead of one generic message.
- The commit trailer no longer leaks into bash subprocesses: a call with attribution switched off carries
  no trailer at all.

### Fixed

- A Plugin hook that wrote its transcript into a directory that had just been cleaned up failed with a
  server error. The directory is created again and the write is retried.

## 1.0.2 — 2026-11-18

Package `alran` (`npm install -g alran`), binary `alran`.

### Changed

- The package homepage is [alran.dev](https://alran.dev) instead of the Platform settings page.
- OpenRouter requests identify the app with `https://alran.dev` in `HTTP-Referer`, so the OpenRouter
  dashboard links to a page a reader can visit.
- Bundled prompts and skill documentation are English-only; a new language gate keeps it that way.

## 1.0.1 — Claude on your own Anthropic key

Package `alran` (`npm install -g alran`), binary `alran`. Works with the Ottili AI Gateway of 2026-11-16 and
later; against an older gateway it still understands the old answers.

### Changed

- **Claude is billed by Anthropic, not by Ottili.** Claude Sonnet 5.5 and Claude Opus 5.5 run on your own
  Anthropic API key. Add it once in the Ottili AI Platform under *Settings → Provider keys* (it is checked
  with Anthropic, stored encrypted and used only for your requests); Anthropic bills you directly. Ottili
  charges nothing for Claude: no token price, no hold on your credit, and the 4.5 % service fee is gone.
  Werk is unchanged and stays on your Ottili credit (the welcome credit covers it).
- `alran models` says *needs your Anthropic key* or *Anthropic rejected your key* (yellow / red) instead of
  "requires purchased credit"; `alran config model sonnet` prints what to do when no key is stored.
- `alran usage` shows the state of your Anthropic key, lists Claude's tokens as *billed by Anthropic* and totals
  only what Ottili charged. The service-fee column is gone, and so are `service_fee_*` and `credit_class`
  from `--json`.
- The refusals about the key (`byok_key_required`, `byok_key_invalid`, `byok_key_rejected`,
  `byok_key_forbidden`, `byok_provider_billing`) have their own sentences and exit code 5; a Claude turn that
  fails on the key says where the key lives instead of "Access denied".
- `isPaidOnlyOttiliModel` of `@alran/config` became `isByokOttiliModel`.

## 0.2.0 — the first Ottili release

Package `alran` (`npm install -g alran`), binary `alran`. Alran Code includes MIT-licensed upstream
material; see `THIRD_PARTY_NOTICES.md`.

## New

- **Ottili account.** `alran auth login|status|switch-company|logout`: browser sign-in through the
  Ottili Platform, or `--api-key` without a browser; logout revokes the session at the Platform.
  `alran config company|project|model`. Model calls carry the selected company and project.
- **Models through the Ottili AI Gateway.** Ottili Werk 1.1 (default), Claude Sonnet 5.5 and Claude
  Opus 5.5. `alran models` shows prices and whether you can use each model now (coloured on a
  terminal). The free welcome credit covers Werk. Claude runs on your own Anthropic API key, added once
  in the Ottili AI Platform under Settings → Provider keys: Anthropic bills it directly and Ottili charges
  nothing for Claude — no service fee. Without a key the gateway refuses a Claude request with
  `byok_key_required`.
- **Usage and billing.** `alran usage` (credit left, the state of your Anthropic key, spend this month
  per model — Claude is "billed by Anthropic") and `alran billing` (plan, payment method summary, last
  invoice).
- **Device sign-in.** `alran auth login --device`: a code you confirm in any browser, the default over
  SSH or without a display. The session is the terminal's own.
- **Updates.** `alran update` for npm, pnpm, yarn and bun installs and for managed installs from a
  signed release host (`--source`/`ALRAN_UPDATE_SOURCE` for a mirror); a weekly, non-blocking update
  hint (`ALRAN_NO_UPDATE_CHECK=1` turns it off).
- **Download pages** in the Ottili Console (Developer → Alran Code) and the Ottili AI Platform
  (Settings → CLI), fed by `GET https://ai.ottili.one/v1/products/alran-code/version`.
- **Ottili look.** The terminal theme uses the Ottili Foundation colours (violet accent, zinc
  neutrals); ANSI-16 terminals get magenta for the brand roles.
- **Attribution.** Commits the agent makes end with `Co-Authored-By: Alran Code using <model> <noreply@alran.dev>`
  (`Werk 1.1`, `Sonnet 5.5`, `Opus 5.5`), and pull request descriptions with `Generated by [Alran Code](https://alran.dev)`.
  A system reminder asks the model for both; a `git` shim on the agent's PATH adds the commit line to every
  `git commit` it runs, so it cannot be left out. On by default; `attribution.commits` and
  `attribution.pullRequests` in `config.yaml` switch each off. See [attribution](attribution.md).
- **Plugin Store and Skill Library.** `/plugin` opens the Store (Plugins, Skill Library, Installed,
  Stores); `/skills library` opens it on the Library. `alran plugin search|info|install|update` and
  `alran skills list|search|info|install|update|remove` do the same from a shell, and
  `alran plugin marketplace add|remove` manage stores. A store is a static `index.json` plus archives;
  every download is checked against a pinned SHA-256 and content digest by a strict archive reader, a
  Plugin that runs commands is shown to you before it installs, and the Store never overwrites a
  Plugin or Skill you put there yourself. `tools/store/build-store.mjs` builds a store from a skills
  repository. Alran Code reads the store Ottili hosts at `https://ai.ottili.one/v1/store/index.json` (open-source
  Skills and Plugins from platform vendors and projects, unmodified, with their licences);
  `ALRAN_STORE_URL` replaces it and `ALRAN_STORE_URL=off` switches it off. Built-in Skills show up in the
  Library as "Built in". See `docs/store.md`.
- **Plugins** keep working when the Plugin registry is unreachable; `alran plugins install` is an alias
  of `alran plugin add`; `ALRAN_PLUGIN_REGISTRY_URL` points at a registry you run.

## Changed

- Package renamed from `@ottili/code` to `alran`. The new package ships only the build
  (about 800 files, 13 MB instead of 7,549 files, 44 MB) and declares its native dependencies, so it
  runs on Node 24 (the old 0.1.4 crashed there).
- Data directory `~/.alran`; environment variables `ALRAN_*`. There is no compatibility layer
  for older names: the data directory is always `~/.alran` and only `ALRAN_*` variables are read.
- The model list contains only models the gateway serves; earlier entries that the gateway refused
  are gone. A saved default naming a removed model falls back to Werk.
- No usage reporting to any host unless `ALRAN_TELEMETRY_ENDPOINT` is set.

## Known limitations

- No Ottili-hosted Plugin registry yet, and no CLI command to import a Plugin from GitHub (`docs/PLUGINS.md`).
- The managed installer and its release host (`cdn.ottili.one`) are not set up; npm is the install
  and update path (`docs/UPDATE_PIPELINE.md`).

## Upgrade

```bash
npm uninstall -g @ottili/code      # if the old package is installed
npm install -g alran
alran auth login
```
