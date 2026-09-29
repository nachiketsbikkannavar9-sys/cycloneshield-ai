#!/usr/bin/env node
/**
 * Release-candidate verification.
 *
 * Boots the production build (API + built web app behind a static server) and
 * drives it with headless Chrome, then writes the screenshots the release
 * report cites. Everything is local: nothing is deployed, and no provider is
 * called unless you pass --live-gemini.
 *
 *   npm run verify:release
 *   npm run verify:release -- --keep-screenshots-only
 *
 * Options:
 *   --out <dir>        where screenshots are written (default docs/screenshots)
 *   --record <dir>     capture a walkthrough as a frame sequence, for assembling
 *                      a video (default artifacts/recordings). The directory must
 *                      be gitignored; the run aborts if it is not.
 *   --port <n>         preview server port (default 4173)
 *   --api-port <n>     API port (default 8788, off the usual 8787)
 *   --live-gemini      allow the analysis route to call Gemini (off by default,
 *                      so the run is deterministic and free)
 *   --no-build         verify an existing build instead of rebuilding
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchChrome, sleep } from "./browser.mjs";
import { contrastOverRegion, decodePng, parseColor } from "./png.mjs";
import { startPreviewServer } from "./preview-server.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  // A trailing "--record" with no value means "use the default", not "use the
  // next flag's name as a directory".
  if (value === undefined || value.startsWith("--")) return fallback;
  return value;
};
const has = (name) => argv.includes(name);

const OUT_DIR = resolve(REPO_ROOT, flag("--out", "docs/screenshots"));
/**
 * Recordings are review artefacts, not source. A walkthrough is tens of
 * megabytes of binary that nobody reads in a diff, and it churns on every
 * retake, so it must never land in a tracked path.
 */
const RECORD_DIR = resolve(REPO_ROOT, flag("--record", "artifacts/recordings"));

/**
 * Refuses to write recordings anywhere git would track.
 *
 * Checked against the real .gitignore rather than a hardcoded list, so this
 * keeps working if the ignore rules change, and it fails loudly at startup
 * instead of quietly producing a 12MB blob that someone commits next month.
 */
function assertRecordDirIsIgnored() {
  const result = spawnSync("git", ["check-ignore", "-q", RECORD_DIR], {
    cwd: REPO_ROOT,
    stdio: "ignore",
  });
  if (result.status === 0) return;
  throw new Error(
    `Refusing to record into ${RECORD_DIR}: that path is not gitignored. ` +
      "Add it to .gitignore, or pass --record with an ignored directory.",
  );
}

/**
 * Captures a walkthrough as a PNG frame sequence.
 *
 * Deliberately not an .mp4: encoding H.264 needs a muxer, and the brief for this
 * branch forbids new dependencies. Frames plus a manifest assemble into a video
 * with one ffmpeg command, which is printed at the end. The output directory is
 * gitignored, so nothing here can reach a commit.
 */
async function recordFrames(session, directory, driveFrames) {
  mkdirSync(directory, { recursive: true });
  // Clear only this tool's own output, so a re-capture cannot interleave with
  // frames from the previous run.
  for (const entry of readdirSync(directory)) {
    if (entry.startsWith("frame-") || entry === "frames.json") {
      rmSync(join(directory, entry), { force: true });
    }
  }

  const manifest = [];
  session.on(async (message) => {
    if (message.method !== "Page.screencastFrame") return;
    const { data, sessionId, metadata } = message.params;
    const name = `frame-${String(manifest.length).padStart(4, "0")}.png`;
    writeFileSync(join(directory, name), Buffer.from(data, "base64"));
    manifest.push({ file: name, at: metadata?.timestamp ?? null });
    // Chrome will not send the next frame until this frame is acknowledged.
    await session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });

  await session.send("Page.startScreencast", {
    format: "png",
    maxWidth: 1280,
    maxHeight: 800,
    everyNthFrame: 1,
  });
  await driveFrames();
  await session.send("Page.stopScreencast").catch(() => {});
  writeFileSync(join(directory, "frames.json"), JSON.stringify(manifest, null, 2));
  return manifest.length;
}
const PREVIEW_PORT = Number(flag("--port", 4173));
const API_PORT = Number(flag("--api-port", 8788));
const LIVE_GEMINI = has("--live-gemini");
const SKIP_BUILD = has("--no-build");
const HEADLESS_CHROME_PORT = 9333;

const MIN_CONTRAST = 4.5;
const MIN_FPS = 45;
const MIN_TOUCH_TARGET = 44;
const MOBILE_PIXEL_BUDGET = 420_000;

/** The checks. Each returns a list of results; a failure fails the run. */
const results = [];
function check(suite, name, pass, detail = "") {
  results.push({ suite, name, pass });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`  ${mark}  ${name}${detail ? `  ${detail}` : ""}`);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", cwd: REPO_ROOT, ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function waitForHttp(url, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}`);
    await sleep(250);
  }
}

