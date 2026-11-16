# Architecture

Alran Code is Ottili's terminal coding agent. It builds on MIT-licensed upstream material (see
`THIRD_PARTY_NOTICES.md`); the agent loop, the tool system and the terminal UI come from there,
and this document says what Alran Code adds around them and where the boundaries are.

## The three parts and who owns what

| Part | Repository | What it does for Alran Code |
|---|---|---|
| Alran Code (this repo) | `alran-code` | The `alran` CLI: terminal UI, `alran exec`, agent loop, tools, Plugins, account commands. |
| Ottili Platform | `ottili-platform` | Sign-in (Keycloak behind the Platform), sessions, companies, shared projects, the wallet. `https://platform.ottili.one` |
| Ottili AI Platform | `alran-platform` | The AI Gateway (`https://ai.ottili.one/v1`): models, metering, the credit rule, usage, API keys, the release endpoint. |

Alran Code never talks to a model provider on the user's behalf through Ottili except via the
gateway, and never meters anything itself. The gateway is the one place that decides whether a
request may run and what it costs (see `docs/MODELS.md`).

## Request path of a model call

```
alran (TUI / exec)
  └─ model resolver (packages/local-runtime-v2/src/service/model-system)
       ├─ provider "alran"  → Ottili AI Gateway  POST /v1/chat/completions
       │     Authorization: Bearer <Platform session id | sk-ottili-… key>
       │     x-ottili-company: <company id>   x-ottili-project: <project id>
       │     → credit rule, hold on the wallet, upstream (Werk; OpenRouter for Claude), settle
       └─ bring-your-own-key providers → the provider's own API, directly (not metered by Ottili)
```

There is no silent fallback from the gateway to a direct provider: if the gateway is unreachable the
call fails with exit code 4 and says so.

## Account commands

`packages/tui/src/cli/account-commands.ts` implements `alran auth`, `alran config`, `alran models`,
`alran usage` and `alran billing`. They read and write the same files the runtime uses
(`packages/config/src/platform-session.ts`), call the Platform for identity, companies and projects,
and the gateway's `GET /v1/credits` for prices, pools and spend. Exit codes: 0 ok, 1 error,
2 sign-in needed, 3 rate limited, 4 unreachable, 5 the credit does not allow it. Details in
`docs/AUTH.md`.

## Data on disk

Everything lives in the data directory, `~/.alran` (override: `ALRAN_DATA_DIR`): `config.yaml`
(settings, an API key if one was pasted), `auth/platform/<env>/platform-session.json` (the Platform
session, 0600 in a 0700 directory), `auth/platform/account.json` (selected project per company), session
history, Plugins (`plugins/`), the weekly update-check stamp.

## Gates

`pnpm verify` runs, among others: the typecheck, `check:source` (the published file inventory),
`lint:brand` (no upstream name or host outside the legal attribution files),
`license-check` (legal files complete, dependency licenses allowed) and `test:gates`.

# Source boundaries

`TUI / exec / ACP → CliService → local Applications → Session / Turn / Agent services → Pi / model providers / local tools`.

- `packages/tui` owns terminal interaction and the headless and ACP adapters.
- `packages/local-runtime-v2/src/local` is the in-process product entry point. Session query views and queue contracts derive from local service types and converters.
- `packages/local-runtime-v2/src/application` handles sessions, queues, and interactions. It does not instantiate DesktopService, an HTTP front door, or cloud handoff services.
- `packages/protocol/src/local.ts` contains CLI data structures; `runtime.ts` contains agent configuration and events. Neither includes RPC envelopes, service routing, authentication headers, or an IDL generation chain. Some numeric enums preserve compatibility with existing saved sessions.
- `packages/local-runtime` supplies reused host facilities such as databases, file tools, permissions, and storage. Historical readers only read old session files; they do not proxy to a daemon or fall back to a legacy executor.
- `third_party/pi-mono` supplies agent, model-protocol, and terminal infrastructure. `third_party/sandbox-runtime` retains the actual sandbox fork, native helpers, and corresponding source.

`@alran/*` names identify private workspace packages in this repository. The build resolves their source directly rather than downloading them from an internal registry. These packages are not independently published npm APIs.

The unused `@alran/team` cycle engine is excluded from this projection. TUI delegation uses the current runtime task services. Legacy queue, lock-owner and run-location files retain only the types consumed by shared adapters; V2 owns their execution and persistence.

`release/public-source.json` explicitly lists delivered files. `check:source` checks that inventory, canonical root license text, internal addresses, retired modules, obvious credentials, and workspace exports. `check:standalone` separately checks the actual build dependency graph. New files require explicit inventory updates; absence from the bundle alone does not make source suitable for publication.

## Managed capabilities and tool integration

The TUI continues to use the same runtime through local applications and services. Alran OAuth Core manages profile credentials, refresh, and logout. alran-tools-host provides short-lived access tokens to tool subprocesses through a local lease broker. Official plugins, connectors, accounts, and search use their public service clients without restoring DesktopService or an HTTP front door.

Headless model overrides are passed to a read-only account-state check so authentication requirements follow the model selected for that run. The check does not change global configuration or the session model; execution still uses the existing model resolver, permissions, and tools.

The public distribution configures production regional services only. Non-production environments retained in shared types use reserved `.example.invalid` placeholders. The public CLI rejects internal environment switches and provides no default connection to internal services.
