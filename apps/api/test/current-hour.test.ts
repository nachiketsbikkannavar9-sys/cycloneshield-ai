import { describe, expect, it } from "vitest";
import { selectCurrentHourIndex } from "../src/providers/open-meteo.js";

const KOLKATA_OFFSET = 19_800; // 5h30m, as returned by Open-Meteo for Asia/Kolkata

/** 24 hourly stamps for 2026-09-28, local wall clock, no offset suffix. */
function dayOfHours(date = "2026-09-28"): string[] {
  return Array.from({ length: 24 }, (_, hour) => `${date}T${String(hour).padStart(2, "0")}:00`);
}

describe("selectCurrentHourIndex", () => {
  it("selects the 13:00 entry at 13:20 IST", () => {
    // 13:20 IST is 07:50 UTC. The hourly series is local, so the UTC instant
    // must be shifted before it can be compared with the stamps at all.
    const now = new Date("2026-09-28T07:50:00.000Z");
    expect(selectCurrentHourIndex(dayOfHours(), KOLKATA_OFFSET, now)).toBe(13);
  });

  it("selects the floor hour part-way through an hour", () => {
    const now = new Date("2026-09-28T07:50:00.000Z"); // 13:20 IST
    const times = dayOfHours();
    expect(times[selectCurrentHourIndex(times, KOLKATA_OFFSET, now)]).toBe("2026-09-28T13:00");
  });

  it("is not fooled into the UTC hour, which is six hours off here", () => {
    const now = new Date("2026-09-28T07:50:00.000Z");
    const times = dayOfHours();
    // The naive mistake: matching the UTC prefix picks 07:00, not 13:00.
    const naive = times.findIndex((t) => t.startsWith(now.toISOString().slice(0, 13)));
    expect(naive).toBe(7);
    expect(selectCurrentHourIndex(times, KOLKATA_OFFSET, now)).not.toBe(naive);
  });

  it("handles midnight, where local and UTC diverge most", () => {
    const now = new Date("2026-09-28T18:30:00.000Z"); // 00:00 IST on the 29th
    const times = dayOfHours("2026-09-29");
    expect(selectCurrentHourIndex(times, KOLKATA_OFFSET, now)).toBe(0);
  });

  it("reports the most recent completed hour when now is past the range", () => {
    // A cached forecast from earlier today: every stamp is in the past, so the
    // last available observation is the honest answer, not index 0.
    const now = new Date("2026-09-28T20:00:00.000Z");
    const times = dayOfHours();
    expect(selectCurrentHourIndex(times, KOLKATA_OFFSET, now)).toBe(23);
  });

  it("returns the first entry when the whole range is in the future", () => {
    const now = new Date("2026-09-28T00:00:00.000Z"); // 05:30 IST
    const times = dayOfHours("2026-09-29");
    expect(selectCurrentHourIndex(times, KOLKATA_OFFSET, now)).toBe(0);
  });

  it("crosses midnight into the second forecast day", () => {
    const now = new Date("2026-09-28T20:30:00.000Z"); // 02:00 IST on the 29th
    const times = [...dayOfHours("2026-09-28"), ...dayOfHours("2026-09-29")];
    expect(times[selectCurrentHourIndex(times, KOLKATA_OFFSET, now)]).toBe("2026-09-29T02:00");
  });

  it("works for a negative offset rather than assuming plus-only", () => {
    const times = Array.from(
      { length: 24 },
      (_, hour) => `2026-09-28T${String(hour).padStart(2, "0")}:00`,
    );
    const now = new Date("2026-09-28T16:00:00.000Z"); // 12:00 in UTC-4
    expect(selectCurrentHourIndex(times, -4 * 3600, now)).toBe(12);
  });

  it("returns -1 for an empty series instead of throwing", () => {
    expect(selectCurrentHourIndex([], KOLKATA_OFFSET, new Date())).toBe(-1);
  });
});
