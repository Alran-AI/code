# Maintainers and contribution workflow

## Responsibility

| Responsibility | Routing | What it covers |
| --- | --- | --- |
| Repository administration and releases | The maintainers of the Alran-AI organization | Access and branch protection, review assignment, release approval; only a verified, tagged commit is published ([UPDATE_PIPELINE.md](UPDATE_PIPELINE.md)). |
| Code review | `.github/CODEOWNERS` | Correctness, tests, capability boundaries, license and notice changes. A change that needs approval is approved by someone other than its author. |
| Security reports | Private reports under [SECURITY.md](../SECURITY.md) | Receive privately, appoint a responder, coordinate the fix and the disclosure. No response time is promised. |

These are maintenance duties, not a statement about who owns the copyright.

## Issues

Everyone may report bugs, request features, ask questions and flag documentation problems in
[GitHub Issues](https://github.com/Alran-AI/code/issues/new/choose). Code and documentation pull
requests are welcome; open an issue first for anything larger than a fix, so the direction can be
discussed before the work is done.

Labels, used independently: type (`bug`, `enhancement`, `documentation`, `question`), triage
(`needs-triage`: waiting for a maintainer; `needs-info`: the reporter was asked for something specific).

1. Start with issues labelled `needs-triage` and with unlabelled ones.
2. Confirm one type. Ask for the missing version, reproduction or expected behaviour, replace
   `needs-triage` with `needs-info`, and keep the labels already known.
3. Close a report that cannot be acted on after the reporter was asked and did not answer, and say why.
4. Anything that looks like a vulnerability moves to the private channel; remove credentials and private
   project content from the public issue.

## Pull requests

- Run `pnpm verify` before asking for review (it runs the typecheck, lint, the brand and license
  gates, the source inventory and the test suites); `pnpm verify --profile docs` for documentation.
- A new file in the published tree is added to the inventory with `node scripts/source-inventory.mjs --write`.
- Keep third-party license text and notices intact; `pnpm license-check` fails when a nested upstream
  license loses its original copyright line.
- The names of the upstream code base appear only in the legal files and in the marked compatibility
  shims (`pnpm lint:no-minimax`).

## Releases

A release is prepared by `pnpm build && pnpm release:npm-dry-run --pack ./out`, tried from the tarball,
and published by a maintainer with the Ottili npm account: [UPDATE_PIPELINE.md](UPDATE_PIPELINE.md).
