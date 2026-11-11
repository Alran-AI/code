# Write an Alran Code Plugin

This is the path from nothing to a Plugin package that passes the same validation as CI.

## 1. Set up

```bash
git clone https://github.com/Alran-AI/code.git
cd code
pnpm install
pnpm verify --profile docs
```

The last command must pass first. It checks the public boundary of this repository, so if it passes,
your environment is right.

## 2. Create a Plugin package

A Plugin is a directory with `.alran-plugin/plugin.json` at its root:

```text
my-plugin/
  .alran-plugin/plugin.json
  icon.png
  skills/research/SKILL.md
  my-tool.mcp.json
```

The smallest manifest:

```json
{
  "schemaVersion": 1,
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "One sentence about what this Plugin does.",
  "author": "Your name or organization",
  "icon": "icon.png",
  "category": "Code",
  "exampleQueries": ["Do one concrete thing with it"],
  "apps": [],
  "mcpServers": ["my-tool.mcp.json"],
  "skills": ["skills/research/SKILL.md"]
}
```

`name` must equal the directory name. `category` is one of `Office`, `Studio`, `Design & Sites`,
`Code`, `Business`, `Sales`, `Productivity`, `Science & Healthcare`, `Education`, `Other`. At least one
of `apps`, `mcpServers`, `skills` and `hooks` is non-empty.

All fields and limits are in [package-format-v1.md](package-format-v1.md).

## 3. Validate locally

```bash
node tools/plugins/validate-plugin.mjs path/to/my-plugin
```

or with the repository script:

```bash
pnpm check:plugin path/to/my-plugin
```

It checks that:

- the manifest satisfies `schemas/plugins/plugin-v1.schema.json`;
- every referenced App, MCP and Hook file exists and satisfies its schema;
- every Skill's frontmatter has a `name` equal to its directory and a non-empty `description`;
- every path is a V1 portable ASCII path (no absolute paths, `..`, backslashes or Windows reserved
  names).

Exit code `0` means it passed, `1` that problems were found, `2` a usage error.

## 4. Use it

Copy the package directory into the local Plugin directory (`alran plugins marketplace list` prints
where it is). A Plugin in that directory is installed; `alran plugins list` shows it, and
`alran plugins enable|disable|remove <name>` manage it.

To contribute a Plugin to this repository, open an issue that describes the Plugin and the change,
then send a pull request from a fork with the real output of `validate-plugin.mjs` in its description.

## 5. What local validation does not cover

Passing locally means the package has the right **format**, not that its **content** is good. These
checks are part of a registry's validation and are not run by the local validator:

- membership in a catalog;
- closure across files (the manifest references exactly the file tree);
- archive size and entry limits, and the `content_digest` computation;
- real-byte checks of icons and media.

## 6. Reference

| Topic | Document |
| --- | --- |
| Package format, path contract, safety limits, digest | [package-format-v1.md](package-format-v1.md) |
| JSON Schemas | `schemas/plugins/` |
| Path and digest reference vectors | `test-vectors/plugins/` |
