import { Router } from "express";
import { z } from "zod";
import {
  currentWeatherResponseSchema,
  type SourceStatus,
} from "@cycloneshield/shared";
import { asyncHandler } from "../http/async-handler.js";
import { config } from "../config/env.js";
import { OpenMeteoClient, selectCurrentHourIndex } from "../providers/open-meteo.js";

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
        const [forecastResult, elevation] = await Promise.all([
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
          // The upstream call time, carried through the cache rather than
          // stamped here. A cached read must not claim to have fetched now.
          fetchedAt: forecastResult.fetchedAt,
          detail:
            "Live forecast and elevation only; no cyclone track, storm surge, or official warning data.",
        };
        const { forecast } = forecastResult;

        // Resolved per request, never when the cache entry was created: the
        // forecast body is cached for 20 minutes, and "now" has to keep moving
        // while it sits there.
        const currentIndex = selectCurrentHourIndex(
          forecast.hourly.time,
          forecast.utc_offset_seconds,
        );
        const at = (series: readonly (number | null)[]): number | null =>
          currentIndex >= 0 ? (series[currentIndex] ?? null) : null;
        const currentTime = currentIndex >= 0 ? forecast.hourly.time[currentIndex] : null;

        // The preview leads with the current hour rather than midnight, so the
        // first row is the same observation the card above is showing.
        const previewStart = currentIndex >= 0 ? currentIndex : 0;
        const hourlyPreview = forecast.hourly.time.slice(previewStart, previewStart + 6).map((time, offset) => {
          const index = previewStart + offset;
          return {
            time,
            temperatureC: forecast.hourly.temperature_2m[index] ?? null,
            windKph: forecast.hourly.wind_speed_10m[index] ?? null,
            precipitationMm: forecast.hourly.precipitation[index] ?? null,
          };
        });

        const payload = currentWeatherResponseSchema.parse({
          source,
          location: {
            latitude: query.data.latitude,
            longitude: query.data.longitude,
          },
          timezone: forecast.timezone,
          timezoneAbbreviation: forecast.timezone_abbreviation,
          utcOffsetSeconds: forecast.utc_offset_seconds,
          elevationMeters: elevation[0] ?? null,
          current: {
            time: currentTime,
            temperatureC: at(forecast.hourly.temperature_2m),
            windKph: at(forecast.hourly.wind_speed_10m),
            windGustKph: at(forecast.hourly.wind_gusts_10m),
            precipitationMm: at(forecast.hourly.precipitation),
            windDirectionDeg: at(forecast.hourly.wind_direction_10m),
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
