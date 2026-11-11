# alran-acp

ACP launcher for [Alran Code](https://api.ottili.one). It runs the `alran`
binary from `alran`, forwarding all arguments, stdio, signals and the
exit code:

```sh
npx -y alran-acp@<version> acp
```

Why: `alran` ships two bins (`alran`, `alran-tools`), so
`npx alran acp` cannot decide which to run. This package has a single
bin, which is what the [ACP registry](https://github.com/agentclientprotocol/registry)
npx distribution needs.

**Release rule:** publish this package at the same version as `alran`,
with `dependencies["alran"]` pinned to that exact version. The ACP
registry auto-update follows this package's version.
