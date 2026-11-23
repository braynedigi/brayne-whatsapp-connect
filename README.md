# Brayne WhatsApp Connect

A floating WhatsApp contact button for JustFlows sites. A visitor taps the
button, sees a welcome message and a few tappable quick replies, and is taken
straight into a WhatsApp chat with the message already written.

Built against JustFlows `>=0.4.0 <0.5.0` with `@justflows/sdk` v0.1.9.

## What it does

- **Floating button** in either bottom corner, three sizes, any hex colour.
- **Welcome message** prefilled into the chat box, plus up to six **preset
  replies** the visitor can tap instead of typing — with split open/closed
  greetings and per-page rules that swap them on matching paths.
- **Business hours** with an Open / Closed badge: multi-window weekly
  schedules, holiday/exception days, custom badge text and colours, and a
  "Closed — opens Mon 09:00" line. Closed still lets the visitor leave a
  message — the button never goes dark on someone who wants to reach you.
- **Departments** — up to five routing chips that send the chat to different
  numbers — and a **catalog chip** to the WhatsApp Business catalog.
- **A consent-gated lead form** (opt-in): name and optional interest ride
  inside the visitor's own WhatsApp message; nothing is stored.
- **A nudge bubble** (opt-in) that invites visitors to chat after a delay,
  once per page load or once per day.
- **Interaction counters** as bare numbers: opens, preset taps, sends, leads,
  per-department sends, day trends, page paths (opt-in) and hour-of-day
  heat — with a CSV export.
- **Automation events** administrators can subscribe to:
  `justflows.brayne-whatsapp-connect.{open,close,preset,send,lead}`.
- **Its own admin screen** in the Justflows admin: a live overview of the
  counters and what visitors see, an Analytics tab with trend charts, and
  tabbed settings (General, Message, Appearance, Identity, Business hours,
  Routing, Leads, Privacy) that save through the plugin's own validated
  route — in the admin's light and dark theme.

## Privacy posture

This is the part worth reading before you install anything.

- **No cookies.** The widget reads and writes none, and the analytics beacon
  sends `credentials: "omit"` so it cannot carry one. The one exception, only
  when the operator chooses the once-per-day nudge, is a single date flag in
  the visitor's browser recording that day's dismissal — nothing else is ever
  written.
- **No identifiers.** No IP address, no phone number, no visitor id, no
  session, no fingerprint. The only thing stored is a count.
- **Page counting is opt-in and path-only** — never a query string.
- **The lead form stores nothing.** Name, interest and message ride inside the
  visitor's own WhatsApp message.
- **No third-party requests.** The widget talks to your own site's
  `/api/brayne-whatsapp-connect/*` endpoints and to `wa.me` when the visitor
  chooses to send. Nothing else.
- **No `innerHTML`.** Every string that arrives from the config is written
  with `textContent`, so a setting cannot inject markup into the page.

The counters live in `ctx.data` under the `analytics` collection and are
incremented with compare-and-set, so two visitors tapping at once do not lose
a count. Clearing the plugin's data resets them.

Turn counting off entirely with **Count widget interactions** in the plugin
settings.

## Settings

| Setting | Default | Notes |
| ------- | ------- | ----- |
| Show the WhatsApp button | on | Hides the widget without uninstalling. |
| WhatsApp number | _(empty)_ | International digits only, e.g. `233201234567`. **Empty hides the button** — a half-typed number is not a contact method. |
| Welcome while open / closed | `Hi! I'd like to know more about your services.` | Prefills the chat box; the closed wording shows when the business is closed. |
| Preset messages | three sample replies | One per line, up to six, 200 chars each. Clear the field for none. |
| Button colour / position / size | `#25d366`, bottom right, medium | Hex only; anything else falls back to WhatsApp green. |
| Widget language | site language | Site language, visitor's browser, or an explicit locale. |
| Page rules | _(empty)_ | JSON list of anchored path globs that swap the welcome and quick replies per page. |
| Show business hours | off | Adds the Open / Closed badge. |
| Weekly schedule | weekdays 09:00–17:00 | JSON list of `{ days, open, close }` windows; closing at or before opening runs past midnight. |
| Holidays and exceptions | _(empty)_ | JSON list of closed days or from–to ranges; the label drives the badge. |
| Open/closed badge text, extra line, colours | defaults | Custom closed wording, a second line, and hex badge colours. |
| Departments | _(empty)_ | Up to five `{ name, number, icon }` chips that route the chat. |
| Catalog link | _(empty)_ | `https://wa.me/c/…` deep link for the "Browse products" chip. |
| Lead form | off | Name + consent before continuing; nothing stored. |
| Nudge bubble | off | Teaser after 5–300s, once per load or once per day. |
| Count widget interactions / pages | on / off | Aggregate counters; page counting is path-only and opt-in. |

