import { describe, expect, it, vi } from "vitest";
import { OpenMeteoClient } from "../src/providers/open-meteo.js";

function makeResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenMeteoClient", () => {
  it("requests and validates forecast data", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1/forecast");
      expect(url.searchParams.get("latitude")).toBe("20.2961");
      expect(url.searchParams.get("wind_speed_unit")).toBe("kmh");
      return makeResponse({
        latitude: 20.2961,
        longitude: 85.8245,
        timezone: "Asia/Kolkata",
        timezone_abbreviation: "IST",
        utc_offset_seconds: 19_800,
        elevation: 10,
        hourly: {
          time: ["2026-09-25T00:00"],
          temperature_2m: [28.1],
          precipitation: [0.2],
          rain: [0.2],
          wind_speed_10m: [18.4],
          wind_gusts_10m: [31.2],
          wind_direction_10m: [142],
        },
      });
    });
    const client = new OpenMeteoClient({ baseUrl: "https://example.test", fetcher });

    const { forecast, fetchedAt } = await client.getForecast({
      latitude: 20.2961,
      longitude: 85.8245,
      forecastDays: 1,
    });

    expect(forecast.elevation).toBe(10);
    expect(forecast.hourly.wind_gusts_10m[0]).toBe(31.2);
    // The forecast ships with the moment the upstream call happened, so a later
    // cached read can report it without mistaking the read for the fetch.
    expect(Number.isNaN(Date.parse(fetchedAt))).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects non-success responses", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => makeResponse({}, 503));
    const client = new OpenMeteoClient({ baseUrl: "https://example.test", fetcher });

    await expect(
      client.getElevation({ latitude: 20.2961, longitude: 85.8245 }),
    ).rejects.toThrow("status 503");
  });
});
