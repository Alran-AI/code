# Migration from MiniMax Code

Alran Code is derived from MiniMax Code (MIT). This page is for anyone who used the upstream CLI or
an early Alran Code build and wants to know what moved.

## What changed

| Before | Now |
|---|---|
| `mcode` / `mavis` binaries, `@minimax-ai/code` | `alran`, npm package `@ottili/alran-code` |
| `~/.mavis` data directory | `~/.alran` |
| `MAVIS_*` / `MCODE_*` environment variables | `ALRAN_*` |
| MiniMax account, MiniMax models | Ottili account (`alran auth login`), models through the Ottili AI Gateway (Werk, Claude Sonnet 5.5, Claude Opus 5.5) |
| MiniMax plugin registry, skill hub, telemetry hosts | None by default (`docs/PLUGINS.md`); usage reporting only to an `ALRAN_TELEMETRY_ENDPOINT` an operator sets |
| Blue terminal theme | Ottili violet theme (Foundation tokens) |

## Compatibility shims (remove after 2027-Q1)

Both are marked `legacy-brand-compat` in the code and are the only places the old names may appear
outside the legal files (`pnpm lint:no-minimax` enforces this).

1. **Data directory** (`packages/config/src/data-dir.ts`). On the first start, an existing `~/.mavis`
   without a `~/.alran` is moved to `~/.alran` and a link `~/.mavis → ~/.alran` is left, so tools that
   still look there find the same data. Nothing is deleted.
2. **Environment variables** (`packages/config/src/legacy-env.ts`). A set `MAVIS_X` or `MCODE_X` is
   read as `ALRAN_X` when `ALRAN_X` is not set, and the CLI prints once on stderr which names it
   translated. The old variables stay in the environment for child processes.

**Removal (2027-Q1):** delete `legacy-env.ts`, its export and its call in `packages/tui/src/index.ts`;
delete the legacy block in `data-dir.ts`; remove the `legacy-brand-compat` exceptions; run
`pnpm verify`.

## What does not carry over

- Upstream sessions and settings are kept (same file formats); credentials of the upstream account
  are not usable with Ottili. Sign in again with `alran auth login`.
- Plugins installed from the upstream registry stay installed but cannot be updated from it.
