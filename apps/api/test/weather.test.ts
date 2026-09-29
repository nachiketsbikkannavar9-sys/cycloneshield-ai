import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, type SqliteDatabase } from "../src/db/database.js";
import { getOpenMeteoCacheStats, resetOpenMeteoCaches } from "../src/providers/open-meteo.js";

let database: SqliteDatabase | null = null;

// The Open-Meteo caches are module scoped so they survive across requests, which
// means they also survive across tests in this file. Each test starts clean.
beforeEach(() => {
  resetOpenMeteoCaches();
});

afterEach(() => {
  database?.close();
  database = null;
  vi.unstubAllGlobals();
});

function stubWeather() {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/elevation") {
      return new Response(JSON.stringify({ elevation: [44] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return weatherResponse();
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function weatherResponse(): Response {
  // A full local day so hour selection has something to select, with values that
  // differ per hour so a wrong index cannot pass by coincidence.
  const hours = Array.from({ length: 24 }, (_, hour) => `2026-09-28T${String(hour).padStart(2, "0")}:00`);
  const series = (base: number, step: number): number[] =>
    hours.map((_, index) => Number((base + index * step).toFixed(1)));

  return new Response(
    JSON.stringify({
      latitude: 20.2961,
      longitude: 85.8245,
      timezone: "Asia/Kolkata",
      timezone_abbreviation: "IST",
      utc_offset_seconds: 19_800,
      elevation: 44,
      hourly: {
        time: hours,
        temperature_2m: series(24, 0.5),
        precipitation: series(0.1, 0.05),
        rain: series(0.1, 0.05),
        wind_speed_10m: series(12, 0.6),
        wind_gusts_10m: series(20, 0.8),
        wind_direction_10m: series(140, 1),
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("current weather route", () => {
  it("returns live source freshness and a normalized current snapshot", async () => {
    vi.useFakeTimers();
    try {
      // Fixed at 13:20 IST so the asserted hour cannot drift with the wall clock.
      vi.setSystemTime(new Date("2026-09-28T07:50:00.000Z"));
      const fetcher = stubWeather();
      database = createDatabase(":memory:");

      const response = await request(createApp(database)).get(
        "/api/weather/current?latitude=20.2961&longitude=85.8245",
      );

      expect(response.status).toBe(200);
      expect(response.body.source.id).toBe("open-meteo");
      expect(response.body.source.status).toBe("live");
      expect(response.body.source.fetchedAt).toEqual(expect.any(String));
      expect(response.body.elevationMeters).toBe(44);
      expect(response.body.current.time).toBe("2026-09-28T13:00");
      expect(response.body.current.windKph).toBe(19.8);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a provider failure without claiming live data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("unavailable", { status: 503 })),
    );
    database = createDatabase(":memory:");

    const response = await request(createApp(database)).get("/api/weather/current");

    expect(response.status).toBe(502);
    expect(response.body.error).toBe("weather-source-unavailable");
    expect(response.body.source.status).toBe("unavailable");
  });

  it("reuses the cached forecast and elevation on a repeat request", async () => {
    const fetcher = stubWeather();
    database = createDatabase(":memory:");
    const app = createApp(database);
    const url = "/api/weather/current?latitude=20.2961&longitude=85.8245";

    const first = await request(app).get(url);
    expect(first.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Second identical request must be served entirely from cache.
    const second = await request(app).get(url);
    expect(second.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Same payload, so a cached read is indistinguishable to the client.
    expect(second.body.current).toEqual(first.body.current);
    expect(second.body.elevationMeters).toBe(first.body.elevationMeters);

    const stats = getOpenMeteoCacheStats();
    expect(stats.forecastHits).toBe(1);
    expect(stats.elevationHits).toBe(1);
    expect(stats.forecastMisses).toBe(1);
    expect(stats.elevationMisses).toBe(1);
  });

  it("collapses identical concurrent requests into one upstream call", async () => {
    const fetcher = stubWeather();
    database = createDatabase(":memory:");
    const app = createApp(database);
    const url = "/api/weather/current?latitude=20.2961&longitude=85.8245";

    const results = await Promise.all([
      request(app).get(url),
      request(app).get(url),
      request(app).get(url),
    ]);

    for (const result of results) expect(result.status).toBe(200);
    // 3 simultaneous page loads must not become 6 upstream calls.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refetches once a cached forecast has expired", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = stubWeather();
      database = createDatabase(":memory:");
      const app = createApp(database);
      const url = "/api/weather/current?latitude=20.2961&longitude=85.8245";

      const first = await request(app).get(url);
      expect(first.status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(2);

      // Elevation is immutable and stays cached; the forecast expires.
      vi.advanceTimersByTime(21 * 60 * 1000);

      const second = await request(app).get(url);
      expect(second.status).toBe(200);
      // Only the forecast refetched.
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(getOpenMeteoCacheStats().elevationHits).toBe(1);
      expect(getOpenMeteoCacheStats().forecastMisses).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the current hour, not midnight, on a fixed clock", async () => {
    vi.useFakeTimers();
    try {
      // 13:20 IST. The fixture spans 00:00-23:00 local, so a hardcoded index 0
      // would report midnight and this assertion would fail.
      vi.setSystemTime(new Date("2026-09-28T07:50:00.000Z"));
      stubWeather();
      database = createDatabase(":memory:");

      const response = await request(createApp(database)).get("/api/weather/current");

      expect(response.status).toBe(200);
      expect(response.body.current.time).toBe("2026-09-28T13:00");
      expect(response.body.current.temperatureC).toBe(30.5);
      expect(response.body.current.windKph).toBe(19.8);
      expect(response.body.utcOffsetSeconds).toBe(19_800);
      expect(response.body.timezoneAbbreviation).toBe("IST");
      // The preview leads with the current hour, not the start of the day.
      expect(response.body.hourlyPreview[0].time).toBe("2026-09-28T13:00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-resolves the hour on a cached read without refetching", async () => {
    vi.useFakeTimers();
    try {
      // 13:50 IST: close enough to the hour boundary that crossing it stays
      // inside the 20 minute forecast cache.
      vi.setSystemTime(new Date("2026-09-28T08:20:00.000Z"));
      const fetcher = stubWeather();
      database = createDatabase(":memory:");
      const app = createApp(database);
      const url = "/api/weather/current?latitude=20.2961&longitude=85.8245";

      const first = await request(app).get(url);
      expect(first.body.current.time).toBe("2026-09-28T13:00");
      expect(fetcher).toHaveBeenCalledTimes(2);

      // 14:05 IST, 15 minutes later. The same cached body is still being served.
      vi.setSystemTime(new Date("2026-09-28T08:35:00.000Z"));
      const second = await request(app).get(url);
      expect(second.status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(2);

      // ...so the hour has to be chosen at read time. If the index were baked in
      // when the cache entry was created, this would still say 13:00.
      expect(second.body.current.time).toBe("2026-09-28T14:00");
      expect(second.body.current.windKph).toBe(20.4);
    } finally {
      vi.useRealTimers();
    }
  });
});
