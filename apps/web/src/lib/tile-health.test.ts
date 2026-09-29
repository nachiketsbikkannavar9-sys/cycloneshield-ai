import { describe, expect, it } from "vitest";
import { createTileHealthMonitor, TILE_ERROR_THRESHOLD, TILE_ERROR_WINDOW_MS } from "./tile-health.js";

/** Controllable clock so window behaviour is testable without real waiting. */
function fakeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("createTileHealthMonitor", () => {
  it("stays quiet for a single failed tile", () => {
    const clock = fakeClock();
    const monitor = createTileHealthMonitor({ now: clock.now });

    // One 404 must not cost the user the map: no notice, nothing to dismiss.
    expect(monitor.recordError()).toBe(false);
    expect(monitor.isVisible()).toBe(false);
    expect(monitor.errorCountInWindow()).toBe(1);
  });

  it("stays quiet below the threshold", () => {
    const clock = fakeClock();
    const monitor = createTileHealthMonitor({ now: clock.now });

    for (let i = 0; i < TILE_ERROR_THRESHOLD - 1; i += 1) {
      expect(monitor.recordError()).toBe(false);
    }
    expect(monitor.errorCountInWindow()).toBe(TILE_ERROR_THRESHOLD - 1);
    expect(monitor.isVisible()).toBe(false);
  });

  it("reports sustained failure once the threshold is reached", () => {
    const clock = fakeClock();
    const monitor = createTileHealthMonitor({ now: clock.now });

    for (let i = 0; i < TILE_ERROR_THRESHOLD; i += 1) {
      clock.advance(50);
      monitor.recordError();
    }
    expect(monitor.isVisible()).toBe(true);
  });

  it("counts a burst, not a running total, so slow trickle failures stay quiet", () => {
    const clock = fakeClock();
    const monitor = createTileHealthMonitor({ now: clock.now });

    // Ten errors spread well beyond the window must never trip the notice.
    for (let i = 0; i < 10; i += 1) {
      clock.advance(TILE_ERROR_WINDOW_MS + 1_000);
      monitor.recordError();
    }
    expect(monitor.errorCountInWindow()).toBe(1);
    expect(monitor.isVisible()).toBe(false);
  });

  it("forgets errors that age out of the window", () => {
    const clock = fakeClock();
    const monitor = createTileHealthMonitor({ now: clock.now });

    for (let i = 0; i < TILE_ERROR_THRESHOLD; i += 1) {
      monitor.recordError();
    }
    expect(monitor.isVisible()).toBe(true);

    clock.advance(TILE_ERROR_WINDOW_MS + 1);
    expect(monitor.isVisible()).toBe(false);
    expect(monitor.errorCountInWindow()).toBe(0);
  });

  it("suppresses the notice when a tile still loads inside the window", () => {
    const clock = fakeClock();
    const monitor = createTileHealthMonitor({ now: clock.now });

    for (let i = 0; i < TILE_ERROR_THRESHOLD; i += 1) {
      monitor.recordError();
    }
    expect(monitor.isVisible()).toBe(true);

    // A single arriving tile proves the base map is reachable again.
    clock.advance(100);
    expect(monitor.recordSuccess()).toBe(false);
    expect(monitor.isVisible()).toBe(false);
    expect(monitor.errorCountInWindow()).toBe(0);
  });

  it("keeps the notice hidden when errors are bracketed by a success", () => {
    const clock = fakeClock();
    const monitor = createTileHealthMonitor({ now: clock.now });

    for (let i = 0; i < 20; i += 1) {
      monitor.recordError();
      monitor.recordSuccess();
    }
    expect(monitor.isVisible()).toBe(false);
  });

  it("hides on dismiss and re-reports a fresh burst", () => {
    const clock = fakeClock();
    const monitor = createTileHealthMonitor({ now: clock.now });

    for (let i = 0; i < TILE_ERROR_THRESHOLD; i += 1) {
      monitor.recordError();
    }
    expect(monitor.isVisible()).toBe(true);

    expect(monitor.dismiss()).toBe(false);
    expect(monitor.isVisible()).toBe(false);

    // A brand new burst once tiles have genuinely recovered should be visible
    // again, so the notice cannot be permanently suppressed by one dismissal.
    // The success has to fall out of the window first, since a recent load is
    // exactly what the notice is specified to defer to.
    monitor.recordSuccess();
    clock.advance(TILE_ERROR_WINDOW_MS + 1);
    for (let i = 0; i < TILE_ERROR_THRESHOLD; i += 1) {
      clock.advance(20);
      monitor.recordError();
    }
    expect(monitor.isVisible()).toBe(true);
  });
});