A closing time at or before the opening time is treated as a shift that runs
past midnight (22:00 → 02:00), which is how a late-support team describes
itself. Disabled hours or an empty schedule read as **open**: a
misconfiguration must not silently silence the contact button.

## How it is wired

```
brayne-whatsapp-connect/
  justflows.json                      manifest: id, settings, admin nav, admin app, assets
  src/index.ts                        PluginModule: routes + lifecycle
  src/settings.ts                     pure normalisation and hours logic
  src/admin-api.ts                    pure admin defaults + save validation
  src/counters.ts                     CAS counter helpers
  admin/index.html                    the plugin's admin app (no build step)
  admin/app.js                        overview + five settings screens
  admin/app.css                       admin-app styles, light + dark
  admin/locales/en.json               admin catalog (required by the SDK)
  public/widget.js                    the front-end widget (plain JS, no build)
  public/widget.css                   widget styles
  dist/                               tsc output (entry: dist/index.js)
  tests/unit/                         vitest suites
```

The folder lives under `plugins/` in a JustFlows source checkout; the pnpm
workspace includes `plugins/*`, so the filters below resolve there too.

**Endpoints** (namespace `brayne-whatsapp-connect`):

- `GET /api/brayne-whatsapp-connect/config` — the widget's config, `no-store`,
  CORS-enabled so a statically exported page can read it.
- `POST /api/brayne-whatsapp-connect/analytics?event=<open|close|preset|send|lead>`
  — bodyless, `csrf: false`, rate-limited, and refused when the `Origin`
  header is not this site. A send may carry `&dept=<index>`; an open may carry
  `&page=<path>` when page counting is on.
- `GET /api/brayne-whatsapp-connect/admin-data` — administrator-only payload
  for the plugin's own admin app: settings with defaults applied, the resolved
  widget config, the counters, the site time zone, and the site's local date.
- `PUT /api/brayne-whatsapp-connect/admin-settings` — administrator-only save
  (the host enforces the session CSRF token); validates every value, writes
  only the sent keys, and answers with the fresh payload.
- `GET /api/brayne-whatsapp-connect/csv` — administrator-only CSV export of
  every counter row.

The plugin's admin app runs in a same-origin iframe the host mounts for
`manifest.adminApp` routes. It reads the admin theme, locale and catalog URLs
from the host over the admin-bridge `postMessage` protocol, reads the `jf_csrf`
cookie itself, and calls only the plugin's own routes above — nothing is
proxied through core. The host's generic plugin Settings page
(`/admin/plugins/<id>/settings`, generated from `settingsSchema`) keeps
working alongside it and writes the same rows, so the two surfaces can never
disagree about what is stored.

The widget is enqueued on every public page from the manifest's
`assets.scripts` / `assets.styles`, either as `<script defer>` or bundled into
the shared `/jf-plugins.<hash>.js`.

**Why the widget fetches its config instead of inlining it:** `html.head` is a
_synchronous_ filter and cannot `await ctx.settings`. Fetching keeps settings
out of the HTML entirely, and the widget renders nothing if the request fails —
a missing button beats a wrong one.

**Why the analytics beacon has no body:** a body would be `Content-Type:
application/json`, which makes the browser send a CORS preflight. With no body
it stays a _simple request_, so it also works from a statically exported page
served on another origin.

