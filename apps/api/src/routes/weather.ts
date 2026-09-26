import { Router } from "express";
import { z } from "zod";
import {
  currentWeatherResponseSchema,
  type SourceStatus,
} from "@cycloneshield/shared";
import { asyncHandler } from "../http/async-handler.js";
import { config } from "../config/env.js";
import { OpenMeteoClient } from "../providers/open-meteo.js";

const weatherQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90).default(20.2961),
  longitude: z.coerce.number().min(-180).max(180).default(85.8245),
});

export function createWeatherRouter(): Router {
  const router = Router();

  router.get(
    "/current",
    asyncHandler(async (request, response) => {
      const query = weatherQuerySchema.safeParse(request.query);
      if (!query.success) {
        response.status(400).json({ error: "invalid-location" });
        return;
      }

      const client = new OpenMeteoClient({
        baseUrl: config.openMeteoBaseUrl,
        timeoutMs: config.openMeteoTimeoutMs,
      });

      try {
        const [forecast, elevation] = await Promise.all([
          client.getForecast({
            latitude: query.data.latitude,
            longitude: query.data.longitude,
            forecastDays: 2,
          }),
          client.getElevation({
            latitude: query.data.latitude,
            longitude: query.data.longitude,
          }),
        ]);
        const source: SourceStatus = {
          id: "open-meteo",
          label: "Open-Meteo",
          kind: "live-weather-and-elevation",
          status: "live",
          fetchedAt: new Date().toISOString(),
          detail:
            "Live forecast and elevation only; no cyclone track, storm surge, or official warning data.",
        };
        const firstIndex = 0;
        const hourlyPreview = forecast.hourly.time.slice(0, 6).map((time, index) => ({
          time,
          temperatureC: forecast.hourly.temperature_2m[index] ?? null,
          windKph: forecast.hourly.wind_speed_10m[index] ?? null,
          precipitationMm: forecast.hourly.precipitation[index] ?? null,
        }));

        const payload = currentWeatherResponseSchema.parse({
          source,
          location: {
            latitude: query.data.latitude,
            longitude: query.data.longitude,
          },
          timezone: forecast.timezone,
          elevationMeters: elevation[0] ?? null,
          current: {
            time: forecast.hourly.time[firstIndex] ?? null,
            temperatureC: forecast.hourly.temperature_2m[firstIndex] ?? null,
            windKph: forecast.hourly.wind_speed_10m[firstIndex] ?? null,
            windGustKph: forecast.hourly.wind_gusts_10m[firstIndex] ?? null,
            precipitationMm: forecast.hourly.precipitation[firstIndex] ?? null,
            windDirectionDeg: forecast.hourly.wind_direction_10m[firstIndex] ?? null,
          },
          hourlyPreview,
        });
        response.json(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Weather source unavailable";
        response.status(502).json({
          error: "weather-source-unavailable",
          message,
          source: {
            id: "open-meteo",
            label: "Open-Meteo",
            kind: "live-weather-and-elevation",
            status: "unavailable",
            fetchedAt: null,
            detail: "The live weather source did not respond.",
          },
        });
      }
    }),
  );

  return router;
}
