# Accounts, credit and models

Use this reference for signing in, companies and projects, API keys, credit (Werk), the Anthropic key
that Claude runs on, models and their prices, `alran usage`, bring-your-own-key providers, and why a model or a sign-in is
refused.

## Stable boundaries

- The account is an Ottili account. The CLI never sees a password: it holds a Platform session
  (`~/.alran/auth/platform/<env>/platform-session.json`, mode 0600). Signing out revokes it at the
  Platform.
- Credit is one wallet. It pays for Werk (the welcome credit covers it). It does **not** pay for Claude.
- Claude runs on the customer's **own Anthropic API key**: they add it once in the AI Platform under
  Settings → Provider keys (an admin does; it is checked, stored encrypted, used only for their requests).
  The gateway sends their request to Anthropic with it and **Anthropic bills their Anthropic account
  directly**. Ottili charges nothing for Claude: no token price, no service fee, no hold on credit.
- The gateway enforces this, not the CLI. Without a working key a Claude request is refused with
  `byok_key_required` (HTTP 403); `byok_key_invalid` / `byok_key_rejected` mean Anthropic does not accept the
  stored key; `byok_provider_billing` (HTTP 402) means the Anthropic account has no credit left — the money
  to add is Anthropic's, not Ottili's. The way out is the AI Platform (Settings → Provider keys) or Werk.
- `alran usage` shows the tokens of Claude requests as "billed by Anthropic" and the state of the key.
- A provider key you configure in Alran Code itself (`alran provider add`) is a different path: calls go
  directly to the provider, and Ottili does not see, meter or bill them.
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
2. `alran usage` and `alran models`: is there credit (Werk), is an Anthropic key stored and accepted
   (Claude)? Exit code 5 or a `byok_*` code is an answer about credit or the key, not a fault.
3. Exit code 4 is a reachability problem: check `ALRAN_API_BASE` (default
   `https://ai.ottili.one/v1`) and `OTTILI_PLATFORM_URL` (default `https://platform.ottili.one`).
4. Report the conclusion first, then the command or page it came from, then what only the user can
   check (for example the balance in Billing).

## Safety

Never ask the user to paste an API key, a session file, a password or a sign-in code. Never promise
that a model is covered by the free credit without `alran models` saying so, and never say that Ottili
bills Claude or adds a fee to it. Do not bypass the gateway or suggest a client change as a way around a
credit or key rule.