/** Frame identity probe: identical hashes mean the vortex is not repainting. */
const FRAME_PROBE = `
  const cv = document.querySelector('[data-testid="hero-vortex-canvas"]');
  if (!cv) return { missing: true };
  const ctx = cv.getContext('2d');
  const hash = () => {
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let h = 0; for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]) >>> 0;
    return h;
  };
  const a = hash(); await new Promise(r => setTimeout(r, 260)); const b = hash();
  await new Promise(r => setTimeout(r, 260)); const c2 = hash();
  const rect = cv.getBoundingClientRect();
  return {
    state: cv.closest('.hero-vortex')?.dataset?.vortexState,
    animating: !(a === b && b === c2),
    drawn: a !== 0,
    cssWidth: Math.round(rect.width), cssHeight: Math.round(rect.height),
    backing: cv.width * cv.height,
  };`;

const MAP_PROBE = `
  const isMap = (v) => v && typeof v === 'object' && typeof v.getZoom === 'function'
    && typeof v.getSize === 'function' && typeof v.getCenter === 'function';
  const cont = document.querySelector('.leaflet-container');
  if (!cont) return { missing: true };
  const fiberKey = Object.getOwnPropertyNames(cont).find(k => k.startsWith('__reactFiber$'));
  let map = null;
  for (let f = cont[fiberKey], depth = 0; f && depth < 80 && !map; f = f.return, depth += 1) {
    let hook = f.memoizedState, seen = 0;
    while (hook && seen < 40) {
      const value = hook.memoizedState;
      if (isMap(value)) { map = value; break; }
      if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) if (isMap(value[key])) { map = value[key]; break; }
      }
      if (map) break;
      hook = hook.next; seen += 1;
    }
  }
  if (!map) return { missing: true };
  window.__verifyMap = map;
  const b = map.getBounds(), s = map.getSize(), c = map.getCenter();
  return { zoom: map.getZoom(), size: [s.x, s.y], center: [+c.lat.toFixed(5), +c.lng.toFixed(5)],
    bounds: { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() } };`;

/** Great-circle distance in km, for judging how far the camera pulled back. */
function distanceKm([latA, lonA], [latB, lonB]) {
  const R = 6371;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(latB - latA);
  const dLon = rad(lonB - lonA);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(latA)) * Math.cos(rad(latB)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const PURI = [19.813, 85.821];
const PARADIP = [20.264, 86.585];

async function settle(session, selector, timeoutMs = 30_000) {
  await session.evaluate(`
    const deadline = performance.now() + ${timeoutMs};
    while (performance.now() < deadline) {
      if (document.querySelector('${selector}')) return 1;
      await new Promise(r => requestAnimationFrame(r));
    }
    return 0;`);
  // Let tiles, fonts and the first animation frames land before measuring.
  await sleep(4500);
}

async function shoot(session, name, { clipSelector, fullPage = false, maxHeight = 1600 } = {}) {
  const path = join(OUT_DIR, name);
  if (clipSelector) {
    const clip = await session.evaluate(`
      const el = document.querySelector('${clipSelector}');
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY),
               width: Math.round(r.width), height: Math.round(r.height) };`);
    if (!clip) throw new Error(`Cannot clip to ${clipSelector}`);
    // Tall panels (the advisory is one on a phone) make for unreadable
    // evidence, so cap the frame rather than emitting a 6000px strip.
    if (clip.height > maxHeight) clip.height = maxHeight;
    await sleep(1200);
    await session.screenshot(path, { clip });
  } else {
    await session.screenshot(path, { fullPage });
  }
  console.log(`  shot  ${name}`);
  return path;
}

/** Measures the headline against the composited background behind it. */
async function measureHeadlineContrast(session) {
  const info = await session.evaluate(`
    const h = document.querySelector('h1');
    if (!h) return null;
    const r = h.getBoundingClientRect();
    const style = getComputedStyle(h);
    return {
      color: style.color,
      fontSize: parseFloat(style.fontSize),
      weight: style.fontWeight,
      rect: { x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY),
              width: Math.round(r.width), height: Math.round(r.height) },
    };`);
  if (!info) return null;

  const pad = 8;
  const clip = {
    x: Math.max(0, info.rect.x - pad),
    y: Math.max(0, info.rect.y - pad),
    width: info.rect.width + pad * 2,
    height: info.rect.height + pad * 2,
  };

  // Hide only the glyphs: the vortex keeps painting underneath, so the captured
  // background is what the text actually sits on.
  await session.evaluate(`
    const h = document.querySelector('h1');
    h.dataset.verifyVisibility = h.style.visibility;
    h.style.visibility = 'hidden';
    return 1;`);
  await sleep(400);
  const background = await session.screenshot(join(OUT_DIR, ".contrast-background.png"), { clip });
  await session.evaluate(`
    const h = document.querySelector('h1');
    h.style.visibility = h.dataset.verifyVisibility ?? '';
    return 1;`);

  const image = decodePng(readFileSync(background));
  const textRgb = parseColor(info.color);
  return {
    ...info,
    stats: contrastOverRegion(image, textRgb, {
      left: 0,
      top: 0,
      right: image.width,
      bottom: image.height,
    }),
  };
}

/**
 * Polls the vortex until it is (or stops being) animating.
 *
 * A fixed sleep makes this flaky in both directions: resuming is driven by an
 * IntersectionObserver callback, so it lands a frame or two later than a scroll,
 * and that is not a regression. Polling separates "slow" from "never".
 */
async function waitForVortex(session, shouldAnimate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await session.evaluate(FRAME_PROBE);
    if (last.animating === shouldAnimate) return { ok: true, state: last.state };
    if (Date.now() > deadline) return { ok: false, state: last.state, animating: last.animating };
    await sleep(300);
  }
}

