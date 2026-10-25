# @ottili/alran-code-acp

ACP launcher for [Alran Code](https://api.ottili.one). It runs the `alran`
binary from `@ottili/alran-code`, forwarding all arguments, stdio, signals and the
exit code:

```sh
npx -y @ottili/alran-code-acp@<version> acp
```

Why: `@ottili/alran-code` ships two bins (`alran`, `alran-tools`), so
`npx @ottili/alran-code acp` cannot decide which to run. This package has a single
bin, which is what the [ACP registry](https://github.com/agentclientprotocol/registry)
npx distribution needs.

**Release rule:** publish this package at the same version as `@ottili/alran-code`,
with `dependencies["@ottili/alran-code"]` pinned to that exact version. The ACP
registry auto-update follows this package's version.
