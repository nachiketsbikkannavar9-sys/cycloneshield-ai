import { z } from "zod";
import { coordinatesSchema } from "./coordinates.js";

export const hourlyWeatherSchema = z.object({
  time: z.array(z.string()),
  temperature_2m: z.array(z.number()),
  precipitation: z.array(z.number()),
  rain: z.array(z.number()),
  wind_speed_10m: z.array(z.number()),
  wind_gusts_10m: z.array(z.number()),
  wind_direction_10m: z.array(z.number()),
});

export const openMeteoForecastSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  timezone_abbreviation: z.string(),
  /**
   * Seconds to add to UTC to get the wall clock in `timezone`. This is the only
   * reliable way to find "now" in the hourly series: the arrays are in local
   * time, so matching a UTC prefix would land on the wrong hour.
   */
  utc_offset_seconds: z.number(),
  elevation: z.number(),
  hourly: hourlyWeatherSchema,
});

export const weatherSnapshotSchema = z.object({
  source: z.literal("open-meteo"),
  location: coordinatesSchema,
  elevationMeters: z.number().nullable(),
  observedAt: z.string(),
  forecast: hourlyWeatherSchema,
});

/**
 * A parsed forecast plus the moment Open-Meteo was actually called.
 *
 * This is deliberately separate from `openMeteoForecastSchema`, which mirrors
 * the upstream body field for field. The body is cached for 20 minutes, so the
 * time it was fetched cannot be recovered from the body at read time and has to
 * travel alongside it.
 */
export const openMeteoForecastResultSchema = z.object({
  forecast: openMeteoForecastSchema,
  /** ISO timestamp of the upstream call that produced `forecast`. */
  fetchedAt: z.string(),
});

export type HourlyWeather = z.infer<typeof hourlyWeatherSchema>;
export type OpenMeteoForecast = z.infer<typeof openMeteoForecastSchema>;
export type OpenMeteoForecastResult = z.infer<typeof openMeteoForecastResultSchema>;
export type WeatherSnapshot = z.infer<typeof weatherSnapshotSchema>;