**Why the badge re-fetches every 5 minutes:** the Open / Closed state is
computed on the server at the moment the config is built. Re-reading the
config keeps the badge honest without duplicating `isWithinHours` in the
browser, where the visitor's clock and time zone would disagree with yours.

## Requirements

- JustFlows `>=0.4.0 <0.5.0`
- No database migrations, no schema tables, no secrets, no env vars.

## Develop

From a JustFlows source checkout (the pnpm workspace includes `plugins/*`):

```powershell
pnpm install
pnpm --filter justflows.brayne-whatsapp-connect typecheck
pnpm --filter justflows.brayne-whatsapp-connect test
pnpm --filter justflows.brayne-whatsapp-connect build
```

A source checkout discovers the plugin under `plugins/` when the server
starts. Activate it at **Admin → Extensions → Plugins**, or through the admin
API:

```
GET  /api/plugins
POST /api/plugins/justflows.brayne-whatsapp-connect/activate
```

After changing the plugin's server code, rebuild (`pnpm --filter … build`)
and restart the dev server so the compiled module reloads. The admin app's
static files are re-read without a restart.

## Verify a live install

Against a running instance. The routes marked _admin_ need an administrator
session; anonymous callers get `403`.

```powershell
$origin = "http://localhost:3000"

# Assets are served from the manifest's assets.dir
Invoke-WebRequest "$origin/ext/justflows.brayne-whatsapp-connect/widget.js"
Invoke-WebRequest "$origin/ext/justflows.brayne-whatsapp-connect/widget.css"

# The admin app's own files answer only inside an admin session
Invoke-WebRequest "$origin/ext/justflows.brayne-whatsapp-connect/admin/index.html"

# Config for an anonymous visitor
Invoke-WebRequest "$origin/api/brayne-whatsapp-connect/config"

# Public, rate-limited beacon; the counter shows up in the admin overview
Invoke-WebRequest -Method Post "$origin/api/brayne-whatsapp-connect/analytics?event=open"

# Admin-only: the admin app's data route (sign in first)
# GET $origin/api/brayne-whatsapp-connect/admin-data
```

## Package and install (release path)

A production site installs the plugin through the real upload route: **Admin →
Extensions → Plugins → Upload package**, picking the `.jfpkg` produced by the
packaging flow described in the JustFlows author docs (`docs/README.md` in
the platform repository: manifest, packaging, and the unsigned-package trust
gate for local installs). Activate from the same screen afterwards. Installs
are revisioned per version and digest, so uploading a new build replaces the
older revision and the site keeps running the build whose digest matches.

Nothing in this repository publishes or pushes anything for you.

## Tests

`pnpm --filter justflows.brayne-whatsapp-connect test` runs seven suites:

- `settings.test.ts` — number, colour, clock, schedule, holiday, page-rule,
  department, catalog, lead and nudge normalisation, including
  midnight-crossing shifts, DST-safe next-opening labels and unknown time
  zones.
- `manifest.test.ts` — `justflows.json` and the module manifest stay identical,
  both satisfy `PluginManifestSchema`, declared assets and admin-app files
  exist on disk, and the shipped English catalog is a flat, non-empty map.
- `counters.test.ts` — an in-memory `ctx.data` stands in for the real one, and
  a deliberately lost compare-and-set proves the retry keeps a concurrent
  visitor's increment instead of clobbering it; covers day, hour, page and
  department buckets.
- `admin-api.test.ts` — every rule the plugin's own save route enforces, and
  a pin that keeps `SETTING_DEFAULTS` equal to the manifest's schema defaults.
- `strings.test.ts` — the widget's copy catalog: shape, glyph pins, and the
  locale-resolution chain.
- `encoding-guard.test.ts` — re-reads every source and asset file as bytes and
  fails on mojibake signatures or invalid UTF-8.
- `widget-asset.test.ts` — parses the widget for real, ties its endpoints to
  the server's namespace, and audits it: no `innerHTML`, no cookie, storage
  limited to the once-per-day nudge flag, no `eval`, no `body:` in the beacon,
  and only `https://wa.me/` links out.

## Author

Brayne Smart solutions Corp — <https://braynesmartsolutions.com> —
<support@braynesmartsolutions.com>

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