async function desktopSuite(url) {
  console.log("\nDesktop 1440x900");
  const session = await launchChrome({ width: 1440, height: 900, port: HEADLESS_CHROME_PORT });
  const consoleErrors = [];
  session.on((message) => {
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      consoleErrors.push(message.params.args?.map((a) => a.value ?? a.description).join(" "));
    }
  });
  try {
    await session.send("Runtime.enable");
    await session.send("Page.enable");
    await session.navigate(url);
    await settle(session, '[data-testid="hero-vortex-canvas"]');

    // --- Hero / vortex ---
    const vortex = await session.evaluate(FRAME_PROBE);
    check("vortex", "renders and animates", vortex.animating && vortex.state === "running",
      `state=${vortex.state} animating=${vortex.animating}`);

    const fps = await session.evaluate(`
      const times = []; let last = performance.now();
      await new Promise(res => { let n = 0;
        const tick = () => { const now = performance.now(); times.push(now - last); last = now;
          if (++n < 120) requestAnimationFrame(tick); else res(); };
        requestAnimationFrame(tick); });
      times.shift();
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      return { mean: +(1000 / mean).toFixed(1),
               worstMs: +Math.max(...times).toFixed(1) };`);
    check("vortex", `holds ${MIN_FPS}fps floor (software raster)`, fps.mean >= MIN_FPS,
      `mean=${fps.mean}fps worstFrame=${fps.worstMs}ms`);

    const contrast = await measureHeadlineContrast(session);
    check("vortex", `headline contrast >= ${MIN_CONTRAST}:1 over the running effect`,
      contrast !== null && contrast.stats.min >= MIN_CONTRAST,
      contrast
        ? `min=${contrast.stats.min.toFixed(2)}:1 p01=${contrast.stats.p01.toFixed(2)}:1 ` +
          `median=${contrast.stats.median.toFixed(2)}:1 colour=${contrast.color} ` +
          `size=${contrast.fontSize}px weight=${contrast.weight}`
        : "no headline found");

    await shoot(session, "hero-desktop.png");

    // --- Reduced motion freezes but keeps the pattern ---
    await session.setReducedMotion(true);
    await session.evaluate("location.reload(); return 1;");
    await sleep(6000);
    const reduced = await session.evaluate(FRAME_PROBE);
    check("vortex", "prefers-reduced-motion freezes on one static frame",
      !reduced.animating && reduced.state === "static" && reduced.drawn,
      `state=${reduced.state} animating=${reduced.animating} patternStillDrawn=${reduced.drawn}`);
    await session.setReducedMotion(false);
    await session.evaluate("location.reload(); return 1;");
    await sleep(6000);

    // --- IntersectionObserver pause ---
    await session.evaluate("window.scrollTo(0, document.body.scrollHeight); return 1;");
    await sleep(800);
    const paused = await waitForVortex(session, false);
    check("vortex", "pauses when scrolled out of view", paused.ok,
      `state=${paused.state} animating=${paused.animating ?? false}`);
    await session.evaluate("window.scrollTo(0, 0); return 1;");
    const resumed = await waitForVortex(session, true);
    check("vortex", "resumes when scrolled back into view", resumed.ok,
      `state=${resumed.state} animating=${resumed.animating ?? true}`);

    // --- Freshness wording ---
    const freshness = await session.evaluate(`
      const body = document.body.innerText;
      return { hasStatic: /Seeded scenario \\(static\\)/.test(body),
               relativeClaims: (body.match(/\\d+ (?:min|hour)s? ago/g) ?? []).slice(0, 8) };`);
    check("provenance", "seeded scenario is labelled static, not 'updated N ago'",      freshness.hasStatic, `relative strings on page: ${JSON.stringify(freshness.relativeClaims)}`);

    // The live weather card must name the observation hour and the fetch time.
    // A relative label here would claim a 20 minute old cached reading is live.
    // Scoped to this card: the simulator legitimately says "last recalculated
    // just now", because that is a real user action, not a cached reading.
    const weather = await session.evaluate(`
      const card = document.querySelector('[data-testid="live-context-card"]');
      const text = card ? card.innerText : '';
      const match = /(\\d{2}:\\d{2}) IST · fetched (\\d{2}:\\d{2})/.exec(text);
      return {
        cardFound: Boolean(card),
        matched: Boolean(match),
        observation: match ? match[1] : null,
        fetched: match ? match[2] : null,
        justNow: /Just now/.test(text),
      };`);
    check("provenance", "live weather names its observation and fetch time",
      weather.matched, weather.matched
        ? `${weather.observation} IST · fetched ${weather.fetched}`
        : `cardFound=${weather.cardFound} no '<HH:MM> IST · fetched <HH:MM>' in the card`);
    check("provenance", "live weather is never labelled 'Just now'", !weather.justNow,
      `justNow=${weather.justNow}`);

    // --- Map framing ---
    await session.evaluate("document.querySelector('.leaflet-container').scrollIntoView({ block: 'center' }); return 1;");
    await sleep(6000);
    const firstView = await session.evaluate(MAP_PROBE);
    if (firstView.missing) {
      check("map", "map instance available for framing check", false);
    } else {
      const widthKm = distanceKm(
        [firstView.bounds.south, firstView.bounds.west],
        [firstView.bounds.south, firstView.bounds.east],
      );
      const heightKm = distanceKm(
        [firstView.bounds.north, firstView.bounds.west],
        [firstView.bounds.south, firstView.bounds.west],
      );
      const inFrame = ([lat, lon]) =>
        lat <= firstView.bounds.north && lat >= firstView.bounds.south &&
        lon <= firstView.bounds.east && lon >= firstView.bounds.west;
      check("map", "first load frames the Odisha coast near-field",
        widthKm < 1000 && inFrame(PURI) && inFrame(PARADIP),
        `zoom=${firstView.zoom} ~${widthKm.toFixed(0)}km x ~${heightKm.toFixed(0)}km ` +
        `Puri=${inFrame(PURI)} Paradip=${inFrame(PARADIP)}`);
      await shoot(session, "map-first-load.png", { clipSelector: ".leaflet-container" });

      await session.evaluate("window.__verifyMap.setView([22.5, 79.0], 11); return 1;");
      await sleep(2500);
      await session.evaluate(`
        const b = [...document.querySelectorAll('button')].find(n => /fit scenario/i.test(n.textContent || ''));
        if (b) b.click();
        return 1;`);
      await sleep(4000);
      const refit = await session.evaluate(MAP_PROBE);
      const sameView =
        !refit.missing && refit.zoom === firstView.zoom &&
        Math.abs(refit.center[0] - firstView.center[0]) < 0.005 &&
        Math.abs(refit.center[1] - firstView.center[1]) < 0.005;
      check("map", "Fit scenario returns to the first-load view", sameView,
        `first zoom=${firstView.zoom} refit zoom=${refit.zoom}`);
    }

    // --- Coverage card must agree with the infrastructure list ---
    // The card is fed by the workspace callback, so this is the check that the
    // two surfaces cannot drift into reporting different numbers.
    await session.evaluate(`
      const el = document.querySelector('[data-testid="simulation-workspace"]');
      if (el) el.scrollIntoView({ block: 'center' });
      return 1;`);
    await sleep(3000);

    const readCoverage = () => session.evaluate(`
      const card = document.querySelector('[data-testid="coverage-elevated-assets"]');
      const rows = [...document.querySelectorAll('[data-testid="infrastructure-row"]')];
      const total = document.querySelector('[data-testid="infrastructure-total"]');
      const elevated = rows.filter(r => /^(high|critical)$/.test(r.dataset.riskCategory || '')).length;
      return {
        cardText: card ? card.textContent.trim() : null,
        card: card && /\\d/.test(card.textContent) ? Number(card.textContent.trim()) : null,
        rows: rows.length,
        elevated,
        totalLabel: total ? total.textContent.replace(/\\s+/g, ' ').trim() : null,
      };`);

    let coverage = await readCoverage();
    if (coverage.card === null || coverage.rows === 0) {
      // No run yet: nudge a control so the workspace recalculates, then re-read.
      await session.evaluate(`
        const slider = document.querySelector('input[type="range"]');
        if (slider) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(slider, String(Math.max(Number(slider.min || 0), Number(slider.value) + 10)));
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return 1;`);
      await sleep(6000);
      coverage = await readCoverage();
    }
    check("dashboard", "coverage card is populated after a run", coverage.card !== null,
      `card="${coverage.cardText}" rows=${coverage.rows} label="${coverage.totalLabel}"`);
    check("dashboard", "coverage count agrees with the infrastructure list",
      coverage.card !== null && coverage.card === coverage.elevated && coverage.rows > 0,
      `card=${coverage.card} high+critical rows=${coverage.elevated} of ${coverage.rows} rendered`);

    const categories = await session.evaluate(`
      return [...new Set([...document.querySelectorAll('[data-testid="infrastructure-row"]')]
        .map(r => r.dataset.riskCategory))].filter(Boolean).sort();`);
    check("dashboard", "modeled risk spans more than one category", categories.length >= 2,
      `categories=${JSON.stringify(categories)}`);

    await shoot(session, "dashboard-coverage.png", { clipSelector: '[data-testid="coverage-snapshot"]' });
    await shoot(session, "infrastructure-list.png", {
      clipSelector: '[data-testid="infrastructure-comparison"]',
    });

    // A silent client-side error is the failure mode that hides behind a
    // plausible-looking screenshot, so surface them rather than swallow them.
    check("console", "no console errors on the page", consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.slice(0, 3).join(" | ") : "none");

    return { consoleErrors };
  } finally {
    await session.close();
  }
}

