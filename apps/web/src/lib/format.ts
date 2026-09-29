import type { SourceStatus } from "@cycloneshield/shared";

const istDateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

const istDateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

const numberFormatter = new Intl.NumberFormat("en-IN");

export function formatIstDateTime(value: string | null): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${istDateTimeFormatter.format(date)} IST`;
}

export function formatIstDate(value: string | null): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return istDateFormatter.format(date);
}

export function formatFreshness(value: string | null): string {
  if (!value) return "Unavailable";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Unavailable";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

const clockFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata",
});

/**
 * Provenance line for the live weather card: when the reading is from, and when
 * we fetched it.
 *
 * A relative label is the wrong tool here. The forecast is cached for 20
 * minutes, so "just now" would claim an observation up to 20 minutes old is
 * live, and "5 min ago" describes the cache rather than the weather. The two
 * clocks are different things and the card now shows both.
 *
 * `observationTime` is a naive local timestamp from the provider, so it is read
 * as a wall clock directly. `fetchedAt` is a real instant and is converted into
 * the same zone.
 */
export function formatWeatherProvenance(input: {
  observationTime: string | null;
  fetchedAt: string | null;
}): string {
  const { observationTime, fetchedAt } = input;
  if (!observationTime || !fetchedAt) return "Live context unavailable";

  // "2026-09-28T13:00" -> "13:00". Guard the shape so a malformed value cannot
  // render as NaN:NaN in the card.
  const observationClock = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(observationTime);
  if (!observationClock) return "Live context unavailable";
  const observation = `${observationClock[2]} IST`;

  const fetched = new Date(fetchedAt);
  if (Number.isNaN(fetched.getTime())) return observation;
  return `${observation} · fetched ${clockFormatter.format(fetched)}`;
}

/**
 * Freshness wording for a data source.
 *
 * A seeded scenario's `fetchedAt` records when the row was written, not when any
 * weather, hazard or exposure data was last updated, so a relative "5 hours ago"
 * there implies a refresh that never happened and drifts with the wall clock.
 * Only live sources carry a real last-fetched event, so only they get relative
 * wording; everything else states plainly that it is static.
 */
export function formatSourceFreshness(
  kind: SourceStatus["kind"],
  fetchedAt: string | null,
): string {
  if (kind === "synthetic-scenario" || kind === "static") return "Seeded scenario (static)";
  return formatFreshness(fetchedAt);
}

export function formatNumber(value: number | null): string {
  if (value === null) return "—";
  return numberFormatter.format(Math.round(value));
}

export function titleCase(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function getPeakWind(trackPoints: Array<{ windKph: number }>): number {
  return trackPoints.reduce((peak, point) => Math.max(peak, point.windKph), 0);
}
