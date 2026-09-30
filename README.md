# CycloneShield AI

A single-page preparedness dashboard for a synthetic cyclone scenario over Odisha,
India. It combines a seeded scenario (cyclone track, impact zones, infrastructure
assets) with live Open-Meteo weather and elevation, runs a deterministic risk
simulation in the browser, and produces Gemini-backed advisory narrative.

The scenario is **synthetic** and exists for demonstration. It is not an observed
or forecast cyclone, and the advisory output is explicitly labelled as simulated.

## Stack

| Layer | Choice |
| --- | --- |
| Web | React + TypeScript + Vite, Tailwind, Recharts, Leaflet |
| API | Node + Express, SQLite (`better-sqlite3`) |
| Shared | Zod schemas and the risk engine, imported by both |
| Live data | Open-Meteo (weather + elevation), Google Gemini (advisory narrative) |

## Getting started

```bash
npm install
cp .env.example .env   # then fill in GEMINI_API_KEY
npm run dev            # web on :5173, api on :8787
```

The API reads `.env` itself (`--env-file-if-exists`), so no shell exports are
needed. If the file is absent the API still starts and falls back to the
deterministic advisory, which is why an unfilled `.env` looks like a working
demo rather than a misconfiguration.

Quality gates:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Verifying a release candidate

`npm run verify:release` exercises the production build the way a reviewer would:
it builds, boots the API, serves `apps/web/dist` behind a small static server,
drives it with headless Chrome, asserts the behaviours that are easy to break,
and writes the screenshots to `docs/screenshots/`.

```bash
npm run verify:release                       # full run, deterministic advisory
npm run verify:release -- --no-build         # re-run against the current build
npm run verify:release -- --live-gemini      # allow one live provider call
npm run verify:release -- --record           # capture a PNG walkthrough
npm run verify:release -- --out /tmp/shots   # write evidence elsewhere
```

Six suites, 74 checks. It covers the hero contrast and animation safeguards
(reduced motion, viewport pause, 45fps watchdog with a warmup window, mobile
pixel budget), the initial map framing and that `Fit scenario` returns to it,
seeded-scenario freshness wording, the live weather card reporting both its
observation hour and the real upstream fetch time rather than "just now",
agreement between the coverage card and the infrastructure list, recalculation
on control change, and the advisory's non-official framing.

Three suites exist because those behaviours cannot be unit tested:

- **Responsive sweep** loads 360, 390, 768, 1024, 1440 and 1920 and asserts no
  horizontal overflow, a rendered hero, the `h1` inside the viewport, and zero
  console errors at each. The widths between the two end-of-range viewports are
  where layout bugs hide.
- **Tile resilience** fails real tile requests over CDP and asserts the map keeps
  its 20 track paths and 24 markers, shows a notice only on sustained failure,
  stays interactive, and recovers.
- **Hero loop fault containment** makes canvas `stroke()` throw mid-draw and
  asserts the effect stops itself, keeps a clean static frame, and leaves the
  rest of the dashboard interactive.

The **security** suite asserts headers, CORS and rate limiting, and currently
**fails** — see "No security middleware" below. It is committed red on purpose so
the gap stays visible instead of quietly becoming normal.

The run makes **no live provider calls** unless you pass `--live-gemini`; the API
is started with an empty `GEMINI_API_KEY` so the advisory uses the deterministic
fallback, and a check asserts that it did. The driver needs a local Chrome
(`google-chrome`, `chromium`, or `CHROME_PATH`).

## How the risk model works

`packages/shared` owns the scoring: each hazard factor is scored 0-100, banded
into a low → critical severity scale, and weighted into an overall score. The web
app calls `POST /api/simulations` on a 250ms debounce whenever a slider moves, so
the factor chart, score and trace update live. Bar length is a factor's weighted
contribution; bar colour is that factor's own severity band.

## Known limitations and production roadmap

These are deliberate scope decisions made to hit a fixed hackathon timeline, not
oversights. Each is a real production-hardening item that we would address before
running this outside a demo.

### Monolithic client bundle

The web app ships as a single JS chunk (~902 kB raw, ~257 kB gzipped) with no
code splitting. Map, chart and canvas libraries are all pulled into the entry
chunk, so first load pays for code most visitors never scroll to. The fix is
route-level or vendor-level `React.lazy` splitting with the map and chart
deferred until their sections approach the viewport. Deliberately deferred:
splitting touches module boundaries across the app and needs its own visual
regression pass, which did not fit the remaining time.

### Thin React test coverage

The API and the shared risk engine carry the unit coverage, and the pure client
modules that hold the tricky rules are tested directly: `tile-health.ts` (the
threshold and window that decide when to tell the user tiles are failing),
`frame-loop.ts` (scheduling and fault containment), `format.ts` and `geo.ts`.
The error boundary is exercised at the state-machine level.

