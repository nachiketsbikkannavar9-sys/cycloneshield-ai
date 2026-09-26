import { useEffect, useRef } from "react";

/**
 * Decorative hero backdrop: a slow cyclone funnel drawn as thin streamlines
 * on a canvas. It is a fixed particle set that is re-projected each frame
 * under a rotating flow field, so cost stays flat regardless of elapsed time.
 *
 * Deliberately hand-rolled rather than pulled from an animation library: it
 * keeps the bundle small and makes the effect trivial to delete. The component
 * is entirely self-contained -- remove its usage in App.tsx and the CSS block
 * and nothing else changes.
 *
 * Behaviour notes:
 * - Never starts before the hero has painted and become interactive.
 * - Stops entirely when the hero scrolls out of view or the tab is hidden.
 * - `prefers-reduced-motion` freezes on one static frame; the pattern stays.
 * - Falls back to that same static frame if it cannot hold a smooth frame rate
 *   on a small viewport, rather than shipping a stutter.
 */

type Palette = { r: number; g: number; b: number };

const WHITE: Palette = { r: 226, g: 240, b: 252 };
const CYAN: Palette = { r: 103, g: 232, b: 249 };

/** One full revolution every 30s -- inside the 20-40s "slow motion" brief. */
const SECONDS_PER_REVOLUTION = 30;

/** Perspective squash: a side-on view of a cone, not a flat circle. */
const PERSPECTIVE_SQUASH = 0.44;

/** Helical twist per unit of the vertical parameter. */
const SWIRL_TURNS = 0.62;

/** Samples along each streamline. */
const SEGMENTS_DESKTOP = 30;
const SEGMENTS_MOBILE = 14;

/**
 * Depth quantisation for line colour; see the note in the draw loop. Every
 * band change is a separate stroke() rasterisation, so small viewports use
 * fewer bands -- at these opacities the difference is not perceptible.
 */
const DEPTH_BANDS_DESKTOP = 4;
const DEPTH_BANDS_MOBILE = 2;

/** Line counts. Mobile keeps the shape but drops roughly half the geometry. */
const LINE_BUDGET = { desktop: 46, tablet: 30, mobile: 12 } as const;

/**
 * Ceiling on canvas backing-store pixels. Fill rate, not line count, is what
 * costs on a high-DPR phone: a 350x804 hero at 1.75x is ~860k pixels to clear
 * and re-stroke every frame. Capping total pixels keeps per-frame cost flat
 * across device pixel ratios instead of scaling with them.
 */
const MAX_CANVAS_PIXELS = { small: 420_000, large: 2_600_000 } as const;

/** Below this sustained rate, prefer a still frame over a stutter. */
const MIN_ACCEPTABLE_FPS = 45;

/** Consecutive bad windows required before freezing (guards against one hitch). */
const BAD_WINDOWS_BEFORE_FREEZE = 2;
const WINDOW_FRAMES = 60;

type Line = {
  /** Start/end of the vertical parameter, so the funnel gets its three bands. */
  v0: number;
  v1: number;
  /** Base bearing around the axis. */
  phase: number;
  /** Radial scale, so the funnel has depth rather than being a single shell. */
  shell: number;
  alpha: number;
  tint: number;
};

