# Alran store index, format V1

A store is a JSON document, `index.json`, and the archives it points at. The reader is
`packages/tui/src/store/index-format.ts`; the builder is `tools/store/build-store.mjs`. Archives use the
[package format V1](../plugins/package-format-v1.md): the same layout, path rules, limits, content digest
and deterministic ZIP, for Plugins and for Skills.

## Document

```json
{
  "schema": "alran.store/v1",
  "name": "Example Store",
  "description": "Plugins and Skills for Alran Code.",
  "plugins": [
    {
      "name": "example-plugin",
      "displayName": "Example Plugin",
      "version": "1.0.0",
      "description": "Two Skills for reviewing changes.",
      "author": "Example Org",
      "category": "Code",
      "license": "MIT",
      "homepage": "https://example.com/plugins/example-plugin",
      "exampleQueries": ["Review my staged changes"],
      "contents": {
        "skills": [{ "name": "review-changes", "description": "Review staged changes." }],
        "mcpServers": [],
        "apps": [],
        "hooks": 0
      },
      "archive": {
        "url": "archives/plugin-example-plugin-1.0.0.zip",
        "size": 8192,
        "archiveSha256": "<64 lowercase hex digits>",
        "contentDigest": "sha256-tree-v1:<64 lowercase hex digits>"
      }
    }
  ],
  "skills": [
    {
      "name": "review-changes",
      "title": "Review Changes",
      "version": "1.0.0",
      "description": "Review staged changes.",
      "group": "Code",
      "license": "MIT",
      "files": 3,
      "archive": { "url": "archives/skill-review-changes-1.0.0.zip", "size": 4096, "archiveSha256": "…", "contentDigest": "…" }
    }
  ]
}
```

## Fields

| Field | Rule |
| --- | --- |
| `schema` | Exactly `alran.store/v1` |
| `name` | 1 to 80 characters |
| `plugins[].name` | `^[a-z][a-z0-9]*([._-][a-z0-9]+)*$`, at most 80; unique in `plugins` |
| `plugins[].version`, `skills[].version` | SemVer |
| `plugins[].category` | One of the Plugin categories of the manifest schema (`Code`, `Business`, …) |
| `plugins[].exampleQueries` | At most 3 are used |
| `plugins[].contents` | What the package holds, for display. An install re-derives it from the archive |
| `skills[].name` | `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64; equals the `name` in the Skill's `SKILL.md` |
| `skills[].group` | The library group shown in the Skill Library |
| `skills[].files` | Number of files in the archive, 1 to 1,024 |
| `archive.url` | Relative to the index, or absolute `https:` (plain `http:` only for `localhost`); a `file:` URL only in an index that is itself a file |
| `archive.size` | Exact byte length of the archive |
| `archive.archiveSha256` | SHA-256 of the archive bytes |
| `archive.contentDigest` | `sha256-tree-v1:` digest of the file tree |

Text fields are single-line: whitespace is collapsed and control characters (including terminal
escapes and bidi overrides) are replaced by a visible `\u{…}` escape when the index is read. An index
or an entry that breaks a rule is refused with the path of the offending field.

## Archives

- A **Plugin** archive has `.alran-plugin/plugin.json` at its root. The manifest's `name` and `version`
  must equal the listing's, the `icon` and every referenced skill, MCP, app and hook file must exist,
  and each `skills/<name>/SKILL.md` must name `<name>`.
- A **Skill** archive has `SKILL.md` at its root (the Skill folder's contents, without a wrapper
  directory) whose frontmatter `name` equals the listing's.

## What a client does

1. Read the index (HTTPS, or loopback `http`, or a file) and validate it.
2. To install: download the archive, require its size and SHA-256 to match, read it with the strict V1
   reader, and require the content digest to match.
3. Inspect the verified files: for a Plugin, list every MCP server command, hook command and
   connector. If there are any, obtain approval before writing.
4. Write the tree to a staging directory under `<data-dir>/store/staging` and rename it into
   `<data-dir>/plugins/<name>` or `<data-dir>/skills/<name>`; an update renames the old directory
   aside first and puts it back if the swap fails. Record the install in `<data-dir>/store/installed.json`.
5. Never overwrite or remove a directory that the ledger does not list.

## Build configuration, `alran.store.build/v1`

```json
{
  "schema": "alran.store.build/v1",
  "name": "Example Store",
  "skills": {
    "exclude": [{ "name": "internal-skill", "reason": "Not for people." }],
    "groups": { "code": "Code" },
    "titles": { "review-changes": "Review Changes" }
  },
  "plugins": [
    {
      "name": "example-plugin",
      "displayName": "Example Plugin",
      "version": "1.0.0",
      "description": "…",
      "author": "Example Org",
      "category": "Code",
      "icon": "icons/plugin.png",
      "packages": ["code"],
      "exampleQueries": ["…"]
    }
  ]
}
```

A bundle names its Skills in `skills` (by name), `packages` (every Skill of a library group), or both.
`icon` is a PNG, JPEG or WebP path relative to the config. `directory` instead of `skills`/`packages`
points at a ready Plugin package folder. The builder refuses a Skill whose frontmatter does not match
its folder, a file name a portable archive cannot hold, a bundle that names a Skill the library does not
have, and any Plugin the public validator rejects.
