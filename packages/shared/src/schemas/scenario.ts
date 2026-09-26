import { z } from "zod";
import { coordinatesSchema } from "./coordinates.js";

export const trackPointSchema = z.object({
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  windKph: z.number().nonnegative(),
  pressureHpa: z.number().positive(),
  movementKph: z.number().nonnegative(),
  movementDirectionDeg: z.number().min(0).max(360),
});

export const impactZoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  hazard: z.enum(["wind", "surge", "rainfall", "flood", "access"]),
  severity: z.enum(["low", "moderate", "high", "critical"]),
  coordinates: coordinatesSchema,
  radiusKm: z.number().nonnegative(),
  description: z.string().min(1),
});

/**
 * The hazard values the simulator starts from. Seeded per scenario so the
 * default view is a deliberate, auditable choice rather than a hardcoded
 * constant, and so a scenario can open with a realistic spread of severity
 * across hazards instead of every factor landing in one band.
 */
export const scenarioHazardDefaultsSchema = z.object({
  windSpeedKph: z.number().nonnegative(),
  rainfallMm: z.number().nonnegative(),
  surgeMeters: z.number().nonnegative(),
  trackSpeedMultiplier: z.number().positive(),
  exposureMultiplier: z.number().positive(),
});

export const scenarioSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  summary: z.string().min(1),
  provenance: z.string().min(1),
  isSynthetic: z.literal(true),
  validFrom: z.string().min(1),
  validTo: z.string().min(1),
  landfallAt: z.string().min(1).nullable(),
  defaultHazardValues: scenarioHazardDefaultsSchema,
  trackPoints: z.array(trackPointSchema).min(1),
  impactZones: z.array(impactZoneSchema).min(1),
});

export type TrackPoint = z.infer<typeof trackPointSchema>;
export type ImpactZone = z.infer<typeof impactZoneSchema>;
export type ScenarioHazardDefaults = z.infer<typeof scenarioHazardDefaultsSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