async function mobileSuite(url) {
  console.log("\nMobile 390x844 @3x");
  const session = await launchChrome({ width: 900, height: 900, port: HEADLESS_CHROME_PORT + 1 });
  const mobileConsoleErrors = [];
  session.on((message) => {
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      mobileConsoleErrors.push(message.params.args?.map((a) => a.value ?? a.description).join(" "));
    }
  });
  try {
    await session.send("Runtime.enable");
    await session.send("Page.enable");
    // Chrome clamps --window-size to ~500px, so a real phone viewport has to be
    // emulated or the narrow-layout checks are meaningless.
    await session.setDevice({ width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await session.setTouch(true);
    await session.navigate(url);
    await settle(session, '[data-testid="hero-vortex-canvas"]');

    const viewport = await session.evaluate(
      "return { innerWidth: window.innerWidth, dpr: window.devicePixelRatio };",
    );
    check("mobile", "viewport is genuinely 390px wide", viewport.innerWidth === 390,
      `innerWidth=${viewport.innerWidth} dpr=${viewport.dpr}`);

    const vortex = await session.evaluate(FRAME_PROBE);
    check("mobile", "vortex animates on mobile", vortex.animating && vortex.state === "running",
      `state=${vortex.state} animating=${vortex.animating}`);
    check("mobile", `backing store within ${MOBILE_PIXEL_BUDGET}px budget`,
      vortex.backing <= MOBILE_PIXEL_BUDGET,
      `${vortex.cssWidth}x${vortex.cssHeight} css -> ${vortex.backing}px`);

    const overflow = await session.evaluate(
      "return document.documentElement.scrollWidth > window.innerWidth + 1;",
    );
    check("mobile", "no horizontal page overflow", overflow === false, `overflow=${overflow}`);

    const smallTargets = await session.evaluate(`
      const offenders = [];
      for (const el of document.querySelectorAll('button, a[href], [role="button"], input, select')) {
        // Leaflet's attribution is a required inline link inside a block of
        // text, which WCAG 2.5.8 exempts from target size; padding it out would
        // also obscure the licence text.
        if (el.closest('.leaflet-control-attribution')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        if (r.height < ${MIN_TOUCH_TARGET} - 0.5 || r.width < ${MIN_TOUCH_TARGET} - 0.5) {
          offenders.push((el.className ? '.' + String(el.className).split(' ')[0] + ' ' : '')
            + (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24)
            + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
        }
      }
      return offenders.slice(0, 8);`);
    check("mobile", `interactive targets >= ${MIN_TOUCH_TARGET}px`, smallTargets.length === 0,
      smallTargets.length ? smallTargets.join(" | ") : "all pass (attribution exempt)");

    await shoot(session, "hero-mobile.png");

    // --- Simulator: factor chart + advisory framing ---
    await session.evaluate(`
      const el = document.querySelector('[data-testid="factor-chart"]');
      if (el) el.scrollIntoView({ block: 'center' });
      return 1;`);
    await sleep(2500);

    // The bar colours follow each factor's own 0-100 value, so the default run
    // should span the palette rather than collapsing to one colour.
    const factors = await session.evaluate(`
      const bars = [...document.querySelectorAll('[data-testid="factor-chart"] .recharts-bar-rectangle path, [data-testid="factor-chart"] .recharts-rectangle')];
      const fills = [...new Set(bars.map(b => b.getAttribute('fill')).filter(Boolean))];
      const labels = [...document.querySelectorAll('[data-testid="factor-chart"] .recharts-yaxis text')].map(t => t.textContent.trim());
      return { bars: bars.length, fills, labels };`);
    check("simulator", "factor chart renders one bar per factor", factors.bars >= 3,
      `bars=${factors.bars} labels=${JSON.stringify(factors.labels)}`);
    check("simulator", "factor chart uses more than one colour", factors.fills.length >= 2,
      `fills=${JSON.stringify(factors.fills)}`);

    // Changing a control must actually re-run the model, not just repaint.
    const readScore = () => session.evaluate(`
      const el = document.querySelector('[data-testid="overall-risk-score"]');
      const ws = document.querySelector('[data-testid="simulation-workspace"]');
      return { score: el ? el.textContent.trim() : null,
               recalculating: ws ? ws.dataset.recalculating : null };`);
    const before = await readScore();
    await session.evaluate(`
      const slider = document.querySelector('input[type="range"]');
      if (!slider) return 0;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(slider, String(Math.max(Number(slider.min || 0), Number(slider.value) + 15)));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;`);
    await sleep(6000);
    const after = await readScore();
    check("simulator", "moving a control recalculates the model",
      before.score !== null && after.score !== before.score,
      `score ${before.score} -> ${after.score} (recalculating=${after.recalculating})`);

    const categories = await session.evaluate(`
      return [...new Set([...document.querySelectorAll('[data-testid="infrastructure-row"]')]
        .map(r => r.dataset.riskCategory))].filter(Boolean).sort();`);
    check("simulator", "modeled risk spans more than one category", categories.length >= 2,
      `categories=${JSON.stringify(categories)}`);

    await shoot(session, "simulator-factor-chart.png", { clipSelector: '[data-testid="factor-chart"]' });

    // Generating an advisory is a local, deterministic provider call unless
    // --live-gemini was passed, so this costs nothing and needs no key.
    await session.evaluate(`
      const b = document.querySelector('[data-testid="generate-advisory"]');
      if (b) b.click();
      return 1;`);
    await sleep(6000);

    const advisory = await session.evaluate(`
      const panel = document.querySelector('[data-testid="advisory-panel"]');
      const fallback = document.querySelector('[data-testid="advisory-fallback-detail"]');
      const empty = document.querySelector('[data-testid="advisory-empty"]');
      const scope = panel ? panel.innerText : document.body.innerText;
      return {
        rendered: Boolean(panel),
        stillEmpty: Boolean(empty),
        fallbackReason: fallback ? fallback.innerText.replace(/\\s+/g, ' ').trim() : null,
        labelled: /SIMULATED ADVISORY|DETERMINISTIC FALLBACK|NOT AN OFFICIAL WARNING/i.test(scope),
        // The product promise is that the advisory never reads as a real forecast.
        disclaims: /not a real-world forecast|before taking any real-world action/i.test(scope),
        // And it must not instruct anyone to act in the real world.
        instructs: /\\b(evacuate|shelter immediately|seek shelter|must evacuate|take cover now)\\b/i
          .test(scope),
      };`);
    check("advisory", "advisory panel renders generated content", advisory.rendered,
      advisory.rendered ? "generated" : `emptyState=${advisory.stillEmpty}`);
    check("advisory", "advisory keeps its non-official labels", advisory.labelled,
      `labels=${advisory.labelled}`);
    check("advisory", "advisory disclaims real-world use", advisory.disclaims,
      `disclaims=${advisory.disclaims}`);
    check("advisory", "advisory issues no real-world instructions", !advisory.instructs,
      `imperativeInstructions=${advisory.instructs}`);
    if (!LIVE_GEMINI) {
      // The panel humanises the reason code, so match the rendered wording too.
      check("advisory", "no live provider call was made",
        /no api key|no-api-key/i.test(advisory.fallbackReason ?? ""),
        advisory.fallbackReason ?? "no fallback detail rendered");
    }

    await shoot(session, "advisory.png", { clipSelector: '[data-testid="advisory-panel"]' });

    // Same rule as desktop, on the viewport that matters most for a demo: a
    // console error on a phone is invisible in a desktop screenshot.
    check("console", "no console errors on mobile", mobileConsoleErrors.length === 0,
      mobileConsoleErrors.length ? mobileConsoleErrors.slice(0, 3).join(" | ") : "none");
  } finally {
    await session.close();
  }
}

/**
 * Base-tile failure must degrade the map, not disable it.
 *
 * The track, impact zones and asset markers are vector overlays, so they survive
 * a dead tile server. Leaflet gives no way to unit test that, so the tiles are
 * failed for real here via CDP request interception: exactly one failure first
 * (must stay silent), then a sustained outage (must notice without hiding the
 * overlays), then recovery (must clear the notice).
 */
async function tileResilienceSuite(url) {
  console.log("\nTile resilience");
  const session = await launchChrome({ width: 1440, height: 900, port: 9333 });

  const overlays = `
    const q = (s) => document.querySelector(s);
    return {
      notice: Boolean(q('[data-testid="map-tile-notice"]')),
      trackPaths: document.querySelectorAll('.leaflet-overlay-pane path').length,
      markers: document.querySelectorAll('.leaflet-marker-icon, .leaflet-interactive').length,
      zoneFills: document.querySelectorAll('.leaflet-overlay-pane path[fill], .leaflet-overlay-pane canvas').length,
      tiles: document.querySelectorAll('.leaflet-tile').length,
      zoomControls: document.querySelectorAll('.leaflet-control-zoom a').length,
      mapInteractive: Boolean(q('.leaflet-container') && q('.leaflet-pane')),
    };`;

  // failNext tiles fail, everything else is let through untouched.
  let failNext = 0;
  session.on((message) => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const isTile = /tile\.openstreetmap\.org/.test(request.url);
    const verdict =
      isTile && failNext > 0 ? session.send("Fetch.failRequest", { requestId, errorReason: "Failed" })
        : session.send("Fetch.continueRequest", { requestId });
    if (isTile && failNext > 0) failNext -= 1;
    verdict.catch(() => {});
  });

  try {
    await session.send("Network.enable");
    // Without this, a reloaded page serves tiles straight from Chrome's HTTP
    // cache: no request is ever made, so nothing is intercepted and the outage
    // under test silently does not happen.
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
    await session.send("Fetch.enable", {
      patterns: [{ urlPattern: "*.tile.openstreetmap.org/*" }],
    });
    await session.navigate(url);
    await sleep(7000);

    const healthy = await session.evaluate(overlays);
    check("tiles", "map overlays render over a healthy base", healthy.trackPaths > 0 && healthy.markers > 0,
      `trackPaths=${healthy.trackPaths} markers=${healthy.markers}`);
    check("tiles", "no notice while tiles are loading", !healthy.notice, `notice=${healthy.notice}`);

    // A single 404 is routine: it must not cost the user the map.
    failNext = 1;
    await session.evaluate(`document.querySelector('.leaflet-control-zoom-in').click(); return 1;`);
    await sleep(3500);
    const single = await session.evaluate(overlays);
    check("tiles", "one failed tile shows no notice", !single.notice,
      `failedTiles=1 noticed=${single.notice}`);
    check("tiles", "one failed tile leaves the map intact",
      single.trackPaths > 0 && single.markers > 0 && single.mapInteractive,
      `trackPaths=${single.trackPaths} markers=${single.markers} interactive=${single.mapInteractive}`);

    // Now a sustained outage. Panning/zooming re-uses tiles Leaflet has already
    // fetched, which would fire no errors at all, so the page is reloaded with
    // every tile request failing: the "base tiles unavailable" case.
    failNext = 500;
    await session.navigate(url);
    await sleep(9000);
    const outage = await session.evaluate(overlays);
    check("tiles", "sustained tile failure raises a notice", outage.notice,
      `allTilesFailed notice=${outage.notice}`);
    check("tiles", "overlays stay visible during a tile outage",
      outage.trackPaths > 0 && outage.markers > 0,
      `trackPaths=${outage.trackPaths} markers=${outage.markers} tiles=${outage.tiles}`);
    check("tiles", "map stays interactive during a tile outage",
      outage.mapInteractive && outage.zoomControls > 0,
      `interactive=${outage.mapInteractive} zoomControls=${outage.zoomControls}`);
    await shoot(session, "map-tile-outage.png", { clipSelector: ".leaflet-container" });

    // Recovery: let tiles through again and reload.
    failNext = 0;
    await session.navigate(url);
    await sleep(9000);
    const recovered = await session.evaluate(overlays);
    check("tiles", "notice clears once tiles load again", !recovered.notice,
      `notice=${recovered.notice} tilesLoaded=${recovered.tiles}`);
  } finally {
    await session.send("Fetch.disable").catch(() => {});
    await session.close().catch(() => {});
  }
}

