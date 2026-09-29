# CycloneShield AI

A single-page preparedness dashboard for a synthetic cyclone scenario over Odisha,
India. It combines a seeded scenario (cyclone track, impact zones, infrastructure
assets) with live Open-Meteo weather and elevation, runs a deterministic risk
simulation in the browser, and produces Gemini-backed advisory narrative.

The scenario is **synthetic** and exists for demonstration. It is not an observed
or forecast cyclone, and the advisory output is explicitly labelled as simulated.

Demo video: <link to be added>

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
drives it with headless Chrome at desktop and mobile viewports, asserts the
behaviours that are easy to break, and writes the screenshots to
`docs/screenshots/`.

```bash
npm run verify:release                       # full run, deterministic advisory
npm run verify:release -- --no-build         # re-run against the current build
npm run verify:release -- --live-gemini      # allow one live provider call
npm run verify:release -- --out /tmp/shots   # write evidence elsewhere
```

It covers the hero contrast and animation safeguards (reduced motion, viewport
pause, 45fps watchdog, mobile pixel budget), the initial map framing and that
`Fit scenario` returns to it, seeded-scenario freshness wording, agreement between
the coverage card and the infrastructure list, recalculation on control change,
and the advisory's non-official framing. It exits non-zero on any failure.

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

The web app ships as a single JS chunk (~898 kB raw, ~257 kB gzipped) with no
code splitting. Map, chart and canvas libraries are all pulled into the entry
chunk, so first load pays for code most visitors never scroll to. The fix is
route-level or vendor-level `React.lazy` splitting with the map and chart
deferred until their sections approach the viewport. Deliberately deferred:
splitting touches module boundaries across the app and needs its own visual
regression pass, which did not fit the remaining time.

### No component-level tests

Test coverage is concentrated in the API and the shared risk engine. The React
components have no rendering or interaction tests — the UI was verified manually
and through throwaway browser scripts rather than an automated suite. The highest
value target is `simulation-workspace.tsx`, where the debounce/abort lifecycle and
the advisory error paths are easy to regress silently. Deliberately deferred:
adding a component test stack (rendering library, jsdom setup) late in the
timeline risked destabilising a working build for limited gain.

### No security middleware

The API runs with `cors()` wide open, no `helmet` headers, and no authentication or
authorisation on any route. That is acceptable for a single-user demo on a
protected preview deployment, and unacceptable for a real deployment. Required
before production: `helmet`, an explicit CORS origin allowlist, rate limiting on
the Gemini-backed analysis route (which spends money per call), and auth. The API
is currently unauthenticated. Deliberately deferred: hardening that changes
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
