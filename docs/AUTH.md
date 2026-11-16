# Sign-in, sessions and companies

Alran Code signs in with the Ottili account. The account lives in the Ottili Platform
(`https://platform.ottili.one`), which runs the login through Keycloak (`https://auth.ottili.one`,
realm `ottili`). The CLI never sees a password and never holds a Keycloak token: it holds a
**Platform session**, the same kind of session the web apps get.

## Commands

| Command | What it does |
|---|---|
| `alran auth login` | Signs in through the browser (below) or with a device code (next section). Prints "Already logged in as …" when a valid session exists; `--force` signs in again; `--device` / `--no-device` choose the sign-in. |
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

## Device sign-in (RFC 8628)

For a terminal where the browser is somewhere else — SSH, a container, a machine without a display —
`alran auth login --device` (the default there; see below) asks the Ottili AI Platform for a code:

```text
$ alran auth login --device

To sign in, open this page in a browser on any device:
  https://ai.ottili.one/device

and enter the code:  BCDF-GHJK

or open it directly:  https://ai.ottili.one/device?user_code=BCDF-GHJK

The code is valid for 10 minutes. Waiting for you to confirm… (Ctrl+C to cancel)
```

1. `POST https://ai.ottili.one/v1/auth/device` → `device_code` (a secret the terminal polls with; only
   its hash is stored), `user_code` (`ABCD-EFGH`, eight consonants, so no word can be spelled and
   nothing is misread), `verification_uri`, `expires_in` (600), `interval` (5).
2. The person opens the page, sees which device asks and confirms. Confirming runs the Platform's
   normal sign-in once more in their own browser (one click with single sign-on). The session that
   creates belongs to the terminal: signing out of the terminal does not sign the browser out.
3. `POST …/v1/auth/device/token` (every `interval` seconds) answers `authorization_pending`,
   `slow_down` (wait the `interval` it names, five seconds more by default), `access_denied`,
   `expired_token`, or the session once. The grant is deleted with it.

Which sign-in runs: `--device` and `--no-device` decide; without either, SSH (`SSH_CONNECTION`,
`SSH_TTY`, `SSH_CLIENT`) or Linux without `DISPLAY` / `WAYLAND_DISPLAY` use the device sign-in;
`ALRAN_LOGIN_FLOW=device|browser` decides for a script. The `/login` of the TUI and `alran login`
follow the same rule.

The confirmation page is a form protected by a token in a cookie and in the form, so another site
cannot confirm a code for a person; the user code is only useful together with a sign-in of the person
who confirms it. The server side is `alran-platform/src/device-routes.mjs` and
`src/core/device-login.mjs`.

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
gateway unreachable (nothing falls back) · 5 the credit does not allow the request, or Claude cannot be paid for (no Anthropic key stored, the key refused, or the Anthropic account without credit).

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `OTTILI_PLATFORM_URL` | `https://platform.ottili.one` | The Platform used for sign-in, companies and projects. |
| `ALRAN_API_BASE` | `https://ai.ottili.one/v1` | The AI Gateway. |
| `ALRAN_API_KEY` | — | An API key that replaces the stored credentials. |
| `ALRAN_DATA_DIR` | `~/.alran` | Where credentials, settings and sessions are stored. |
