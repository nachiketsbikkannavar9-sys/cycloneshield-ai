import { describe, expect, it } from "vitest";
import { formatFreshness, formatSourceFreshness, formatWeatherProvenance } from "./format.js";

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

describe("formatWeatherProvenance", () => {
  it("names the observation hour and the fetch time separately", () => {
    expect(
      formatWeatherProvenance({
        observationTime: "2026-09-28T13:00",
        fetchedAt: "2026-09-28T07:42:00.000Z", // 13:12 IST
      }),
    ).toBe("13:00 IST · fetched 13:12");
  });

  it("keeps cached data from being labelled as instant", () => {
    // 19 minutes after the observation. A relative "just now" would be a lie
    // here, so the gap has to be visible in the label itself.
    expect(
      formatWeatherProvenance({
        observationTime: "2026-09-28T13:00",
        fetchedAt: "2026-09-28T08:12:00.000Z", // 13:42 IST
      }),
    ).toBe("13:00 IST · fetched 13:42");
  });

  it("falls back to the observation hour when the fetch time is unusable", () => {
    expect(
      formatWeatherProvenance({ observationTime: "2026-09-28T13:00", fetchedAt: "nonsense" }),
    ).toBe("13:00 IST");
  });

  it("degrades without rendering a broken clock", () => {
    expect(formatWeatherProvenance({ observationTime: null, fetchedAt: null })).toBe(
      "Live context unavailable",
    );
    expect(
      formatWeatherProvenance({ observationTime: "not-a-time", fetchedAt: "2026-09-28T07:42:00.000Z" }),
    ).toBe("Live context unavailable");
  });
});
