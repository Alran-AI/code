# Models and credit

Alran Code offers exactly the models the Ottili AI Gateway serves. Ottili's models come first;
providers with your own key are an explicit opt-in.

## Ottili models (through the gateway)

| Model | Gateway id | Short names | Input / output per 1M tokens | Billed by |
|---|---|---|---|---|
| Ottili Werk 1.1 (default) | `ottili/werk-1.1` | `werk` | $0.50 / $1.50 | Ottili: welcome or purchased credit |
| Claude Sonnet 5.5 | `anthropic/claude-sonnet-5.5` | `sonnet` | $2.00 / $10.00 (Anthropic's price) | Anthropic, on your own API key |
| Claude Opus 5.5 | `anthropic/claude-opus-5.5` | `opus` | $4.00 / $20.00 (Anthropic's price) | Anthropic, on your own API key |

Prices are the gateway's (`alran-platform/src/core/models.mjs`); `alran models` reads the state live.

## Claude runs on your own Anthropic key

The Claude models are not resold. They run on **your own Anthropic API key**: you add it once in the
Ottili AI Platform under *Settings → Provider keys* (it is checked with Anthropic, stored encrypted,
and used only for your requests). Alran Code sends the request to the gateway as always; the gateway
sends it on to Anthropic with your key, and **Anthropic bills your Anthropic account directly**. Ottili
charges nothing for Claude: no token price, no service fee, no hold on your credit. The prices above are
Anthropic's, for comparison; `alran usage` lists the tokens of Claude requests and says "billed by Anthropic".

Werk is unchanged: Ottili bills it from your credit (the welcome credit covers it).

Without a working key the gateway refuses a Claude request before anything is sent:

```
HTTP 403  { "error": { "code": "byok_key_required", "provider": "anthropic", "settings_path": "/settings/provider-keys",
  "message": "Anthropic models run on your own Anthropic API key. Add it under Settings → Provider keys." } }
```

`byok_key_invalid` / `byok_key_rejected` mean Anthropic does not accept the stored key (replace it);
`byok_provider_billing` (HTTP 402) means your Anthropic account has no credit left — add it with Anthropic,
not with Ottili. The CLI only says this in advance (`alran models` shows *needs your Anthropic key*;
`alran config model sonnet` prints what to do) — the gateway decides. `alran exec` and the TUI show what
to do; the account commands (`alran usage`, `alran models`) exit with code 5 on these refusals.

## Commands

| Command | What it does |
|---|---|
| `alran models` | The three Ottili models with price and whether you can use them now (green: yes, yellow: Claude needs your Anthropic key, red: key rejected or no credit left). |
| `alran models --info <model>` | One model in detail. |
| `alran models --set-default <model>` / `alran config model <model>` | The default model (`werk`, `sonnet`, `opus` or a full id). |
| `alran models --third-party` | The bring-your-own-key catalogue (models.dev snapshot). |
| `alran usage` | Credit left (Werk), the state of your Anthropic key, this month per model (Claude: billed by Anthropic). |
| `alran billing` | Plan, payment method summary, last invoice; links to the billing page for changes. |
| `alran exec --model alran/anthropic/claude-sonnet-5.5 "…"` | One run with another model (full key; the short names work in `alran config model` and `alran models`). |

## Bring your own key

Third-party providers (the models.dev catalogue) and custom OpenAI-compatible endpoints stay
available behind `alran models --third-party` and `/provider` in the TUI. Such calls go **directly**
to the provider with a key you configure in Alran Code: Ottili does not see, meter or bill them, and the
free credit does not apply. (Claude through Ottili is different: there the key is held by the gateway, in
your account — see above.) `alran provider add … --api-key-env <VAR>` keeps the key in your environment, so it is not
written to disk at all.

## When the gateway cannot be reached

The call fails (exit code 4) with the gateway URL in the message. Alran Code never falls back to a
direct provider call on its own, because that would bypass metering. Retry, or choose a
bring-your-own-key provider explicitly.
