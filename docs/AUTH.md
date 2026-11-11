# Sign-in, sessions and companies

Alran Code signs in with the Ottili account. The account lives in the Ottili Platform
(`https://platform.ottili.one`), which runs the login through Keycloak (`https://auth.ottili.one`,
realm `ottili`). The CLI never sees a password and never holds a Keycloak token: it holds a
**Platform session**, the same kind of session the web apps get.

## Commands

| Command | What it does |
|---|---|
| `alran auth login` | Signs in through the browser (below). Prints "Already logged in as …" when a valid session exists; `--force` signs in again. |
| `alran auth login --api-key` | Asks for an Ottili API key (`sk-ottili-…`, minted at `https://ai.ottili.one/api-keys`) instead. Use it on machines without a browser. |
| `alran auth status` | Who is signed in, which company, which project. |
| `alran auth switch-company` | Lists the companies of the account and switches (`POST /v2/auth/company`). |
| `alran auth logout` (also `alran logout`) | Revokes the session at the Platform (`DELETE /v2/auth/sessions/{id}`), then removes the local credentials. Works offline too: the local files go, and the CLI says the revocation could not be sent. |
| `alran config company` / `alran config project [<id>]` | Show or set the company and the project (shared Platform projects, `GET /v2/projects`). |

## The browser sign-in

1. The CLI opens a loopback listener on `127.0.0.1` and sends the browser to
   `GET /v2/auth/oidc/login?return_to=http://127.0.0.1:<port>/callback` on the Platform.
2. The Platform runs the Keycloak authorization-code flow as its own (confidential) client, creates
   a session and redirects the browser to the loopback URL with a one-time `ottili_handoff` code.
3. The CLI redeems the code server-to-server at `POST /v2/auth/sessions/handoff` and receives the
   session id, company id and subject id.
4. The session is written to `~/.alran/auth/platform/<env>/platform-session.json`, mode `0600`, in a
   `0700` directory. `<env>` is `prod` for `https://platform.ottili.one`.

The loopback redirect is the native-app pattern of RFC 8252. The password is entered only in the
browser, on the Platform's Keycloak page.

## Device flow (RFC 8628) — not yet available

The task asks for the device-authorization flow ("open `https://<platform>/device` and enter
ABCD-EFGH"). Keycloak supports it (`/protocol/openid-connect/auth/device` is advertised), but the CLI
does not hold Keycloak tokens: the Platform is the OIDC client and issues its own sessions. Device
flow therefore needs three Platform routes, which do not exist yet:

- `POST /v2/auth/device` → `{ device_code, user_code, verification_uri, expires_in, interval }`
- a page at `verification_uri` where a signed-in person enters `user_code` and confirms the device
- `POST /v2/auth/device/token` (`device_code`) → `authorization_pending` | `slow_down` |
  `expired_token` | the session handoff the loopback flow already returns

Until they exist, `alran auth login --api-key` is the way to sign in on a machine without a browser
(SSH, containers). TODO(platform): device authorization for CLI clients.

## Session lifetime and refresh

The session is server-side and opaque; its lifetime is the Platform's. There is no refresh token
on the client: when the Platform or the gateway answers 401, the account commands exit with code 2
("Run `alran auth login`") and the TUI shows "Login required". Sign-out revokes the session on the
server, so a copied session file stops working at once.

## Which credential a model call uses

Model calls go to the Ottili AI Gateway with `Authorization: Bearer <session id>` plus
`x-ottili-company` and `x-ottili-project`, so usage is attributed to the selected company and
project. With `--api-key` the key is the credential and its own project applies. `ALRAN_API_KEY`
overrides both for scripted use.

## Exit codes

0 success · 1 error · 2 sign-in needed · 3 rate limited (the reset time is printed) · 4 Platform or
gateway unreachable (nothing falls back) · 5 the credit does not allow the request.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `OTTILI_PLATFORM_URL` | `https://platform.ottili.one` | The Platform used for sign-in, companies and projects. |
| `ALRAN_API_BASE` | `https://ai.ottili.one/v1` | The AI Gateway. |
| `ALRAN_API_KEY` | — | An API key that replaces the stored credentials. |
| `ALRAN_DATA_DIR` | `~/.alran` | Where credentials, settings and sessions are stored. |
