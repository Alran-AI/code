# Accounts, credit and models

Use this reference for signing in, companies and projects, API keys, credit (free and purchased),
models and their prices, `alran usage`, bring-your-own-key providers, and why a model or a sign-in is
refused.

## Stable boundaries

- The account is an Ottili account. The CLI never sees a password: it holds a Platform session
  (`~/.alran/auth/platform/<env>/platform-session.json`, mode 0600). Signing out revokes it at the
  Platform.
- Credit is one wallet that the gateway splits into two pools: **free** (the welcome credit, spent
  only on Werk) and **paid** (top-ups, spent on any model). Werk spends the free pool first. A Claude
  model spends only the paid pool.
- The gateway enforces the rule, not the CLI. With free credit only, a Claude request is refused
  with the code `free_credit_model_restricted` (HTTP 403) before it reaches the provider. The way
  out is to add credit in the AI Platform (Billing) or to use Werk.
- The Claude models carry a 4.5 % service fee that shows as its own line in `alran usage` and in the
  request log of the AI Platform.
- Your own provider key is a different path: calls go directly to the provider, and Ottili does not
  see, meter or bill them. The free credit does not apply to them.
- The agent cannot change a balance, a limit, a company or a permission.

## Commands

| Need | Command |
| --- | --- |
| Sign in | `alran auth login` (browser) · `--device` (a code you confirm in any browser; the default over SSH or without a display) · `--api-key` (an Ottili API key from `https://ai.ottili.one/api-keys`, for machines without a browser) |
| Who is signed in | `alran auth status` |
| Another company | `alran auth switch-company` |
| Company and project | `alran config company`, `alran config project [<id>]` |
| Sign out | `alran auth logout` |
| Models, prices, what the credit allows | `alran models`, `alran models --info <model>` |
| Default model | `alran config model <werk\|sonnet\|opus\|full id>` |
| Credit and spend | `alran usage`, `alran billing` |
| Bring your own key | `alran models --third-party`, `alran provider add … --api-key-env <VAR>`, `/provider` in the TUI |

Prices change: read them from `alran models` or from Models in the AI Platform, never from memory.

## Exit codes of the account commands

0 success · 1 error · 2 sign-in needed · 3 rate limited (the reset time is printed) · 4 Platform or
gateway not reachable (nothing falls back to a provider on its own) · 5 the credit does not allow the
request.

## Diagnostic workflow

1. `alran auth status`: signed in? which company and project? A 401 or exit code 2 means
   `alran auth login`.
2. `alran usage` and `alran models`: is there credit, and does it cover the chosen model? Exit code 5
   or `free_credit_model_restricted` is a credit answer, not a fault.
3. Exit code 4 is a reachability problem: check `ALRAN_API_BASE` (default
   `https://ai.ottili.one/v1`) and `OTTILI_PLATFORM_URL` (default `https://platform.ottili.one`).
4. Report the conclusion first, then the command or page it came from, then what only the user can
   check (for example the balance in Billing).

## Safety

Never ask the user to paste an API key, a session file, a password or a sign-in code. Never promise
that a model is covered by the free credit without `alran models` saying so. Do not bypass the
gateway or suggest a client change as a way around a credit rule.
