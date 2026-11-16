# Model System

The Model System is the model owner of Local Runtime v2. It maintains two groups of capabilities:

- resolution: resolves the process configuration, the authentication context and the Agent model
  references into the `LLMModelConfig` that the Agent runner uses;
- provider management: manages the BYOK provider configuration, the model catalog, connectivity,
  the cache and the OAuth state.

Both groups share the model identity, the request URL, the request headers, the thinking protocol and
one profile configuration port. `initializeModelSystem` creates the single resolver and assembles
resolution and management into one process-level owner. Turn preparation receives that resolver;
after the Session is established, the `ModelProviderApplication` is assembled. Turn admission, the
HTTP DTO mapping, the AgentHost lifecycle and the Session persistence stay with their own
boundaries.

When OpenRouter uses the official `https://openrouter.ai` endpoint, the Model System adds Alran
Code's app attribution headers to real inference, connection test and model discovery requests:
`HTTP-Referer`, `X-OpenRouter-Title` and `X-OpenRouter-Categories`. The Runtime overrides these
product identity fields case-insensitively by header name, so a user's own provider headers cannot
change the attribution identity; other endpoints are unaffected.

The official OpenCode Go HTTPS addresses under `https://opencode.ai/zen/go` and their subpaths
automatically carry `x-opencode-session` and `User-Agent: AlranCode`, without relying on a custom
provider name. Inference requests use the Session ID that the Runtime provides; the same session
keeps it stable across turns, resumption and retries, and different sessions stay isolated from each
other. Titles and compaction follow the resolved headers. Connection tests and model discovery have
no product session and use a separately generated probe ID. These two identity fields override the
static configuration case-insensitively by header name; all other headers keep their value. Plain
Zen `/zen/v1`, proxy addresses and other providers do not get this policy.

## Contents

- `contracts.ts`: the shared configuration read model, the resolution and the provider capability
  contracts;
- `identity.ts`: the single definition of provider ID, origin and API protocol;
- `initialize.ts`: binds the profile configuration port and assembles the process-level Model
  System owner;
- `resolution/`: provider, BYOK, model reference, thinking and credential resolution;
- `catalog/`: the model list, the provider view, the cache and the selection;
- `connectivity/`: the provider request rules, model discovery and the connection test;
- `management/`: provider configuration changes and the Alran Context workflow;
- `codex-oauth.ts`: the Codex OAuth login state;
- `index.ts`: the only public entry point, it only re-exports.

The production code of the other services imports only from `service/model-system/index.ts`. The
current AgentHost preparation consumes the resolution capability; the ModelProvider Controller and
the Session Application consume the management capability of the same owner. V1 keeps the existing
implementation and continues to be retired as planned; this directory does not carry the V1
compatibility duty.

## Codex OAuth login

`CodexOAuthManager.startLogin({ method })` supports `browser` (the default) and `device_code`, and
reuses the vendored Pi OAuth implementation and the host `fetch`. The TUI selects the method,
queries the state and cancels the login through the process-local capability; the HTTP entry point
uses the browser login by default.

The Runtime holds the current login's `loginId`, the authorization URL and the device code in
memory. The expiry of a device authorization uses Unix ms; this temporary data is not written to
the configuration. A repeated request with the same method reuses the current authorization; switch
the method only after cancelling. `cancelLogin(loginId)` cancels only the matching attempt, so an
expired panel cannot affect a new login.

The credentials are first kept in the in-memory storage of this authorization and are written to the
`codex-auth.json` of the current profile only after it is confirmed that nothing was cancelled. A
cancellation and a timeout stop the authorization request and prevent a late result from
configuring a model. The TUI shows the device code page; the account token stays in the Runtime.

## BYOK model discovery

Anthropic Messages providers first request `<base>/v1/models`. Only a 404 or 405 triggers the
fallback to `<base>/models`, then to the origin-level `/models` endpoint. Authentication failures,
rate limits and server errors keep their original status. If every candidate is absent, return
`models_endpoint_missing` so the UI can offer manual model entry. Each attempt has its own request
timeout.

Official OpenCode Go HTTPS endpoints under `https://opencode.ai/zen/go` receive `x-opencode-session`
and `User-Agent: AlranCode` headers. Inference keeps a stable runtime session ID across turns and
retries; connection and discovery probes receive separate generated IDs. These identity headers
override custom values case-insensitively. Other custom headers remain intact, and ordinary Zen
`/zen/v1`, proxies, and other providers are unaffected.

## Codex OAuth model discovery

After the login, `CodexOAuthManager` takes the credentials from the `codex-auth.json` of the
current profile, reuses the refresh mechanism of `AuthStorage` and the host `fetch`, and requests
`https://chatgpt.com/backend-api/codex/models?client_version=0.162.0`.
`connectivity/codex-model-discovery.ts` owns this separate Codex protocol. The compatible version
comes from the verified Codex client protocol and is independent of the Alran Code product version;
the model IDs and the thinking levels are provided by the response. The OAuth resolution reuses the
configurable thinking protocol and maps the remote level as it is to the request; new levels such as
`ultra` do not depend on the static level enumeration of Pi.

Only models with `visibility=list` are imported; ChatGPT OAuth does not filter by
`supported_in_api`. The model name, the thinking options and the input types come from the response.
The default context takes `context_window`, and falls back to `max_context_window` when it is
missing; the remote value is only used to initialise when the remote reports the maximum
configurable window. The output limit keeps the existing configuration, and new models use the
generic default of the Runtime.

The model list is merged by ID, keeps the existing order and appends newly discovered models. Saved
fields have the highest priority; the nested `limit.context`, `limit.output`, `thinking.effortOptions`
and `modalities.input/output` are merged individually. The user's name, the enabled state, the
default model and the other settings are kept as well. Fields that an older version wrote
automatically have no edit history and are kept as the local configuration. The merge reads the
latest values inside the configuration transaction, so a user change made during the refresh is not
overwritten.

The model list is fetched automatically after the first OAuth login; afterwards the user updates it
actively with "fetch model list" in the model settings. The GET OAuth status request when the
settings are opened only reads the state; the POST `/alran/api/provider-auth/openai-codex/models`
performs the model discovery. There is no timed refresh and no time throttle; concurrent discovery
requests share one execution. While the button fetch runs, a loading state is shown, and after a
failure it can be retried immediately. An existing provider configuration is the last successfully
persisted result: a failed refresh keeps the configuration, and a failed first discovery keeps the
login credentials for the connection entry point to retry.

A remote timeout, an error response or an empty list does not replace an existing configuration with
a static list.

After the provider is deleted, the status query keeps the deletion result; deleting the credentials
or the provider during a refresh also abandons the save. After a single model was deleted by hand,
the next remote discovery can add it back; use the model enable switch to keep it hidden.
