# Updates

Alran Code installs new versions silently in the background and makes them active on the next
start, in the style of Claude Code. After an update lands, the next start prints exactly one line:

```
Updated to 1.1.1 – 2 features, 1 fix. Changelog: https://github.com/Alran-AI/code/releases/tag/v1.1.1
```

The feature and fix counts come from the `CHANGELOG.md` shipped with the installed version
(`feat:`/`fix:` entries, or the `### Added`/`### Fixed` sections); when no counts can be derived the
line shows only the version and the link.

## How the background check works

- On start, Alran Code looks up the `latest` version of the official `alran` package in the npm
  registry — **the only network request it ever makes for updates**. No telemetry, no user data, no
  project data leaves the machine.
- The result (timestamp and version) is cached in the data directory (`~/.alran/auto-update.json`)
  and the check runs at most once every six hours.
- The check runs in the background with a three-second timeout; it never delays startup, never fails
  loudly, and prints nothing while offline.
- When a newer version exists and Alran Code was installed through `npm install -g alran`, it is
  installed in the background with `npm install -g alran@<version>` from the official registry only.
  The installed version is verified against the requested one and `alran --version` is run as a
  health check; on any failure the previous version stays, the reason goes to
  `~/.alran/auto-update.log` (never the terminal), and the next attempt waits 24 hours.
- The running binary is never replaced mid-session: the new version is used from the next start.
- Auto-update never runs while another Alran process holds `~/.alran/task.lock` or while another
  update holds `~/.alran/auto-update.lock`; it tries again on the next start.

## Install methods

Auto-update applies to **npm global installs** only. For every other installation method (npx,
source/`alran-dev`, Homebrew, other package managers, the managed installer) Alran Code prints the
hint at most once a day:

```
Update available: 1.1.1. Run: yarn global add alran@1.1.1 --registry https://registry.npmjs.org/ …
```

## Channels

| Channel | Meaning |
|---|---|
| `latest` (default) | The npm `latest` dist-tag. |
| `stable` | The newest release published at least three days ago; a few days behind `latest`. |

Choose the channel in `~/.alran/config.yaml` (`autoUpdateChannel: "stable"`) or with
`ALRAN_UPDATE_CHANNEL=stable` (the environment wins).

## Opting out

- `autoUpdate: false` in `~/.alran/config.yaml`, or `ALRAN_DISABLE_AUTOUPDATE=1`: no background
  installation, only the once-a-day hint above.
- `ALRAN_OFFLINE=1`: no network call at all; only cached results are used.

## Updating by hand

```sh
alran update              # check and install now (asks first on a terminal)
alran update --check      # only check the channel; print the result
alran update --channel stable   # run the command on a channel
```

`alran update` without flags keeps the existing behavior for managed installs, npm prefix installs
and every supported package manager. See `docs/UPDATE_PIPELINE.md` for the full pipeline.
