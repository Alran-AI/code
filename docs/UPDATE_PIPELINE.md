# Update pipeline

## The package

- npm name: **`alran`**, binary `alran`, public, registry `https://registry.npmjs.org/`.
- Install: `npm install -g alran` (Node 22.19+ on 22.x, 24.2+ on 24.x, 25 or 26).
- `alran --version` prints the version.
- The package is staged from `dist/` with its own manifest (`scripts/package-cli-release.mjs`): about
  800 files, 13 MB packed, `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md` included, the native
  dependencies (`better-sqlite3` …) declared so npm installs the build for the user's Node.

The earlier package `@ottili/code` (0.1.1–0.1.4) was the whole workspace (7,549 files, 44 MB) with a
`better-sqlite3` built for Node 22 inside it. On Node 24 it crashes on the first run
(`NODE_MODULE_VERSION 127 … requires 137`, then `free(): invalid pointer`), and 0.1.4 reports itself
as 0.1.3. It should be deprecated once `alran` is published (see below).

## How an installed CLI updates

| Installed with | `alran update` does |
|---|---|
| npm, pnpm, yarn, bun (global) | Detects the package manager from the install location, compares with the registry's `latest`, asks `Install the update now? [y/N]`, and runs that manager's global install of `@ottili/alran-code@latest`. Without a terminal it prints the command instead. |
| The installer (managed install) | Reads the signed channel manifest from the release host (`https://cdn.ottili.one/alran-code/channels/<channel>.json` + `.sig`), downloads the release, verifies signature and sha256, and swaps it in. |
| Anything else | Prints the command to run. |

`alran update --source <https-url>` (or `ALRAN_UPDATE_SOURCE`) points a managed install at a
self-hosted mirror with the same layout; only https is accepted.

**Weekly hint.** The plain subcommands (`alran usage`, `alran models`, …) look up npm's `latest` at
most once every 7 days (stamp file in the data directory, 1.5 s budget, stderr only) and print a
one-line hint when a newer version exists. `ALRAN_NO_UPDATE_CHECK=1` and `CI` switch it off.

## Releasing a version (founders)

1. Bump `version` in `package.json` and `packages/tui/package.json` (the line stays on 0.x until the
   release is final), commit, tag `vX.Y.Z` on `main`.
2. `pnpm install --frozen-lockfile && pnpm verify` (all gates, including `lint:no-minimax` and
   `license-check`).
3. `pnpm build && pnpm release:npm-dry-run --pack ./out` — prints the file list, size, legal files and
   dependencies, and writes `./out/alran-X.Y.Z.tgz`.
4. Try the tarball: `npm install -g ./out/alran-X.Y.Z.tgz`, then `alran --version`,
   `alran auth login`, `alran exec "Reply with: pong"`.
5. Publish: `cd` into the staged package (or use the tarball) and run `npm publish --access public`
   with the Ottili npm account. **Agents do not run this step.**
6. Once: `npm deprecate @ottili/code "Renamed to @ottili/alran-code: npm install -g alran"`.
7. The download pages (Console → Developer → Alran Code, AI Platform → Settings → CLI) read the
   version from `GET https://ai.ottili.one/v1/products/alran-code/version`, which asks npm; they show
   it as soon as npm has it.

## Self-hosted release host (optional)

`https://cdn.ottili.one/alran-code` is the default base of managed installs, but `cdn.ottili.one` has
no DNS record yet, and no installer script is published (`README` therefore leads with npm). To turn
it on: serve `channels/stable.json(+.sig)` and `releases/<version>/manifest.json(+.sig)` plus the
archives from any static host (R2, S3, nginx), signed with an Ottili release key (Ed25519). The
public half travels with the installation (`install.json` written by the installer, or
`ALRAN_RELEASE_PUBLIC_KEY_FILE`); then add the DNS record and publish an installer script. Until then managed installs have
nothing to update from and npm is the supported path.
