# Plugins and skills

## Where they come from today

| Source | What | Status |
|---|---|---|
| Bundled skills | `packages/local-runtime/assets/skills/*` (code-review, deep-research, docx, pdf, pptx, xlsx, skill-creator, …), shipped inside the npm package and seeded into the data directory on start. | Works offline. Licensed with the rest of the code base (MIT, see `THIRD_PARTY_NOTICES.md`); `docx` keeps its own MIT notice. |
| Plugin Store and Skill Library | Plugins and Skills from one or more **stores** (a static `index.json` plus archives pinned by SHA-256 and content digest). `alran plugin search\|info\|install\|update`, `alran skills …`, and `/plugin` in the TUI. See [store.md](store.md). | Ottili's store is read from `https://ai.ottili.one/v1/store/index.json` (served by the AI platform); `ALRAN_STORE_URL` replaces it, `off` drops it, `alran plugin marketplace add <url>` adds more. Needs the network for the index and each download; a cached index works offline. Plugins install into the local Plugin folder, Skills into `<data-dir>/skills`. |
| Local Plugins | Plugin folders in `~/.alran/plugins/<name>` (`alran plugins marketplace list` prints the path). A folder there is installed; `alran plugins enable|disable|remove <name>` manage it. A Plugin the Store installs lives here too. | Works offline. |
| Plugin registry ("official") | Signed Plugin archives, connectors and the skill catalogue from one per-account cloud API (`/alran-cloud/api/v1/...`). | **Not hosted by Ottili.** The upstream ran this service; the default host `https://api.ottili.one` has no DNS record. It is only asked when `ALRAN_PLUGIN_REGISTRY_URL` points at a registry you run. The Store replaces it for everyday use. |
| GitHub import | The runtime can import a Plugin from a GitHub repository at a pinned commit (`GithubPluginImporter`). | Not reachable from `alran plugins` or the TUI yet: the import is not wired through the CLI service. |

`alran plugins list --available` lists what the stores offer next to the local Plugins, and notes a store
that cannot be read. A name that no store knows is looked up in the Runtime's sources (`@official`,
`@local`) as before.

## Commands

```bash
alran plugins list                 # installed Plugins
alran plugins list --available     # plus what the stores offer
alran plugins search <words>       # search the stores
alran plugins info <name>          # contents and what it runs, before installing
alran plugins install <name>       # alias of `alran plugin add`; <name>@store, @local or @official to pick a source
alran plugins update [name]
alran plugins disable <name>
alran plugins enable <name>
alran plugins remove <name>        # a local Plugin's folder is deleted
alran plugins marketplace list     # the stores and the local directory
alran plugins marketplace add <url> [--name <store>]
alran skills search|info|install|update|remove   # the Skill Library
```

## Writing a Plugin

A Plugin is a folder with `.alran-plugin/plugin.json` (name, version, description, author, icon,
category, and at least one of skills, MCP servers, apps, hooks). Check it with
`node tools/plugins/validate-plugin.mjs <folder>`; the format is in `docs/plugins/package-format-v1.md`.

## Where Plugins can come from in 0.x, and what comes next

Bundled skills and local Plugins (above) are what works without any service. A hosted registry is a
project of its own: the client speaks a per-account cloud API (the catalogue, the installed and enabled
state of an account, signed download authorisations, archives verified by `archiveSha256` and
`contentDigest`; `packages/local-runtime-v2/src/service/plugin-system/plugin/runtime/registry-client.ts`).
The content of the upstream's registry was not mirrored: it was that company's service, and each Plugin
in it carries a license that has to be read before it is republished.

The Store (see [store.md](store.md)) is the answer that needs no service: a store is files, and the
default one is read from GitHub. What is still open, in the order of effort:

1. Wire the GitHub import through the CLI (`alran plugins add github:<owner>/<repo>`): the runtime part
   exists; the CLI service, the application contract and the commands do not call it yet. The Store's
   preview and approval step is what it would reuse, because an imported Plugin can run commands.
2. Signed store indexes, so that trust in a store does not rest on its host alone.
3. An Ottili registry in the AI Platform that implements the per-account client contract (installed
   state per account, signed download authorisations); its URL becomes the default of
   `ALRAN_PLUGIN_REGISTRY_URL`.
