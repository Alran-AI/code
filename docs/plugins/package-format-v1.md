# Alran Plugin Package Format V1

This document defines the repository layout, manifest references, archive safety limits and digest
algorithm of an Alran Plugin, version 1. The validator (`tools/plugins/validate-plugin.mjs`) and the
checked-in test vectors (`test-vectors/plugins/`) are the reference for these rules.

## 1. Packages

A package root is one directory with this layout:

```text
.alran-plugin/plugin.json
<icon>
*.app.json
*.mcp.json
skills/<skill-name>/SKILL.md
hooks/hooks.json
<any other plain file referenced by a capability file>
```

- An archive of a Plugin has `.alran-plugin/plugin.json` at its root, without a wrapper directory.
- `content_digest` covers the whole file tree of the package root.
- Every path in the manifest is relative to the package root, uses `/`, and is never resolved
  relative to the manifest itself.
- Plain files that the manifest does not reference still belong to the package: they count towards
  the digest and the safety limits.
- A Plugin's name must be the same in its directory name and in the manifest `name`.

## 2. Manifest and capability files

The manifest follows `schemas/plugins/plugin-v1.schema.json`. V1 has four kinds of capability:

- `apps`: one or more `*.app.json` files (`schemas/plugins/app-v1.schema.json`), each holding only a
  Connector `provider`. A provider name matches `[a-z0-9_-]{1,64}` completely, with no trailing
  newline or control character.
- `mcpServers`: one or more `*.mcp.json` files (`schemas/plugins/mcp-v1.schema.json`) of the form
  `{ "schemaVersion": 1, "mcpServers": { "<name>": <config> } }`.
- `skills`: `skills/<skill-name>/SKILL.md`. The file is UTF-8 without a BOM and starts with YAML
  frontmatter that has a `name` equal to the directory name and a non-empty `description`.
- `hooks` (optional): one or more JSON files of the form
  `{"hooks":{"<Event>":[{"matcher":"...","hooks":[...]}]}}`. Only handlers of `type=command` without
  `async=true` run and count; a package has at most 64 of them, and a handler's `timeout` is 1 to 10
  seconds. A handler with the extension fields `args`, `shell`, `if` or `asyncRewake` is skipped and
  not counted. Other unknown handler fields are ignored; do not rely on them. Handlers of other
  kinds do not invalidate the rest of the package. A `matcher` is an exact name or exact
  alternatives separated by `|` (commas are accepted), at most 256 characters. `UserPromptSubmit` and
  `Stop` ignore the matcher; other events accept no regular expression. Tool matchers are case
  sensitive and use the native tool names (`bash`, `read`, `write`, `edit`, `task`). `*` matches all.

A hook command runs in the workspace of the current turn, not in the package. The runtime provides
`PLUGIN_ROOT`; scripts inside the package are started with an explicit interpreter from that root,
for example `bash "$PLUGIN_ROOT/scripts/cleanup.sh"`. Archives do not keep the executable bit, so the
validator rejects running a `.sh` file directly, `bash ./scripts/...`, references to `$PLUGIN_ROOT`
files that do not exist, and host paths it can recognize (absolute POSIX paths, Windows drives, UNC
paths, `~`). The Windows override is `commandWindows`, run by the default Windows shell;
`${PLUGIN_ROOT}` is expanded on both systems, `%PLUGIN_ROOT%` also on Windows, but a bare
`$PLUGIN_ROOT` is not accepted there. The validator checks interpreters and paths statically; it does
not check that `node` or another interpreter is installed.

`category` is one of: `Office`, `Studio`, `Design & Sites`, `Code`, `Business`, `Sales`,
`Productivity`, `Science & Healthcare`, `Education`, `Other`.

`version` is a complete SemVer without a trailing newline. All identifier and path patterns in the
schemas must match completely.

`exampleQueries` is an array of at most 3 strings (it may be empty), each at most 4,096 characters
and non-empty after trimming. `author` is required and `displayName` optional; after trimming both
are non-empty and at most 1,024 UTF-8 bytes. A Plugin references at most 256 Apps. Giving a display
name and one to three meaningful example queries is recommended; do not invent content to pass a
check.

`icon` is required: PNG, JPEG or WebP, with the same path, real-byte and symlink checks as every
other file. It must be a complete image that decodes (all frames of an animation), and its format must
match its extension; truncated files and files with only a header are rejected. The App name and
icon are not part of the package.

MCP servers allow only:

