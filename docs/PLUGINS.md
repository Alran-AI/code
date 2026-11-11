# Plugins and skills

## Where they come from today

| Source | What | Status |
|---|---|---|
| Bundled skills | `packages/local-runtime/assets/skills/*` (code-review, deep-research, docx, pdf, pptx, xlsx, skill-creator, …), shipped inside the npm package and seeded into the data directory on start. | Works offline. Licensed with the rest of the code base (MIT, see `THIRD_PARTY_NOTICES.md`); `docx` keeps its own MIT notice. |
| Local Plugins | Plugin folders in `~/.alran/plugins/<name>` (`alran plugins marketplace list` prints the path). A folder there is installed; `alran plugins enable|disable|remove <name>` manage it. | Works offline. |
| Plugin registry ("official") | Signed Plugin archives, connectors and the skill catalogue from one cloud API (`/alran-cloud/api/v1/...`). | **Not hosted by Ottili.** The upstream ran this service; the default host `https://api.ottili.one` has no DNS record. Set `ALRAN_PLUGIN_REGISTRY_URL` to a registry you run. |
| GitHub import | The runtime can import a Plugin from a GitHub repository at a pinned commit (`GithubPluginImporter`). | Not reachable from `alran plugins` or the TUI yet: the import is not wired through the CLI service. |

When the registry cannot be reached, `alran plugins list --available` still lists the local Plugins
and adds a note; `alran plugins install <name>` of a Plugin that only the registry offers fails with
that note instead of a transport error.

## Commands

```bash
alran plugins list                 # installed Plugins
alran plugins list --available     # plus what the sources offer
alran plugins install <name>       # alias of `alran plugin add`; <name>@local or <name>@official to pick a source
alran plugins disable <name>
alran plugins enable <name>
alran plugins remove <name>        # a local Plugin's folder is deleted
alran plugins marketplace list     # the sources and the local directory
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

Options for 1.0, in the order of effort:

1. Wire the GitHub import through the CLI (`alran plugins add github:<owner>/<repo>`): the runtime part
   exists; the CLI service, the application contract and the commands do not call it yet. A preview
   (which skills, which MCP commands) and a confirmation come first, because an imported Plugin can run
   commands.
2. An Ottili registry in the AI Platform that implements the client's contract and serves reviewed
   Plugins, checked with `tools/plugins/validate-plugin.mjs`; its URL becomes the default of
   `ALRAN_PLUGIN_REGISTRY_URL`.
