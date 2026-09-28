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
