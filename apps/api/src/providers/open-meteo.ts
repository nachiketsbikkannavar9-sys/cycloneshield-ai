import { z } from "zod";
import {
  openMeteoForecastResultSchema,
  type OpenMeteoForecastResult,
} from "@cycloneshield/shared";

const elevationResponseSchema = z.object({
  elevation: z.array(z.number()),
});

export type OpenMeteoRequestOptions = {
  latitude: number;
  longitude: number;
  forecastDays?: number;
  pastDays?: number;
};

export type OpenMeteoClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  /**
   * How long a forecast response may be reused. Defaults to FORECAST_TTL_MS
   * (20 minutes). Set to 0 to disable forecast caching for a client.
   */
  forecastTtlMs?: number;
  /**
   * How long an elevation response may be reused. Defaults to Infinity
   * because terrain elevation does not change. Set to 0 to disable.
   */
  elevationTtlMs?: number;
};

/** Forecasts are reused for 20 minutes: inside the 15-30 minute window that
 *  keeps demo-day traffic off Open-Meteo without showing stale conditions. */
export const FORECAST_TTL_MS = 20 * 60 * 1000;

/** Terrain elevation is immutable, so it is cached for the process lifetime. */
export const ELEVATION_TTL_MS = Number.POSITIVE_INFINITY;

/**
 * Small TTL cache with least-recently-used eviction.
 *
 * Entries are held as raw response text rather than parsed objects so that
 * every caller gets its own freshly parsed value and can never mutate a
 * cached object shared with another request.
 *
 * Each entry also records when it was stored. That timestamp is the moment the
 * upstream call actually returned, which is not the same thing as the moment a
 * later reader receives the cached copy: the difference is the entire TTL.
 * Reporting the read time instead would claim a 20 minute old reading was
 * fetched just now.
 */
type CacheEntry = { value: string; fetchedAt: string; expiresAt: number };

class TtlCache {
  private readonly entries = new Map<string, CacheEntry>();

  public constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  public get(key: string): CacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency so hot keys survive eviction.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  public set(key: string, value: string, fetchedAt: string): void {
    if (this.ttlMs <= 0) return;
    const now = Date.now();
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      // Taken from the caller rather than read here, so the response that
      // triggered this fetch and every later cached read report one identical
      // time. Re-reading the clock on completion would let a slow upstream
      // call make the cold read disagree with the warm ones by its own latency.
      fetchedAt,
      expiresAt: now + this.ttlMs,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  public get size(): number {
    return this.entries.size;
  }

  public clear(): void {
    this.entries.clear();
  }
}

/**
 * The weather route builds a new client per request, so the caches live at
 * module scope to be shared across requests within a process.
 */
const forecastCache = new TtlCache(FORECAST_TTL_MS, 64);
const elevationCache = new TtlCache(ELEVATION_TTL_MS, 256);

/** Collapses identical concurrent requests into a single upstream call, so a
 *  burst of judges loading the page at once triggers one request, not N. The
 *  promise carries the fetch time too, so a collapsed request reports the same
 *  upstream call time as the request that actually made it. */
const inFlight = new Map<string, Promise<CachedFetch>>();

/** An upstream body plus the moment that body was received. */
export type CachedFetch = { body: string; fetchedAt: string };

/**
 * Index of the hourly entry that is "now" for this forecast.
 *
 * Open-Meteo returns `hourly.time` as naive local timestamps (no offset), so
 * the only way to line them up with the current moment is to shift `now` by the
 * response's own `utc_offset_seconds` and compare local wall clocks. Comparing
 * against a UTC ISO prefix instead would land six hours off for Asia/Kolkata,
 * which is the difference between "current wind" and a stale morning reading.
 *
 * Returns the last entry at or before now, so a partially elapsed hour still
 * reports the most recent completed observation, and clamps to the available
 * range rather than returning undefined.
 */
export function selectCurrentHourIndex(
  hourlyTimes: readonly string[],
  utcOffsetSeconds: number,
  now: Date = new Date(),
): number {
  if (hourlyTimes.length === 0) return -1;
  // Shifting the instant is enough; the series itself is already local.
  const localHourKey = new Date(now.getTime() + utcOffsetSeconds * 1000)
    .toISOString()
    .slice(0, 13);
  let index = 0;
  for (let i = 0; i < hourlyTimes.length; i += 1) {
    // ISO-8601 without an offset sorts lexicographically, so this is a
    // chronological comparison rather than an approximate one.
    if (hourlyTimes[i].slice(0, 13) <= localHourKey) index = i;
    else break;
  }
  return index;
}

const cacheStats = { forecastHits: 0, forecastMisses: 0, elevationHits: 0, elevationMisses: 0 };

/** Test/demo helper: drops all cached responses and in-flight bookkeeping. */
export function resetOpenMeteoCaches(): void {
  forecastCache.clear();
  elevationCache.clear();
  inFlight.clear();
  cacheStats.forecastHits = 0;
  cacheStats.forecastMisses = 0;
  cacheStats.elevationHits = 0;
  cacheStats.elevationMisses = 0;
}

export function getOpenMeteoCacheStats() {
  return {
    ...cacheStats,
    forecastEntries: forecastCache.size,
    elevationEntries: elevationCache.size,
    inFlight: inFlight.size,
  };
}

export class OpenMeteoClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly forecastTtlMs: number;
  private readonly elevationTtlMs: number;

