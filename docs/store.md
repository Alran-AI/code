# Plugin Store and Skill Library

The **Plugin Store** is where Alran Code finds Plugins; the **Skill Library** is the same catalogue
seen as single Skills. Both come from one or more **stores**: a store is a static `index.json` plus the
package archives it lists, and it can be hosted anywhere that serves files.

- A **Plugin** is a package of Skills, MCP servers, connectors and hooks
  ([package format](plugins/package-format-v1.md)). It installs into `<data-dir>/plugins/<name>` and is
  enabled the moment it is there.
- A **Skill** is one folder with a `SKILL.md`. It installs into `<data-dir>/skills/<name>`, where Alran
  already looks for your own Skills.

```bash
alran plugin marketplace add <url>  # add a store (there is no built-in one yet)
alran plugin search <words>         # find a Plugin
alran plugin info <name>            # what is in it, before you install it
alran plugin install <name>
alran skills search <words>         # find a Skill
alran skills install <name>
```

Inside the TUI, `/plugin` opens the Store and `/skills library` opens it on the Skill Library.

## The TUI

`/plugin` (also `/plugins` and `/store`) shows four views; `Tab` and `Shift+Tab` switch between them.

| View | Shows |
| --- | --- |
| **Plugins** | Every Plugin the stores offer, with its state |
| **Skill Library** | Every Skill the stores offer, grouped by their store's own groups |
| **Installed** | What is installed: from a store, from a folder, or from the Runtime registry |
| **Stores** | Each store, how many packages it lists, and why it could not be read if it could not |

Type to search (names, titles, groups, authors and descriptions; the best match comes first). The panel
under the list shows what the selected item is for, what it contains and what `Enter` will do.

| Key | Action |
| --- | --- |
| `Enter` | Install, or update when the store offers a newer version |
| `Space` | Switch an installed Plugin on or off |
| `Delete` / `Ctrl+D` | Remove (with the search box empty) |
| `Ctrl+R` | Ask the stores again instead of using the cached index |
| `Esc` | Clear the search, then close |

A Plugin that runs commands or connects to services is not installed straight away: the panel lists
each MCP server command, hook and connector first, and `Enter` approves while `Esc` cancels. A Plugin
that only holds Skills installs at once.

`/skills` without arguments still lists the Skills that are active in this session;
`/skills library [words]` opens the Library.

## The command line

| Command | Does |
| --- | --- |
| `alran plugin search [words]` | Search Plugins in all stores |
| `alran plugin info <name>` | Show description, contents and example prompts |
| `alran plugin install <name>[@store]` | Install (alias `add`); `--yes` approves a Plugin that runs commands |
| `alran plugin update [name]` | Update one Plugin, or every Plugin that has an update |
| `alran plugin remove <name>` | Remove a Plugin the Store installed |
| `alran plugin enable\|disable <name>` | Switch a Plugin on or off |
| `alran plugin list [--available]` | Installed Plugins, or everything on offer |
| `alran plugin marketplace list` | The stores and the local Plugin folder |
| `alran plugin marketplace add <url> [--name n]` | Add a store |
| `alran plugin marketplace remove <name>` | Remove a store you added |
| `alran skills list [--installed]` | The Library, by group |
| `alran skills search\|info\|install\|update\|remove …` | The same verbs for Skills |

`--json` prints a document for scripts, and `--refresh` on `search` ignores the cache. When a name is
offered by several stores, say which one: `name@store`. Without a terminal, a Plugin that runs
commands is refused unless `--yes` is given; the list of what it runs is printed to standard error
either way.

Skill commands, `plugin search` and the `marketplace` commands never start the Alran runtime, so they take
about as long as the network does. The other Plugin commands start it, to read the state of Plugins and
to reload them after a change.

## Where things go

| Path (under the data directory) | Holds |
| --- | --- |
| `plugins/<name>/` | An installed Plugin (this is also where a Plugin you copy in by hand lives) |
| `skills/<name>/` | An installed Skill |
| `store/installed.json` | What the Store installed, from which store, at which version and digest |
| `store/sources.json` | The stores you added |
| `store/cache/` | The last index of each remote store |

The Store only ever replaces or removes a directory that `installed.json` lists. A Plugin or Skill you
put there yourself keeps its name: the Store shows it as installed outside the Store and will not
overwrite it. A damaged `installed.json` is set aside as `installed.json.corrupt-…`, and without a
ledger the packages it listed count as yours; reinstalling from the store restores the record.

## What is checked, and what is not

Before anything is written, every package is verified from its bytes:

1. the archive's size and SHA-256 equal the values pinned in the index;
2. the archive is read by a strict reader (STORE-only ZIP, portable ASCII paths, no links, no
   duplicate or case-colliding names, size and entry limits), the same rules the Runtime applies to
   registry packages;
3. the unpacked tree's content digest equals the one in the index;
4. the manifest names the package and version the index listed, and every file it references exists.

What a Plugin will *run* is read from the verified archive, never from the index, so an index that
understates a package cannot get past the approval step. Archives carry no install scripts. Text from a
store (names, descriptions, command lines) is shown with control characters made visible, so a store
cannot redraw your terminal.

Not covered: **trust in the store itself.** An index is fetched over HTTPS (plain `http` is accepted
only for `localhost`), but it is not signed; whoever controls a store controls what it lists. Read
what a Plugin runs before approving it, and add only stores you trust. Signed indexes are a possible
later step.

## Stores

Alran Code ships **without a catalogue**: no store is built in yet, so a fresh install shows an empty
Store and says how to add one. Until Ottili publishes a store of its own, use one you trust:

- `alran plugin marketplace add <url>` adds a store. A URL that names a directory means
  `<url>/index.json`; a path to a folder on disk or a mounted share works the same way.
- `ALRAN_STORE_URL` sets a default store (an `https` URL, a `file:` URL or a path), named `ottili`; unset
  it to drop it.

A remote index is cached under the data directory: used without a request for ten minutes, then
revalidated with its ETag, and used as it was when the network is down (the Store says so). A store that
cannot be read never hides the others.

| Variable | Meaning |
| --- | --- |
| `ALRAN_STORE_URL` | Address of the default store (named `ottili`); none when unset |
| `ALRAN_PLUGIN_REGISTRY_URL` | A Runtime registry (the older `official` source); only asked when set |
| `ALRAN_DATA_DIR` | The data directory everything above lives under |

## Run your own store

A store is built, not hand-written. `tools/store/build-store.mjs` turns a repository of Skills and a
small config into an `index.json` plus the archives:

```bash
node tools/store/build-store.mjs --source <skills-repo>            # writes <skills-repo>/store/
node tools/store/build-store.mjs --source <skills-repo> --check    # exit 1 if the output is stale
```

It reads `<skills-repo>/store/store.config.json` (`alran.store.build/v1`): the store's name, Skills to
leave out and their reasons, titles and group names, and the Plugins. A Plugin is either a **bundle**,
a list of Skills (`skills`) or whole library groups (`packages`) assembled into a package, or a ready
package directory (`directory`). Every assembled Plugin passes the public Plugin validator before it is
archived. The output is a pure function of the inputs, so the same repository always gives the same
bytes and `--check` can gate a CI run. Publish the resulting folder on any static host. Whoever publishes a
store is responsible for the licence of every Skill and Plugin in it.

The format of the index is in [store/index-format-v1.md](store/index-format-v1.md).