What is still missing is true rendering coverage. No component test stack
(rendering library, jsdom) is installed, so the boundary test asserts the
fallback and subtree-swap behaviour without mounting a real throwing child, and
`simulation-workspace.tsx` — the debounce/abort lifecycle and advisory error
paths — has no automated interaction test at all. The browser suites in
`verify:release` cover a lot of this at the integration level, but they assert
end-state behaviour, not component boundaries. Deliberately deferred: adding a
rendering stack late in the timeline risked destabilising a working build for
limited gain.

### No security middleware

The API runs with `cors()` wide open, no `helmet` headers, and no authentication or
authorisation on any route. That is acceptable for a single-user demo on a
protected preview deployment, and unacceptable for a real deployment. Required
before production: `helmet`, an explicit CORS origin allowlist, rate limiting on
the Gemini-backed analysis route (which spends money per call), and auth. The API
is currently unauthenticated.

This is asserted, not assumed. The `security` suite in `verify:release` fails
four checks today: no CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options` or
`Referrer-Policy`; `X-Powered-By: Express` still discloses the stack;
`Access-Control-Allow-Origin: *`; and 25 back-to-back calls to the Gemini route
produce zero `429`s. The production build also ships its source map, which hands
a reader the unminified source. Deliberately deferred: hardening that changes
response headers needed its own verification pass.

### `simulation-workspace.tsx` is too large

At 740 lines this single component owns the parameter sliders, the Recharts factor
chart, the score trace, the advisory panel, its fetch/abort lifecycle, and
per-asset expansion state. It is the hardest file in the codebase to change
safely. The right refactor splits it into focused child components with the
simulation request hoisted into a hook. Deliberately deferred: this is a pure
refactor with no user-visible benefit, and a large behavioural surface to
regression-test with the component tests described above not yet in place.

### Simulation history does not survive a restart

Recalculation writes a `simulations` row on every debounced change, and nothing
reads that history back. Retention is enforced in two ways: a periodic sweep
trims rows older than 24 hours, and — less obviously — re-seeding on boot deletes
the scenario row, which cascades through `simulations.scenario_id` and clears the
table outright. So "changes persist as a simulation record" is true only for the
lifetime of a single process. If per-user persistence is ever wanted, the seeder
needs to upsert the scenario instead of delete-and-reinsert, so the cascade stops
firing.

### SQLite on a local filesystem

The database is a single file on local disk, which does not survive a serverless
cold start and cannot be shared between instances. Moving to a hosted database is
a prerequisite for running more than one API instance.

## Failure behaviour

A demo is judged on its worst moment, so the failure paths are deliberate rather
than incidental.

**Map tiles.** A failed base tile used to replace the map with a full-screen
error, which also hid the storm track, the impact zones and every asset marker —
vector overlays that were still drawn, and perfectly readable, underneath it. One
404 from a tile CDN could therefore erase the data the demo exists to show.
Tiles are counted instead: a single failure is silent, and a small
non-blocking notice appears only after eight or more errors inside ten seconds
with no successful load. It never covers the map and does not intercept a pan.

**Live weather.** The card reports the observation's own local hour and the time
Open-Meteo was actually called, e.g. `20:00 IST · fetched 20:31`, rather than
"Just now". The hour is resolved per request against the response's
`utc_offset_seconds`; the fetch time travels with the cached body, so a warm read
reports when the data was fetched, not when it was served. The forecast body is
cached for 20 minutes, so "just now" would have claimed a quarter-hour-old
reading was live.

**Rendering faults.** An error boundary sits at the root, around the map, and
around the hero effect, so a failure costs one section rather than the page. The
fallback offers a Reload button and deliberately shows no stack trace. React
boundaries do not catch errors thrown from a `requestAnimationFrame` callback,
which is most of the hero, so that loop is guarded separately: on a fault it
stops, repaints a clean still frame, and keeps the rest of the dashboard live.

## Data sources

- **Scenario, track, impact zones, infrastructure** — synthetic seed, owned by
  `apps/api/src/db/seed.ts`, re-seeded idempotently on boot.
- **Weather and elevation** — live from Open-Meteo, cached in-process: elevation
  for the process lifetime (terrain does not change) and forecasts for 20 minutes.
  Identical concurrent requests are collapsed into a single upstream call.
- **Advisory narrative** — Gemini, with a deterministic local fallback that is
  always labelled as such in the UI, along with the reason it was used. A live
  Gemini analysis takes roughly 30s, and the free tier allows about 20 requests
  per day per project, so repeated local runs will start returning HTTP 429 and
  degrading to the fallback. That is expected, and the UI says so.

### Illustrative asset data

The seeded infrastructure carries `vulnerabilityScore` and `criticality` values
chosen to make the demo legible, not surveyed. They are not derived from
official Odisha asset registers, district preparedness plans, or any field
assessment, and the seeded values are tuned so the default run shows a spread of
risk categories across the inventory. Treat the exposure ranking as a property of
this demo scenario, not as a statement about the real assets it names.
