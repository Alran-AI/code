# Models and credit

Alran Code offers exactly the models the Ottili AI Gateway serves. Ottili's models come first;
providers with your own key are an explicit opt-in.

## Ottili models (through the gateway)

| Model | Gateway id | Short names | Input / output per 1M tokens | Credit |
|---|---|---|---|---|
| Ottili Werk 1.1 (default) | `ottili/werk-1.1` | `werk` | $0.50 / $1.50 | free (welcome) or paid |
| Claude Sonnet 5.5 | `anthropic/claude-sonnet-5.5` | `sonnet` | $2.00 / $10.00 + 4.5 % service fee | paid only |
| Claude Opus 5.5 | `anthropic/claude-opus-5.5` | `opus` | $4.00 / $20.00 + 4.5 % service fee | paid only |

The Claude models are bought from Anthropic through OpenRouter at their list price; the service fee
is shown as its own line in `alran usage` and in the AI Platform's request log. Prices are the
gateway's (`alran-platform/src/core/models.mjs`); `alran models` reads them live.

## The credit rule (enforced by the gateway)

The wallet has one balance; the gateway derives two pools from it:

- **free** — the welcome credit the Platform granted on sign-up. Spent only on Werk.
- **paid** — everything else (top-ups). Spent on any model.

Werk spends the free pool first, then the paid pool. A Claude model spends only the paid pool. With
no paid credit, the gateway refuses the call before it reaches the upstream:

```
HTTP 403  { "error": { "code": "free_credit_model_restricted", "param": "model",
  "message": "Your free credits are restricted to Werk. Add paid credits to use Claude Sonnet 5.5." } }
```

The rule lives in the gateway (`alran-platform/src/core/credit-pools.mjs`,
`gateway-pipeline.mjs`). The CLI only warns in advance (`alran config model sonnet` with no paid
credit) — a client can be changed, the gateway cannot. `alran exec` and the TUI show the gateway's
message; the account commands (`alran usage`, `alran models`) exit with code 5 on it.

## Commands

| Command | What it does |
|---|---|
| `alran models` | The three Ottili models with price and whether your credit allows them (green: yes, yellow: needs paid credit, red: no credit left). |
| `alran models --info <model>` | One model in detail. |
| `alran models --set-default <model>` / `alran config model <model>` | The default model (`werk`, `sonnet`, `opus` or a full id). |
| `alran models --third-party` | The bring-your-own-key catalogue (models.dev snapshot). |
| `alran usage` | Credit left (free and paid), this month per model, the service fee. |
| `alran billing` | Plan, payment method summary, last invoice; links to the billing page for changes. |
| `alran exec --model alran/anthropic/claude-sonnet-5.5 "…"` | One run with another model (full key; the short names work in `alran config model` and `alran models`). |

## Bring your own key

Third-party providers (the models.dev catalogue) and custom OpenAI-compatible endpoints stay
available behind `alran models --third-party` and `/provider` in the TUI. Such calls go **directly**
to the provider with your key: Ottili does not see, meter or bill them, and the free credit does not
apply. `alran provider add … --api-key-env <VAR>` keeps the key in your environment, so it is not
written to disk at all.

## When the gateway cannot be reached

The call fails (exit code 4) with the gateway URL in the message. Alran Code never falls back to a
direct provider call on its own, because that would bypass metering. Retry, or choose a
bring-your-own-key provider explicitly.