/**
 * A fault inside the hero's animation loop is invisible to React: it throws
 * inside a requestAnimationFrame callback, which no error boundary sees. This
 * forces the real thing by making the canvas context throw mid-draw, and checks
 * that the effect dies alone, holding its last frame, with the rest of the
 * dashboard still working.
 */
async function heroFaultSuite(url) {
  console.log("\nHero loop fault containment");
  const session = await launchChrome({ width: 1440, height: 900, port: 9334 });

  try {
    await session.navigate(url);
    await sleep(7000);

    const before = await session.evaluate(`
      const c = document.querySelector('.hero-vortex canvas');
      return { state: document.querySelector('.hero-vortex')?.dataset.vortexState ?? null,
               painted: c ? c.width > 0 : false };`);
    check("hero-fault", "hero is animating before the fault", before.state === "running",
      `state=${before.state}`);

    // Break the drawing context the hero depends on. This is the closest a test
    // gets to a real lost context / GPU process reset.
    await session.evaluate(`
      window.__vortexFaults = 0;
      const original = CanvasRenderingContext2D.prototype.stroke;
      CanvasRenderingContext2D.prototype.stroke = function (...args) {
        window.__vortexFaults += 1;
        throw new Error('simulated lost drawing context');
      };
      window.__vortexRestore = () => { CanvasRenderingContext2D.prototype.stroke = original; };
      return 1;`);
    await sleep(2500);

    const after = await session.evaluate(`
      const c = document.querySelector('.hero-vortex canvas');
      window.__vortexRestore?.();
      const snapshot = c?.toDataURL('image/png') ?? '';
      return {
        state: document.querySelector('.hero-vortex')?.dataset.vortexState ?? null,
        faultsThrown: window.__vortexFaults ?? 0,
        // A non-trivial PNG means the last good frame is still on the canvas.
        staticFrameKept: snapshot.length > 5000,
        heroHeading: document.querySelector('h1')?.innerText ?? '',
        tiles: document.querySelectorAll('.leaflet-tile').length,
        coverage: document.querySelector('[data-testid="coverage-snapshot"]')?.innerText ?? '',
        infraRows: document.querySelectorAll('[data-testid="infrastructure-row"]').length,
        boundaryPage: Boolean(document.querySelector('[data-testid="error-boundary-page"]')),
      };`);

    check("hero-fault", "the loop actually faulted", after.faultsThrown > 0,
      `throws=${after.faultsThrown}`);
    check("hero-fault", "the faulting effect stops itself", after.state !== "running",
      `state=${after.state}`);
    check("hero-fault", "the last static frame is kept", after.staticFrameKept,
      `staticFrameKept=${after.staticFrameKept}`);
    // The containment claim: one dead effect must not take the page with it.
    check("hero-fault", "the rest of the dashboard still renders", after.heroHeading.length > 0
      && after.tiles > 0 && after.infraRows > 0,
      `tiles=${after.tiles} rows=${after.infraRows} boundaryPage=${after.boundaryPage}`);
    check("hero-fault", "no page-level error boundary was triggered", !after.boundaryPage,
      `pageBoundary=${after.boundaryPage}`);

    // And the dashboard is still interactive, not merely present.
    const scoreBefore = await session.evaluate(`
      const el = [...document.querySelectorAll('input[type=range]')][0];
      return el ? el.value : null;`);
    await session.evaluate(`
      const el = [...document.querySelectorAll('input[type=range]')][0];
      if (!el) return 0;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(Number(el.value) + 40));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;`);
    await sleep(2500);
    const stillWorks = await session.evaluate(`
      const el = [...document.querySelectorAll('input[type=range]')][0];
      const score = document.querySelector('[data-testid="infrastructure-total"]')?.innerText ?? '';
      return { value: el ? el.value : null, summary: score };`);
    check("hero-fault", "controls still recalculate after the hero fault",
      stillWorks.value !== scoreBefore || stillWorks.summary.length > 0,
      `slider=${scoreBefore}->${stillWorks.value} list="${stillWorks.summary}"`);
    await shoot(session, "hero-fault-contained.png", { clipSelector: ".hero-vortex" });
  } finally {
    await session.close().catch(() => {});
  }
}

