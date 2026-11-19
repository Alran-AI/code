# Alran Code Changelog

This changelog covers changes that directly affect Alran Code users: the terminal UI, `alran exec`, the
account commands, models, Plugins, installation and updates.

## 1.1.1 · 2026-11-19

### Fixed

- **The Store shows the store that is there.** The index the Alran Store serves grew past what the
  client accepted — about 12 MB with 202 Plugins and 10,375 Skills — so the Store kept offering the old
  copy of 29 Plugins. An index of up to 64 MiB is accepted now.
- **The Store asks less and downloads less.** The index is asked for compressed, an unchanged index is
  revalidated with its ETag instead of being downloaded again, and a cached index is used for six hours.
  `alran plugin marketplace upgrade` still asks right away.
- **The Store says what went wrong.** A store that refused the index and a store that could not be
  reached are no longer both reported as "unreachable", and the age of the copy on screen is shown.
## Unreleased

### Added

- **Background auto-update.** npm global installs now update silently in the background and become
  active on the next start, after which one line says what changed (`Updated to 1.1.x – N features,
  M fixes. Changelog: …`). The check runs at most every 6 hours with a 3 s budget, only from the
  official npm registry, and only for the `alran` package. Channels: `latest` (default) and `stable`
  (`autoUpdateChannel` in `~/.alran/config.yaml` or `ALRAN_UPDATE_CHANNEL`). Opt out with
  `autoUpdate: false` or `ALRAN_DISABLE_AUTOUPDATE=1`; `ALRAN_OFFLINE=1` makes no network call at
  all. New flags: `alran update --check` and `alran update --channel <latest|stable>`. See
  `docs/UPDATES.md`.

## 1.1.0 · 2026-11-18

### Added

- **Web search on your own key.** `web_search` calls Brave, Serper, Tavily or Exa with your own API key,
  or a SearXNG instance you run yourself. The first provider you set wins, and the request leaves your
  machine. Brave's free tier covers thousands of queries a month.
- **A search backend you host.** `SEARXNG_URL` points Alran Code at your own SearXNG — no account, no
  per-query fee, your own IP. `SEARXNG_API_KEY` is sent as `X-Api-Key` for an instance behind a
  key-checking gateway. See `docs/self-hosted-search.md`.
- **Search settings in one file.** Provider keys can live in `~/.alran/config.yaml` under `webSearch:`
  (`braveApiKey`, `serperApiKey`, `tavilyApiKey`, `exaApiKey`, `searxngUrl`, `searxngApiKey`). The
  environment still wins over the file.
- **Parallel and background subagents.** `task_spawn` starts every agent at once and returns all task
  ids; `task_wait` parks the turn until the named background tasks settle (up to 600 seconds, waking on
  completion). Only the child turn waits for one of eight execution slots, so a wide fan-out never holds
  the main agent back.

### Changed

- **A search that cannot work is no longer offered.** Without a provider key, a SearXNG instance or a
  signed-in session, `web_search` is not registered at all; the host names the variables to set at
  startup.
- **Search failures name their cause** — `http:502`, `code:ENOTFOUND`, `code:timeout`,
  `error:invalid-json` — instead of one generic message.
- The commit trailer no longer leaks into bash subprocesses: a call with attribution switched off carries
  no trailer at all.

### Fixed

- A Plugin hook that wrote its transcript into a directory that had just been cleaned up failed with a
  server error. The directory is created again and the write is retried.

## 1.0.2 · 2026-11-18

### Changed

- The package homepage is [alran.dev](https://alran.dev) instead of the Platform settings page.
- OpenRouter requests identify Alran Code with `https://alran.dev` in `HTTP-Referer`, so the OpenRouter
  dashboard links to a page a reader can visit.
- Bundled prompts and skill documentation are English-only.

## 1.0.1 · 2026-11-16

### Changed

- Claude Sonnet 5.5 and Opus 5.5 run on your own Anthropic API key (Ottili AI Platform → Settings → Provider
  keys). Anthropic bills it directly; Ottili charges nothing for Claude and adds no service fee. Werk is
  unchanged.
- `alran models`, `alran usage` and `alran config model` say whether you can use a Claude model now and what it
  needs; `alran usage` shows the state of your Anthropic key and lists Claude as *billed by Anthropic*.
- The gateway's `byok_*` refusals have their own sentences and exit code 5.

## 0.2.0 · 2026-11-11

The first release as an Ottili product.

### Added

- Sign in with your Ottili account: `alran auth login`, `status`, `switch-company`, `logout`
  (the session is revoked at the Platform), `alran config company|project|model`.
- Models through the Ottili AI Gateway: Ottili Werk 1.1 (default), Claude Sonnet 5.5 and Claude Opus 5.5.
  `alran models` shows the price and whether you can use each model now. Free credit covers Werk;
  Claude runs on your own Anthropic API key (added in the Ottili AI Platform under Settings → Provider keys),
  which Anthropic bills directly — Ottili charges nothing for Claude and adds no service fee.
- `alran usage` and `alran billing`: credit left, spend this month per model, plan and invoices.
- `alran update` and a weekly, non-blocking update hint.
- Plugins keep working when the Plugin registry is not reachable; `alran plugins install` is an alias
  of `alran plugin add`.

### Changed

- The package is called `alran`: `npm install -g alran`.
- The terminal theme uses the Ottili colours.
- User data lives in `~/.alran`; environment variables start with `ALRAN_`.
