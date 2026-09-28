import { describe, expect, it } from "vitest";
import { formatFreshness, formatSourceFreshness } from "./format.js";

const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString();

describe("formatFreshness", () => {
  it("reports a live source in relative terms", () => {
    expect(formatFreshness(minutesAgo(5))).toBe("5 min ago");
    expect(formatFreshness(minutesAgo(1))).toBe("1 min ago");
    expect(formatFreshness(minutesAgo(60))).toBe("1 hour ago");
    expect(formatFreshness(minutesAgo(300))).toBe("5 hours ago");
  });

  it("degrades gracefully on missing or unparseable input", () => {
    expect(formatFreshness(null)).toBe("Unavailable");
    expect(formatFreshness("not-a-timestamp")).toBe("Unavailable");
  });
});

describe("formatSourceFreshness", () => {
  it("never claims a seeded scenario was updated relative to now", () => {
    // The seeded scenario's timestamp is its row creation time, so the same
    // wall-clock offset must not be rendered as a refresh.
    expect(formatSourceFreshness("synthetic-scenario", minutesAgo(5))).toBe(
      "Seeded scenario (static)",
    );
    expect(formatSourceFreshness("static", minutesAgo(9000))).toBe("Seeded scenario (static)");
  });

  it("keeps relative wording for genuinely live sources", () => {
    expect(formatSourceFreshness("live-weather-and-elevation", minutesAgo(5))).toBe("5 min ago");
  });

  it("still reports unavailable when a live source has no timestamp", () => {
    expect(formatSourceFreshness("live-weather-and-elevation", null)).toBe("Unavailable");
  });
});
