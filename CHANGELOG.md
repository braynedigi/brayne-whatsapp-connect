# Changelog

All notable changes to **Brayne WhatsApp Connect** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-23

### Added

- **Plugin-owned admin app** (`manifest.adminApp`), mounted by the host at
  `/admin/plugins/justflows.brayne-whatsapp-connect`: a live overview
  (interaction counters, a mirror of what visitors see, attention banners for
  "no number yet" and "widget turned off") and settings screens — General,
  Message, Appearance, Identity, Business hours, Routing, Leads, Analytics,
  Privacy — matching the Brayne backend design. The app is a static `admin/`
  bundle (no build toolchain) that talks to the host through the admin-bridge
  postMessage protocol and to its own `ctx.http` routes for data; it follows
  the admin's light and dark theme.
- `GET /api/brayne-whatsapp-connect/admin-data` (administrator-only): the
  settings form view with defaults applied, the resolved widget config, the
  aggregate counters, the site time zone, and the site's local date, in one
  `no-store` response.
- `PUT /api/brayne-whatsapp-connect/admin-settings` (administrator-only,
  CSRF-enforced by the host): per-field value validation — digit rules for the
  number, hex-only colours, 24-hour clocks, bounded preset lines, JSON shape
  checks for schedules/holidays/departments/page rules — writing only the keys
  the caller sent, then returning the fresh payload.
- `src/admin-api.ts`: the pure validation and default logic behind those
  routes, with `tests/unit/admin-api.test.ts` covering every rule, plus a test
  pinning the defaults to `justflows.json` so the two cannot drift.
- **Encoded UI copy and payload versioning** (`version: 1`): every widget
  string ships in a locale-resolved `strings` table from the config endpoint
  (explicit setting → browser language → page locale → English), with a
  built-in English fallback in the widget itself. An encoding guard test and a
  workspace `check:encoding` script scan every source and asset for
  UTF-8/Windows-1252 mojibake regressions.
- **Widget language** setting (site language / visitor's browser / explicit
  locale).
- **Split greetings**: `welcomeMessageOpen` and `welcomeMessageClosed` (the
  legacy single welcome message migrates into both), with page-rule overrides.
- **Page rules**: a JSON list of anchored path globs (`/pricing`,
  `/pricing/*`, `?` for one character) that swap the welcome message and quick
  replies on matching pages, with a "test a path" preview in the admin.
- **Agent identity**: name, role, and a photo picked from the site's media
  library (or a same-site/https URL), rendered in the chat header with a live
  preview in the admin.
- **UTM propagation** (opt-in): appends the page's utm_source/medium/campaign
  to the visitor's own prefilled message.
- **Weekly schedules**: multi-window per-day JSON schedules (midnight-crossing
  windows supported) replacing the single open/close/day-set settings, with
  automatic migration, a visual window editor, and a server-computed
  "Closed — opens Mon 09:00" badge.
- **Holidays and exception days**: single dates or from–to ranges whose labels
  drive the closed badge; a holiday overrides the schedule.
- **Custom badge text and colours**: open/closed labels, an extra closed line,
  and hex badge colours applied as CSS custom properties.
- **Departments**: up to five routing chips (name, number, optional icon) that
  swap the `wa.me` target, with aggregate per-department send counters shown
  in the overview.
- **Catalog link**: a "Browse products" chip opening the `wa.me/c/…` catalog.
- **Consent-gated lead form** (opt-in): name, optional interest, and a consent
  checkbox; on Continue the details ride inside the visitor's own WhatsApp
  message and a bare `lead` counter is recorded — nothing is stored by the
  plugin.
- **Analytics upgrades**: day-bucketed counters behind a 14/30-day trend chart
  (pure CSS bars), opt-in page-path counting with a top-pages list, an
  hour-of-day heat map, and a CSV export route
  (`GET /api/brayne-whatsapp-connect/csv`, administrator-only).
- **Automation events**: the plugin registers
  `justflows.brayne-whatsapp-connect.{open,close,preset,send,lead}` as
  subscribable webhook event types and emits them with a JSON-safe,
  personal-data-free payload.
- **Nudge bubble** (opt-in): a teaser above the button after a bounded delay
  (5–300s), once per page load or once per day (the day mode stores a single
  date flag in the visitor's browser — the only storage the widget ever
  writes). Never shown once the visitor has opened the panel themselves.

### Security

- The lead form stores nothing; consent text cannot be cleared while the form
  is on.
- Page counting is opt-in, path-only, and never carries query strings.
- Department counters record only the chip index, never the number.
- The one `localStorage` write is the once-per-day nudge dismissal date,
  disclosed in the setting description and pinned by the widget audit test.

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
