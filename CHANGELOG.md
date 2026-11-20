# Changelog

All notable changes to **Brayne WhatsApp Connect** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Plugin-owned admin app** (`manifest.adminApp`), mounted by the host at
  `/admin/plugins/justflows.brayne-whatsapp-connect`: a live overview
  (interaction counters, a mirror of what visitors see, attention banners for
  "no number yet" and "widget turned off") and five settings screens —
  General, Message, Appearance, Business hours, Privacy — matching the Brayne
  backend design. The app is a static `admin/` bundle (no build toolchain)
  that talks to the host through the admin-bridge postMessage protocol and to
  its own `ctx.http` routes for data; it follows the admin's light and dark
  theme.
- `GET /api/brayne-whatsapp-connect/admin-data` (administrator-only): the
  settings form view with defaults applied, the resolved widget config, the
  aggregate counters, and the site time zone, in one `no-store` response.
- `PUT /api/brayne-whatsapp-connect/admin-settings` (administrator-only,
  CSRF-enforced by the host): per-field value validation — digit rules for the
  number, hex-only colour, 24-hour clocks, bounded preset lines — writing only
  the keys the caller sent, then returning the fresh payload.
- `src/admin-api.ts`: the pure validation and default logic behind those
  routes, with `tests/unit/admin-api.test.ts` covering every rule, plus a test
  pinning the defaults to `justflows.json` so the two cannot drift.

## [0.1.0] - 2026-11-18

First release.

### Added

- Floating WhatsApp contact button on every public page, driven by the
  manifest's `assets.scripts` / `assets.styles`.
- Button corner (bottom right / bottom left), size (48 / 56 / 64px) and hex
  colour, all applied through `--jwa-*` custom properties on one root element.
- Welcome message prefilled into the chat box.
- Up to six preset replies as tappable quick replies above the message box.
- Business hours with an Open / Closed badge, an IANA time zone, three day
  sets, and support for shifts that cross midnight. Closed still allows a
  message to be written and sent.
- Aggregate interaction counters (`open`, `close`, `preset`, `send`) stored in
  `ctx.data` and incremented with compare-and-set so concurrent taps are not
  lost.
- `GET /api/brayne-whatsapp-connect/config` and
  `POST /api/brayne-whatsapp-connect/analytics`, both CORS-enabled and served
  under the neutral `brayne-whatsapp-connect` API namespace (the legacy
  `/ext/<plugin id>/…` alias also resolves).
- Admin settings page and sidebar entry under the WhatsApp Connect section.
- Four vitest suites: settings normalisation, manifest parity, counter
  concurrency, and a static audit of the shipped widget.

### Security

- No cookie, storage or identifier is read or written by the widget, and the
  analytics beacon sends `credentials: "omit"`.
- The analytics route is `csrf: false` and rate-limited, and refuses any
  request whose `Origin` header is not this site.
- The beacon carries no request body, keeping it a CORS simple request with no
  preflight.
- Every value from the config is written with `textContent`; the widget never
  uses `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or
  `new Function`.
- `buttonColor` is validated against a hex literal before it reaches an inline
  style; the WhatsApp number must be 7–15 digits before it reaches a `wa.me`
  link.
