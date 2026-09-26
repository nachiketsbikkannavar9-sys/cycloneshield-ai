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

Quality gates:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

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
  always labelled as such in the UI.
