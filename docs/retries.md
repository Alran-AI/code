# Retries

Alran Code sends a model request, and when it fails **before the first token** it can try again. Once the model has
started to answer, nothing is retried: a second request would repeat (and bill) work you have already seen.

## What is retried

| Category (`retryOn`) | What it is |
| --- | --- |
| `network` | The connection broke, a DNS or TLS error, a reset |
| `timeout` | The provider did not answer in time |
| `rate_limited` / `tpm_rate_limited` | HTTP 429, or a token-per-minute limit |
| `overloaded` | The provider says it is busy (HTTP 529, "overloaded") |

## What is never retried

An **invalid or revoked key** (401/403), an **empty balance or used-up quota** (402, `insufficient_quota`, also when a
provider reports it as a 429), a **usage limit**, a **content refusal**, and a request the provider rejects as invalid or
too large. Sending the same request again cannot change the answer, may bill it again, and only delays the message you
need. This holds for every provider, including custom and OpenRouter connections, and `retryOn` cannot override it.

## How long it waits

Exponential backoff with jitter: the first wait is `initialDelayMs`, each later wait doubles, up to `maxDelayMs`. When
the provider sends `Retry-After` (or `retry-after-ms`) that value is used instead, capped by `maxDelayMs`. The retries
stop at `maxRetries`, or earlier when the next wait would push the whole retry window past `maxElapsedMs`. Pressing
**Esc** or Ctrl+C during a wait cancels the call at once.

## Settings

In `config.yaml` (default `~/.alran/config.yaml`):

```yaml
retry:
  maxRetries: 3          # retries after the first request; 0 turns retrying off (default 5, at most 20)
  initialDelayMs: 2000   # first wait (default 1000, 100 to 60000)
  maxDelayMs: 20000      # longest single wait (default 30000)
  maxElapsedMs: 60000    # stop when the waits would take longer than this (default 120000)
  retryOn: [network, timeout, rate_limited, overloaded]   # default: all of them
```

Every key is optional. A wrong value does not stop Alran Code: it is corrected, and the correction is reported when the
configuration is read. A change in the file applies to the next request, without a restart.

While a retry is waiting, the activity line says "Retrying model request".
