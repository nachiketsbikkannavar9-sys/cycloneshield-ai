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
  return new Response(
    JSON.stringify({
      latitude: 20.2961,
      longitude: 85.8245,
      timezone: "Asia/Kolkata",
      timezone_abbreviation: "IST",
      elevation: 44,
      hourly: {
        time: ["2026-09-25T00:00", "2026-09-25T01:00"],
        temperature_2m: [28.1, 27.8],
        precipitation: [0.2, 0.1],
        rain: [0.2, 0.1],
        wind_speed_10m: [18.4, 17.2],
        wind_gusts_10m: [31.2, 29.5],
        wind_direction_10m: [142, 145],
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("current weather route", () => {
  it("returns live source freshness and a normalized current snapshot", async () => {
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
    expect(response.body.current.windKph).toBe(18.4);
    expect(fetcher).toHaveBeenCalledTimes(2);
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
});
