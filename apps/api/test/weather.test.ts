import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, type SqliteDatabase } from "../src/db/database.js";

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
  vi.unstubAllGlobals();
});

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
});