- `type: "stdio"`: needs `command`, the name of an interpreter or executable found through `PATH`
  (no `/` or `\`). Arguments may not be absolute POSIX, Windows drive or UNC paths; a script inside
  the package is referenced by an explicit relative path in the arguments, which the runtime resolves
  against the package root;
- `type: "streamable-http"`: needs `url`;
- `type: "sse"`: needs `url`.

The `http` alias and `auth`, OAuth and refresh fields are not accepted.

All JSON files are UTF-8 objects without a BOM. JSON whitespace and key order are ordinary file
bytes: changing them changes `content_digest`.

Each `name+version` is one universal package: there are no OS or architecture variants, install
scripts or post-install steps. A package cannot depend on symlinks, an executable bit of the source
checkout, or a platform-specific native binary.

## 3. Path contract

To get the same file tree on Windows, macOS and Linux, V1 accepts only portable ASCII paths:

- archive entries and manifest references are relative POSIX paths;
- a segment matches `[A-Za-z0-9._-]+`; the segments `.` and `..` are forbidden;
- absolute paths, drive letters, UNC paths, backslashes, empty segments, NUL and control characters
  are forbidden; a regular file entry or manifest reference does not end in `/`. A ZIP directory
  entry, if present, ends in exactly one `/`, which the reader removes before validating the rest;
- a segment has at most 128 bytes, a path at most 512 bytes and 16 segments;
- Windows reserved base names (`CON`, `PRN`, `AUX`, `NUL`, `COM1` to `COM9`, `LPT1` to `LPT9`,
  also with an extension) are forbidden;
- exact duplicates, ASCII case-insensitive collisions and file/parent type conflicts are rejected;
- symlinks, hardlinks, devices, FIFOs, sockets and other non-regular entries are rejected.

File contents may be any bytes; files that need a text format are checked as UTF-8 by their own
validator. Unicode content is therefore valid, but V1 file names are portable ASCII only. A future
Unicode path rule needs a new digest/path contract version; V1 does not change.

## 4. Fixed safety limits

Whoever unpacks an archive checks all of these before writing to the target directory and fails
closed:

| Item | V1 limit |
| --- | ---: |
| raw archive bytes | 64 MiB |
| archive entries (with directories) | 2,048 |
| regular files | 1,024 |
| bytes of one unpacked file | 16 MiB |
| bytes of all regular files unpacked | 64 MiB |
| path bytes | 512 |
| segment bytes | 128 |
| path segments | 16 |

A V1 archive is a ZIP without a wrapper directory and with `STORE` (method 0) only:

- no encryption, data descriptor, ZIP64, multi-disk, archive or entry comment, or extra field;
- a directory entry is a zero-byte `STORE` entry and does not enter the digest; the deterministic
  archive of section 6 has none;
- `STORE` makes the declared compressed size equal to the uncompressed size, which rules out
  decompression bombs by format;
- a reader still verifies archive size, entry count, per-file and total bytes actually written; it
  does not trust the central directory;
- validation and unpacking go to a temporary directory; it is published atomically only after all
  checks and `content_digest` succeed.

## 5. `content_digest`

```text
sha256-tree-v1:<64 lowercase hex>
```

The input is every regular file that passed sections 3 and 4. Directories, mode, mtime, uid/gid and
the order of archive entries do not matter; an empty directory does not change the result. File
contents count as raw bytes.

1. Encode each relative path as ASCII bytes and sort by path bytes, ascending.
2. Initialize SHA-256 and write, in this order:

```text
ASCII "ALRAN-PLUGIN-CONTENT-DIGEST" + 0x00
uint32_be(1)                         # contract version
uint32_be(file_count)
for each file:
  byte 0x46                          # "F"
  uint32_be(path_byte_length)
  path_bytes
  uint64_be(content_byte_length)
  content_bytes
```

3. Prefix the lowercase hex of the SHA-256 with `sha256-tree-v1:`.

The length fields make path and content boundaries unambiguous. An implementation updates the hash
while streaming and checks the total byte limit again while reading.

## 6. Deterministic archive and `archive_sha256`

A ZIP is built as follows:

- regular files in ascending order of their relative path bytes;
- file entries only, compression method `STORE`;
- `version made by` is Unix 2.0 (OS 3, version 20), `version needed to extract` is 1.0 (10);
- the DOS timestamp is fixed to `1980-01-01 00:00:00`;
- internal attributes 0; external attributes are a Unix regular file `0100644` shifted left by 16
  bits, independent of the mode in the source checkout;
- paths are ASCII, so the general-purpose bit flag is 0; extra fields and comments are empty;
- the archive root is the package root.

`archive_sha256` is the SHA-256 of the complete raw bytes of the final ZIP, as 64 lowercase hex
digits without a prefix. A consumer verifies the bytes it downloaded; it does not rebuild the ZIP.
After `archive_sha256` passes, the entry checks and `content_digest` still run: neither replaces the
other.

## 7. Reference vectors

`test-vectors/plugins/content-digest-v1.source.json` describes valid and rejected cases as virtual
entries equivalent to a real file tree; the generated result is fixed in
`test-vectors/plugins/content-digest-v1.expected.json`. `valid` there only means that the
path/archive/digest contract accepts the tree, not that it passes the manifest, Skill or schema
checks (an empty tree has a well-defined digest but is not a usable Plugin).

Valid vectors cover the empty tree, ordering, empty directories, ignored mode and mtime, empty files
and UTF-8 content. Rejected vectors cover traversal, backslashes, Unicode paths, case and duplicate
collisions, Windows reserved names, symlinks, special files, compression other than `STORE`, and the
single-file and total size boundaries.

An implementation in any language tests against the checked-in expected vectors. The generator runs
only when a contract version is added on purpose, or a case that does not change the semantics, and
the diff of the expected file is reviewed.
