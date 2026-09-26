import { z } from "zod";
import { coordinatesSchema } from "./coordinates.js";
import { infrastructureAssetSchema } from "./infrastructure.js";
import { scenarioSchema } from "./scenario.js";

export const sourceStatusSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["synthetic-scenario", "live-weather-and-elevation", "static"]),
  status: z.enum(["live", "seeded", "stale", "unavailable"]),
  fetchedAt: z.string().nullable(),
  detail: z.string().min(1),
});

export const scenarioDashboardResponseSchema = z.object({
  scenario: scenarioSchema,
  assets: z.array(infrastructureAssetSchema),
  source: sourceStatusSchema,
});

export const currentWeatherResponseSchema = z.object({
  source: sourceStatusSchema,
  location: coordinatesSchema,
  timezone: z.string(),
  elevationMeters: z.number().nullable(),
  current: z.object({
    time: z.string().nullable(),
    temperatureC: z.number().nullable(),
    windKph: z.number().nullable(),
    windGustKph: z.number().nullable(),
    precipitationMm: z.number().nullable(),
    windDirectionDeg: z.number().nullable(),
  }),
  hourlyPreview: z.array(
    z.object({
      time: z.string(),
      temperatureC: z.number().nullable(),
      windKph: z.number().nullable(),
      precipitationMm: z.number().nullable(),
    }),
  ),
});

export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export type ScenarioDashboardResponse = z.infer<typeof scenarioDashboardResponseSchema>;
export type CurrentWeatherResponse = z.infer<typeof currentWeatherResponseSchema>;
