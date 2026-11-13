# Skills, Plugins and MCP

Use this reference for bundled Skills, Plugins, MCP servers, extension installation or development,
and why an extension is missing or has no tools.

## Stable concepts and boundaries

- A **Skill** is instruction content that guides the Agent; a **Plugin** is a distributable folder
  that bundles skills, MCP servers, apps or hooks; **MCP** connects external tools and services.
- `discovered ≠ installed ≠ loaded ≠ triggered ≠ executed`: a list entry proves none of the later
  states.
- Bundled Skills (code review, deep research, documents, spreadsheets, slides, PDFs, skill creation)
  ship in the package and work offline. Local Plugins are folders in `~/.alran/plugins/<name>`; a
  folder there is installed.
- There is **no hosted Plugin registry** run by Ottili yet. `alran plugins list --available` lists
  the local Plugins and says that the registry cannot be reached; a Plugin that only a registry would
  offer fails to install with that note. `ALRAN_PLUGIN_REGISTRY_URL` points the client at a registry
  the user runs. Importing a Plugin from GitHub exists in the runtime but is not reachable from the
  CLI yet.
- A capability can also be gated by version, sign-in, permissions or the chosen model.

## Commands

`alran plugins list`, `alran plugins list --available`, `alran plugins install <name>`,
`alran plugins enable|disable|remove <name>`, `alran plugins marketplace list`. A Plugin is a folder
with `.alran-plugin/plugin.json`; the format is in `docs/plugins/package-format-v1.md` and
`tools/plugins/validate-plugin.mjs <folder>` checks it. For MCP and anything else, read
`alran --help` and the guide for the exact syntax of the installed version; do not recall option
names from memory.

## Diagnostic workflow

1. Name the object: Skill, Plugin, MCP server or built-in tool.
2. Check whether it is installed and enabled (`alran plugins list`), then sign-in, version and
   permissions.
3. For a Skill, check that it is selected and that the trigger wording matches: being listed does not
   mean it was loaded into the turn.
4. For MCP, check the configuration, the connection result, the enabled tools and the health of the
   server itself. A server with no tools is not fixed by guessing an address.
5. For a failure, find the first state that failed and give the user one concrete action.

## Safety

An imported Plugin or an MCP server can run commands: show what it would run and let the user decide.
Never request or repeat passwords, API keys or tokens in the chat. Do not present an internal
component as an independent product.
