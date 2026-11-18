# alran-acp

ACP launcher for [Alran Code](https://alran.dev). It runs the `alran` binary
from `alran`, forwarding all arguments, stdio, signals and the exit code:

```sh
npx -y alran-acp@<version> acp
```

**This package is not published.** The [ACP
registry](https://github.com/agentclientprotocol/registry) runs Alran Code
directly:

```json
{ "package": "alran@<version>", "args": ["acp"] }
```

`alran` ships a single npm bin (`alran`), so `npx alran acp` starts the ACP
server without a launcher. The launcher was written while `alran` still
shipped a second bin (`alran-tools`, now the internal `internal-bin/alran-tools`
shim), when `npx alran acp` could not pick a binary on its own.

The launcher is kept in the source tree as the reference for a registry entry
that needs its own package name. Publishing it again would need the release
rule below plus a registry entry that points at `alran-acp` instead of `alran`.

**Release rule (if it is ever published):** publish this package at the same
version as `alran`, with `dependencies["alran"]` pinned to that exact version.