function mixColor(from: Palette, to: Palette, t: number): Palette {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

function buildLines(count: number): Line[] {
  const lines: Line[] = [];
  for (let i = 0; i < count; i += 1) {
    const share = i / count;
    // Band mix: the spine of the funnel, the wide circular flow field beneath
    // it, and the upper inflow.
    let v0: number;
    let v1: number;
    if (share < 0.45) {
      v0 = 0.04;
      v1 = 0.96;
    } else if (share < 0.8) {
      v0 = 0.6;
      v1 = 1;
    } else {
      v0 = 0;
      v1 = 0.4;
    }
    lines.push({
      v0,
      v1,
      phase: (i * 2.399963) % (Math.PI * 2),
      shell: 0.58 + ((i * 37) % 43) / 100,
      // Deterministic jitter keeps the field from looking mechanically even.
      alpha: 0.1 + ((i * 53) % 37) / 340,
      tint: ((i * 29) % 100) / 100,
    });
  }
  return lines;
}

function lineCountFor(width: number): number {
  if (width < 640) return LINE_BUDGET.mobile;
  if (width < 1024) return LINE_BUDGET.tablet;
  return LINE_BUDGET.desktop;
}

/**
 * Falloff that keeps streamlines off the headline itself.
 *
 * The guard tracks the real copy column rather than a guessed box: on wide
 * screens that column is the left half, and on narrow ones it is the upper
 * block. A guessed full-width guard on mobile was dimming the entire effect to
 * the point of invisibility, so the lower flow field now stays clear.
 */
type GuardRect = { x: number; y: number; w: number; h: number };

function measureGuard(canvas: HTMLCanvasElement): GuardRect {
  const box = canvas.getBoundingClientRect();
  const section = canvas.closest("section#dashboard");
  const headline = section?.querySelector("h1");
  const column = headline?.parentElement;
  if (!box.width || !column) {
    return { x: 0, y: box.height * 0.2, w: box.width, h: box.height * 0.5 };
  }
  const rect = column.getBoundingClientRect();
  const margin = Math.min(box.width, box.height) * 0.1;
  return {
    x: rect.left - box.left - margin,
    y: rect.top - box.top - margin,
    w: rect.width + margin * 2,
    h: rect.height + margin * 2,
  };
}

function legibilityGuard(x: number, y: number, guard: GuardRect, spread: number): number {
  const dx = Math.max(guard.x - x, 0, x - (guard.x + guard.w));
  const dy = Math.max(guard.y - y, 0, y - (guard.y + guard.h));
  const distance = Math.hypot(dx, dy);
  const soft = Math.min(1, distance / spread);
  // Floor keeps the pattern present behind the text (and pairs with the CSS
  // scrim) instead of erasing it.
  return 0.5 + 0.5 * soft * soft;
}

export function HeroVortex() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = reducedMotionQuery.matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let lines: Line[] = [];
    let segments = SEGMENTS_DESKTOP;
    let guard: GuardRect = { x: 0, y: 0, w: 0, h: 0 };
    let guardSpread = 1;
    let depthBands = DEPTH_BANDS_DESKTOP;
    let rotation = 0;
    let lastTime = 0;
    let running = false;
    let visible = true;
    let rafId = 0;
    let windowFrames = 0;
    let windowAccum = 0;
    let badWindows = 0;
    let settled = false;

    // The funnel sits slightly right of centre on wide screens so the headline
    // column stays clear, and centres on narrow ones.
    const axisX = () => (width >= 1024 ? width * 0.66 : width * 0.5);
    const radius = () => Math.min(width * (width >= 1024 ? 0.3 : 0.46), height * 0.56);
    const top = () => height * 0.04;
    const span = () => height * 0.92;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rect.width));
      const nextHeight = Math.max(1, Math.round(rect.height));
      const isSmall = nextWidth < 640;
      // Clamp DPR so the backing store stays under the pixel budget.
      const ceiling = isSmall ? MAX_CANVAS_PIXELS.small : MAX_CANVAS_PIXELS.large;
      const budgeted = Math.sqrt(ceiling / (nextWidth * nextHeight));
      const nextDpr = Math.max(
        1,
        Math.min(window.devicePixelRatio || 1, isSmall ? 1.75 : 2, budgeted),
      );
      if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      lines = buildLines(lineCountFor(width));
      segments = isSmall ? SEGMENTS_MOBILE : SEGMENTS_DESKTOP;
      depthBands = isSmall ? DEPTH_BANDS_MOBILE : DEPTH_BANDS_DESKTOP;
      guard = measureGuard(canvas);
      guardSpread = Math.min(width, height) * 0.3;
      if (!running) draw();
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      if (width === 0 || height === 0) return;

      const cx = axisX();
      const R = radius();
      const yTop = top();
      const ySpan = span();

      context.lineCap = "round";
      context.lineJoin = "round";

      for (const line of lines) {
        const color = mixColor(WHITE, CYAN, line.tint);
        let band = -1;
        let started = false;

        for (let step = 0; step <= segments; step += 1) {
          const t = step / segments;
          const v = line.v0 + (line.v1 - line.v0) * t;
          // Pinched in the middle, flaring at both ends: the funnel profile.
          const pinch = 0.2 + 0.8 * Math.pow(2 * v - 1, 2);
          const r = R * pinch * line.shell;
          // Differential rotation -- outer shells lead, so it reads as a vortex
          // rather than a rigid spinning wheel.
          const angle =
            line.phase +
            rotation * (0.42 + 0.58 * (r / Math.max(R, 1))) +
            SWIRL_TURNS * Math.PI * 2 * v;
          const x = cx + r * Math.cos(angle) * PERSPECTIVE_SQUASH;
          const y = yTop + ySpan * v;
          const depth = (Math.sin(angle) + 1) / 2;

          /*
           * Depth is quantised into a few bands rather than a continuous
           * alpha. Every band change costs a full stroke() rasterisation, so a
           * fine-grained ramp meant dozens of extra passes per frame; four
           * bands look the same at these opacities and are far cheaper.
           */
          const nextBand = Math.min(depthBands - 1, Math.floor(depth * depthBands));
          if (nextBand !== band) {
            if (started) context.stroke();
            band = nextBand;
            context.beginPath();
            const shade = 0.45 + 0.55 * ((band + 0.5) / depthBands);
            const alpha =
              line.alpha *
              shade *
              legibilityGuard(x, y, guard, guardSpread) *
              (0.55 + 0.45 * pinch);
            context.strokeStyle = `rgba(${Math.round(color.r)}, ${Math.round(
              color.g,
            )}, ${Math.round(color.b)}, ${alpha.toFixed(3)})`;
            context.lineWidth = line.shell > 0.8 ? 1.1 : 0.85;
            started = false;
          }
          if (!started) {
            context.moveTo(x, y);
            started = true;
          } else {
            context.lineTo(x, y);
          }
        }
        if (started) context.stroke();
      }
    };

    const stop = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      running = false;
      lastTime = 0;
    };

    const tick = (time: number) => {
      rafId = requestAnimationFrame(tick);
      const delta = lastTime === 0 ? 0 : (time - lastTime) / 1000;
      lastTime = time;
      if (delta > 0) {
        rotation += (Math.PI * 2 * delta) / SECONDS_PER_REVOLUTION;
        // Continuous watchdog rather than a one-shot probe: a page that starts
        // smooth and degrades later (throttling, background work) must still
        // fall back. Two consecutive bad windows avoid reacting to one hitch.
        if (!settled) {
          windowFrames += 1;
          windowAccum += delta;
          if (windowFrames >= WINDOW_FRAMES) {
            const fps = windowFrames / windowAccum;
            windowFrames = 0;
            windowAccum = 0;
            if (fps < MIN_ACCEPTABLE_FPS) {
              badWindows += 1;
              if (badWindows >= BAD_WINDOWS_BEFORE_FREEZE) {
                settled = true;
                stop();
                // Documented fallback: keep the static funnel rather than ship
                // a stutter on a device that cannot hold a smooth rate.
                canvas
                  .closest(".hero-vortex")
                  ?.setAttribute("data-vortex-state", "static-fallback");
                return;
              }
            } else {
              badWindows = 0;
            }
          }
        }
      }
      draw();
    };

    const start = () => {
      if (running || reducedMotion || !visible || document.hidden) return;
      if (width === 0) resize();
      running = true;
      lastTime = 0;
      canvas.closest(".hero-vortex")?.setAttribute("data-vortex-state", "running");
      rafId = requestAnimationFrame(tick);
    };

    const syncMotion = () => {
      if (reducedMotion) {
        stop();
        draw();
        canvas.closest(".hero-vortex")?.setAttribute("data-vortex-state", "static");
        return;
      }
      if (settled) return;
      start();
    };

    resize();
    draw();
    canvas.closest(".hero-vortex")?.setAttribute(
      "data-vortex-state",
      reducedMotion ? "static" : "pending",
    );

    const observer = new ResizeObserver(() => {
      resize();
      if (!running) draw();
    });
    observer.observe(canvas);

    // Confine the work to when the hero is actually on screen.
    const intersection = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) syncMotion();
        else stop();
      },
      { threshold: 0 },
    );
    intersection.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stop();
      else syncMotion();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onMotionChange = () => {
      reducedMotion = reducedMotionQuery.matches;
      if (reducedMotion) {
        settled = true;
        stop();
      } else {
        settled = false;
        windowFrames = 0;
        windowAccum = 0;
        badWindows = 0;
        rotation = 0;
      }
      syncMotion();
    };
    reducedMotionQuery.addEventListener("change", onMotionChange);

    // Hold off the first frame until the hero has actually painted and the
    // rest of the dashboard is interactive, so nothing here competes with
    // first paint.
    const startTimer = window.setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(start));
    }, 120);

    return () => {
      window.clearTimeout(startTimer);
      stop();
      observer.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reducedMotionQuery.removeEventListener("change", onMotionChange);
    };
  }, []);

  return (
    <div className="hero-vortex" aria-hidden="true" data-testid="hero-vortex">
      <canvas ref={canvasRef} className="hero-vortex__canvas" data-testid="hero-vortex-canvas" />
      <div className="hero-vortex__scrim" />
    </div>
  );
}
