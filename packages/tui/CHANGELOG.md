# Alran Code Changelog

This changelog covers changes that directly affect Alran Code users: the terminal UI, `alran exec`, the
account commands, models, Plugins, installation and updates.

## 0.2.0 · 2026-11-11

The first release as an Ottili product.

### Added

- Sign in with your Ottili account: `alran auth login`, `status`, `switch-company`, `logout`
  (the session is revoked at the Platform), `alran config company|project|model`.
- Models through the Ottili AI Gateway: Ottili Werk 1.1 (default), Claude Sonnet 5.5 and Claude Opus 5.5.
  `alran models` shows the price and whether your credit covers each model. Free credit covers Werk;
  Claude needs purchased credit (the gateway enforces it).
- `alran usage` and `alran billing`: credit left, spend this month per model, plan and invoices.
- `alran update` and a weekly, non-blocking update hint.
- Plugins keep working when the Plugin registry is not reachable; `alran plugins install` is an alias
  of `alran plugin add`.

### Changed

- The package is called `alran`: `npm install -g alran`.
- The terminal theme uses the Ottili colours.
- User data lives in `~/.alran`; environment variables start with `ALRAN_`.
