# alran-tools

The `alran-tools` CLI vendored here is the upstream media-tools CLI, version
0.0.4, build `dc5364ace5719d605980e2dc096cab9eb0ee05f1`, rebranded for Alran
Code. The upstream package coordinates are recorded in the repository's
[third-party notices](../../THIRD_PARTY_NOTICES.md).

The rebrand is limited to identity and endpoint strings: the environment
variables the CLI reads, the authentication lease socket and capability file
names, the client id, the user-facing messages, and the platform base URLs.
They now point at the Ottili platform. The tool's behaviour is otherwise
unchanged, and the embedded bytes are pinned by hash in
`scripts/lib/alran-tools-artifact.mjs`.

## Local changes to the vendored CLI

One change was made to the vendored bytes after the rebrand: the
`TEST_SANDBOX_API_BASE_URLS` table, which pointed at two internal Kubernetes
service addresses of the company the CLI was originally built for, was removed
together with the `BUILD_ENV === "test"` branch that selected it. The vendored
build is `prod`, so that branch was already unreachable; the removal leaves no
upstream infrastructure address in the shipped artifact. The pinned hash in
`scripts/lib/alran-tools-artifact.mjs` and the resource hash in
`manifest.json` were updated to the new bytes. No other behaviour changed.

> # Third-party notices
>
> ## Pi TUI
>
> Portions of the terminal user interface are derived from Pi TUI and are distributed under the MIT
> License below.
>
> MIT License
>
> Copyright (c) 2025 Mario Zechner
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial
> portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
> OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
> CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
>
> ## models.dev
>
> The bundled provider and model catalog is derived from models.dev and is distributed under the MIT
> License below.
>
> MIT License
>
> Copyright (c) 2025 models.dev
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial
> portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
> OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
> CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
>