async function main() {
  console.log("CycloneShield release-candidate verification");
  console.log(`  repo        ${REPO_ROOT}`);
  console.log(`  screenshots ${OUT_DIR}`);
  console.log(`  Gemini      ${LIVE_GEMINI ? "LIVE (up to provider quota)" : "off (deterministic fallback)"}`);

  // Enforced on every run, not only when recording, so the "never into a tracked
  // path" guarantee cannot be lost by someone changing the default later.
  assertRecordDirIsIgnored();

  if (!SKIP_BUILD) {
    console.log("\nBuilding production bundles...");
    await run("npm", ["run", "build"]);
  } else {
    console.log("\nSkipping build (--no-build)");
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log("\nStarting API...");
  const apiEnv = { ...process.env, PORT: String(API_PORT) };
  if (!LIVE_GEMINI) {
    // An inherited key would make the run non-deterministic and billable; the
    // advisory falls back to the labelled deterministic provider instead.
    // This must be an empty string, not a deletion: `node --env-file` fills in
    // any variable that is *unset*, so deleting the key here would let .env put
    // the real one back and the run would quietly make live provider calls.
    apiEnv.GEMINI_API_KEY = "";
    apiEnv.GEMINI_API_KEY_FILE = "";
  }
  const api = spawn(
    process.execPath,
    ["--env-file-if-exists=./.env", "apps/api/dist/server.js"],
    { cwd: REPO_ROOT, env: apiEnv, stdio: "inherit" },
  );
  await waitForHttp(`http://127.0.0.1:${API_PORT}/health`, { what: "API health" });

  const preview = await startPreviewServer({
    apiOrigin: `http://127.0.0.1:${API_PORT}`,
    port: PREVIEW_PORT,
  });
  console.log(`Preview serving ${preview.url}`);

  try {
    if (has("--record")) {
      // One pass over the dashboard purely for the walkthrough, so the frames
      // show a human-sized tour rather than the harness poking at one element.
      console.log("\nRecording walkthrough");
      const session = await launchChrome({ width: 1280, height: 800, port: 9335 });
      try {
        await session.navigate(preview.url);
        await sleep(6000);
        const count = await recordFrames(session, RECORD_DIR, async () => {
          // Scroll the length of the page, pausing on each section.
          for (const step of [0, 1, 2, 3, 4]) {
            await session.evaluate(
              `window.scrollTo(0, document.body.scrollHeight * ${step} / 4); return 1;`,
            );
            await sleep(2500);
          }
        });
        console.log(`  ${count} frames -> ${RECORD_DIR}`);
        console.log(
          `  assemble with: ffmpeg -framerate 6 -i ${RECORD_DIR}/frame-%04d.png -pix_fmt yuv420p walkthrough.mp4`,
        );
      } finally {
        await session.close().catch(() => {});
      }
    }
    await desktopSuite(preview.url);
    await mobileSuite(preview.url);
    await tileResilienceSuite(preview.url);
    await heroFaultSuite(preview.url);
  } finally {
    await preview.close();
    api.kill("SIGKILL");
  }

  rmSync(join(OUT_DIR, ".contrast-background.png"), { force: true });

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed` +
      ` across ${new Set(results.map((r) => r.suite)).size} suites`,
  );
  if (failed.length) {
    console.log("\nFailed:");
    for (const f of failed) console.log(`  - [${f.suite}] ${f.name}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nScreenshots in ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(`\nVerification aborted: ${error.message}`);
  process.exitCode = 1;
});
