# Third-party notices

## 1. MiniMax Code — the upstream this project is derived from

Alran Code is a fork of **MiniMax Code**, distributed under the MIT License.

| | |
|---|---|
| Upstream project | MiniMax Code (`minimax-code`, CLI `mcode`, internal workspace scope `@mavis`) |
| Source | https://github.com/minimax-ai/minimax-code |
| Version merged | 0.7.2, upstream commit `3c21163c85a9684030cb147bfef48c6284fa3c46` (merged into Alran Code as `c60655f`, 2026-11-08) |
| License | MIT |
| Copyright | Copyright (c) 2026 MiniMax Code |

The MIT License requires that the copyright notice and the permission notice are included in all
copies or substantial portions of the Software. They are reproduced here verbatim, and this file
ships in the npm package and in every release archive:

```
MIT License

Copyright (c) 2026 MiniMax Code

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The upstream repository also carried a `NOTICE` file. MIT does not require it to be kept; it is
reproduced here as a courtesy, verbatim:

```
MiniMax Code
Copyright 2026 MiniMax Code

This first-party project attribution does not replace existing file-level or
package-level licenses, third-party copyright notices, or upstream attributions.
See LICENSE-STATUS.md and THIRD_PARTY_NOTICES.md for the applicable declarations.
```

The first-party license for the Alran Code changes is in [LICENSE](LICENSE).

### Modifications made to MiniMax Code

MIT does not require a list of changes; it is kept here because it is good practice for a fork and
because Apache-2.0 components below (Sandbox Runtime) do require one. Main changes against upstream
0.7.2:

1. **Identity.** Product name, CLI binary (`mcode` → `alran`), workspace scope (`@mavis/*` →
   `@alran/*`), environment variables (`MAVIS_*` → `ALRAN_*`, with a read-only compatibility shim
   until 2027-Q1), data directory (`~/.mavis` → `~/.alran`, migrated once with a compatibility
   symlink), prompts, UI strings, docs and tests.
2. **Accounts.** The upstream account system is replaced by the Ottili Platform: OpenID Connect
   sign-in (`alran auth login`), Platform sessions, company and project context, session revocation.
3. **Models.** The upstream model catalogue is replaced by Ottili models served by the Ottili AI
   Gateway (`werk`, `anthropic/claude-sonnet-5.5`, `anthropic/claude-opus-5.5`); third-party
   providers remain available as bring-your-own-key.
4. **Telemetry.** All upstream reporting endpoints are removed; usage reporting is opt-in and sends
   nothing unless a deployment names its own endpoint.
5. **Updates.** The upstream release host is removed; updates follow the npm package
   `@ottili/alran-code` or a self-hosted signed `latest.json`.
6. **Removed content.** Upstream brand material (a website brand-guide case of the PDF skill) and
   upstream community links.
7. **Tooling.** Brand gate (`pnpm lint:no-minimax`), license gate (`pnpm license-check`), Ottili
   commands (`alran auth`, `alran usage`, `alran billing`, `alran models`, `alran config`).

The complete history is the Git history of https://github.com/Alran-AI/code.

## 2. Other third-party materials

- **Pi**: `third_party/pi-mono` and derived terminal code, MIT. Full notices are in `third_party/pi-mono/LICENSE` and `packages/tui/THIRD_PARTY_NOTICES.md`. Local modifications are recorded in `third_party/pi-mono/ALRAN_CHANGES.md`.
- **Sandbox Runtime**: `third_party/sandbox-runtime`, Apache-2.0. See its README, LICENSE, and upstream.json for the upstream version, source revision, fork changes, and native build instructions.
- **models.dev**: the bundled provider / model catalog snapshot, MIT; notices are in `packages/tui/THIRD_PARTY_NOTICES.md`.
- **Bundled assets**: LICENSE, NOTICE, and file-level declarations in each asset directory retain their original attribution.
- **npm dependencies**: versions and declared licenses are recorded in `release/dependency-licenses.json`; `pnpm-lock.yaml` is authoritative for dependency resolution and integrity.
- **alran-tools 0.0.4**: vendored under `third_party/alran-tools`. It is the upstream media-tools CLI taken from the public `@minimax-ai/code@0.3.11` npm release (MIT) and rebranded for Alran Code; the upstream identity and license notices are in `third_party/alran-tools/THIRD_PARTY_NOTICES.md`. Its distribution manifest declares MIT, and the CLI hash is pinned in `scripts/lib/alran-tools-artifact.mjs`. The tool's own manifest is retained, and its notices are copied to `dist/ALRAN_TOOLS_NOTICES.md`. The root license does not replace this artifact's existing declarations.

The root MIT license does not replace these materials' separate licenses or copyright notices.

## 3. Dependencies with licenses other than MIT, ISC, BSD and Apache-2.0

`pnpm license-check` (`scripts/check-licenses.mjs`) reads `release/dependency-licenses.json` and
fails on any license that is not on its allow-list. The reviewed exceptions:

| Package | Declared license | Use |
|---|---|---|
| `chownr`, `glob`, `lru-cache`, `minimatch`, `minipass`, `path-scurry`, `tar`, `yallist` | BlueOak-1.0.0 | permissive; license text kept under `licenses/` of a release archive |
| `argparse` | Python-2.0 | permissive (PSF); notice kept |
| `jszip` | MIT OR GPL-3.0-or-later | used under MIT |
| `node-forge` | BSD-3-Clause OR GPL-2.0 | used under BSD-3-Clause |
| `expand-template` | MIT OR WTFPL | used under MIT |
| `pako` | MIT AND Zlib | both permissive |
| `type-fest` | MIT OR CC0-1.0 | used under MIT |
| `tslib` | 0BSD | permissive |

No dependency is under a copyleft-only license (GPL, LGPL, AGPL, SSPL, EUPL). The full list with
versions is `release/dependency-licenses.json`; a release archive carries every bundled package's
own license text under `licenses/`.

