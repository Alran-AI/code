# Plugins and skills

## Where they come from today

| Source | What | Status |
|---|---|---|
| Bundled skills | `packages/local-runtime/assets/skills/*` (code-review, deep-research, docx, pdf, pptx, xlsx, skill-creator, …), shipped inside the npm package and seeded into the data directory on start. | Works offline. Licensed with the rest of the code base (MIT, see `THIRD_PARTY_NOTICES.md`); `docx` keeps its own MIT notice. |
| Local Plugins | Plugin folders in `~/.alran/plugins/<name>` (`alran plugins marketplace list` prints the path). A folder there is installed; `alran plugins enable|disable|remove <name>` manage it. | Works offline. |
| Plugin registry ("official") | Signed Plugin archives, connectors and the skill catalogue from one cloud API (`/alran-cloud/api/v1/...`). | **Not hosted by Ottili.** The upstream ran this service; the default host `https://api.ottili.one` has no DNS record. Set `ALRAN_PLUGIN_REGISTRY_URL` to a registry you run. |
| GitHub import | Plugins imported from a GitHub repository at a pinned commit (`codeload.github.com`). | Works; third-party content, not reviewed by Ottili. |

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

## Decision for the founders: an Ottili Plugin registry

Two options, both outside this repository:

1. **No registry for v1** (current state). Bundled skills plus local and GitHub Plugins. Nothing to
   run, nothing to moderate. The "official" source stays dark until option 2 exists.
2. **Ottili-hosted registry.** Implement the registry contract the client already speaks
   (`packages/local-runtime-v2/src/service/plugin-system/plugin/runtime/registry-client.ts`:
   catalogue, download authorisation, archives verified by `archiveSha256` and `contentDigest`) as a
   Platform or AI Platform service, then make its URL the default here. Curated Ottili Plugins would
   be published there, with the same validator as `tools/plugins/validate-plugin.mjs`.

The upstream registry's content was not mirrored: it was the upstream company's service and its
Plugins are not ours to republish without their licences being checked one by one.