  public constructor(options: OpenMeteoClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://api.open-meteo.com";
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.fetcher = options.fetcher ?? fetch;
    this.forecastTtlMs = options.forecastTtlMs ?? FORECAST_TTL_MS;
    this.elevationTtlMs = options.elevationTtlMs ?? ELEVATION_TTL_MS;
  }

  public async getForecast(
    options: OpenMeteoRequestOptions,
  ): Promise<OpenMeteoForecastResult> {
    const url = new URL("/v1/forecast", this.baseUrl);
    url.searchParams.set("latitude", String(options.latitude));
    url.searchParams.set("longitude", String(options.longitude));
    url.searchParams.set("hourly", [
      "temperature_2m",
      "precipitation",
      "rain",
      "wind_speed_10m",
      "wind_gusts_10m",
      "wind_direction_10m",
    ].join(","));
    url.searchParams.set("forecast_days", String(options.forecastDays ?? 7));
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("wind_speed_unit", "kmh");

    const { body, fetchedAt } = await this.fetchCached(
      url,
      this.forecastTtlMs > 0 ? forecastCache : null,
      "forecast",
    );
    return openMeteoForecastResultSchema.parse({
      forecast: JSON.parse(body),
      fetchedAt,
    });
  }

  public async getElevation(
    options: Pick<OpenMeteoRequestOptions, "latitude" | "longitude">,
  ): Promise<number[]> {
    const url = new URL("/v1/elevation", this.baseUrl);
    url.searchParams.set("latitude", String(options.latitude));
    url.searchParams.set("longitude", String(options.longitude));

    const { body } = await this.fetchCached(
      url,
      this.elevationTtlMs > 0 ? elevationCache : null,
      "elevation",
    );
    return elevationResponseSchema.parse(JSON.parse(body)).elevation;
  }

  public async checkAvailability(): Promise<boolean> {
    try {
      await this.getElevation({ latitude: 20.2961, longitude: 85.8245 });
      return true;
    } catch {
      return false;
    }
  }

  private async fetchCached(
    url: URL,
    cache: TtlCache | null,
    kind: "forecast" | "elevation",
  ): Promise<CachedFetch> {
    const key = url.toString();
    if (cache) {
      const hit = cache.get(key);
      if (hit !== undefined) {
        if (kind === "forecast") cacheStats.forecastHits += 1;
        else cacheStats.elevationHits += 1;
        return { body: hit.value, fetchedAt: hit.fetchedAt };
      }
    }
    if (kind === "forecast") cacheStats.forecastMisses += 1;
    else cacheStats.elevationMisses += 1;

    const pending = inFlight.get(key);
    if (pending) return pending;

    // Taken before the request goes out so the timestamp reflects when the
    // upstream call happened, not when it finished.
    const requestedAt = new Date().toISOString();
    const request = this.fetchText(url)
      .then((text) => {
        cache?.set(key, text, requestedAt);
        return { body: text, fetchedAt: requestedAt };
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, request);
    return request;
  }

  private async fetchText(url: URL): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Open-Meteo request failed with status ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Open-Meteo request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function getOpenMeteoDescriptor() {
  return {
    id: "open-meteo",
    label: "Open-Meteo",
    kind: "live-weather-and-elevation" as const,
    documentation: "https://open-meteo.com/en/docs",
    cycloneTrackSupport: false,
    stormSurgeSupport: false,
    officialWarningSupport: false,
  };
}
