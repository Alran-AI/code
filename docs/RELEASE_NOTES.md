# Alran Code — release notes

## 0.2.0 — the first Ottili release

Package `alran` (`npm install -g alran`), binary `alran`. Alran Code is derived from MiniMax Code (MIT); see
`THIRD_PARTY_NOTICES.md`.

## New

- **Ottili account.** `alran auth login|status|switch-company|logout`: browser sign-in through the
  Ottili Platform, or `--api-key` without a browser; logout revokes the session at the Platform.
  `alran config company|project|model`. Model calls carry the selected company and project.
- **Models through the Ottili AI Gateway.** Ottili Werk 1.1 (default), Claude Sonnet 5.5 and Claude
  Opus 5.5. `alran models` shows prices and whether your credit covers each model (coloured on a
  terminal). The free welcome credit covers Werk only; the gateway refuses a Claude request without
  purchased credit (`free_credit_model_restricted`). Claude carries a 4.5 % service fee, shown as its
  own line.
- **Usage and billing.** `alran usage` (free and purchased credit, spend this month per model, service
  fee) and `alran billing` (plan, payment method summary, last invoice).
- **Device sign-in.** `alran auth login --device`: a code you confirm in any browser, the default over
  SSH or without a display. The session is the terminal's own.
- **Updates.** `alran update` for npm, pnpm, yarn and bun installs and for managed installs from a
  signed release host (`--source`/`ALRAN_UPDATE_SOURCE` for a mirror); a weekly, non-blocking update
  hint (`ALRAN_NO_UPDATE_CHECK=1` turns it off).
- **Download pages** in the Ottili Console (Developer → Alran Code) and the Ottili AI Platform
  (Settings → CLI), fed by `GET https://ai.ottili.one/v1/products/alran-code/version`.
- **Ottili look.** The terminal theme uses the Ottili Foundation colours (violet accent, zinc
  neutrals); ANSI-16 terminals get magenta for the brand roles.
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
- Data directory `~/.alran`; environment variables `ALRAN_*`.
- The model list contains only models the gateway serves; earlier entries that the gateway refused
  are gone. A saved default naming a removed model falls back to Werk.
- No usage reporting to any host unless `ALRAN_TELEMETRY_ENDPOINT` is set.

## Deprecated (removed after 2027-Q1)

- Reading the environment variables of releases before the rename as `ALRAN_*` (with a one-time warning).
- The link from the old data directory to `~/.alran`.

See `docs/MIGRATION_FROM_MINIMAX.md`.

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
