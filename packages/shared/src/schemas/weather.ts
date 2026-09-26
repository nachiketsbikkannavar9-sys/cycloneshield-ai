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

export type HourlyWeather = z.infer<typeof hourlyWeatherSchema>;
export type OpenMeteoForecast = z.infer<typeof openMeteoForecastSchema>;
export type WeatherSnapshot = z.infer<typeof weatherSnapshotSchema>;
