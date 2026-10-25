# Third-party notices

## Upstream MiniMax Code (this project's origin)

Alran Code is a fork of MiniMax Code, which was distributed under the MIT
license. The upstream license text and copyright notice are reproduced here so
that the terms travel with every copy and substantial portion of the
upstream code:

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

This notice covers the upstream MiniMax Code sources vendored in this
repository. The first-party license for the Alran Code changes is in
[LICENSE](LICENSE).

## Other third-party materials

- **Pi**: `third_party/pi-mono` and derived terminal code, MIT. Full notices are in `third_party/pi-mono/LICENSE` and `packages/tui/THIRD_PARTY_NOTICES.md`. Local modifications are recorded in `third_party/pi-mono/ALRAN_CHANGES.md`.
- **Sandbox Runtime**: `third_party/sandbox-runtime`, Apache-2.0. See its README, LICENSE, and upstream.json for the upstream version, source revision, fork changes, and native build instructions.
- **models.dev**: the bundled provider / model catalog snapshot, MIT; notices are in `packages/tui/THIRD_PARTY_NOTICES.md`.
- **Bundled assets**: LICENSE, NOTICE, and file-level declarations in each asset directory retain their original attribution.
- **npm dependencies**: versions and declared licenses are recorded in `release/dependency-licenses.json`; `pnpm-lock.yaml` is authoritative for dependency resolution and integrity.
- **alran-tools 0.0.4**: vendored under `third_party/alran-tools`. It is the upstream tool taken from the public `@minimax-ai/code@0.3.11` npm release and rebranded for Alran Code; the upstream identity and license notices are in `third_party/alran-tools/THIRD_PARTY_NOTICES.md`. Its distribution manifest declares MIT, and the CLI hash is pinned in `scripts/lib/alran-tools-artifact.mjs`. The tool's own manifest is retained, and its notices are copied to `dist/ALRAN_TOOLS_NOTICES.md`. The root license does not replace this artifact's existing declarations.

The root MIT license does not replace these materials' separate licenses or copyright notices.
