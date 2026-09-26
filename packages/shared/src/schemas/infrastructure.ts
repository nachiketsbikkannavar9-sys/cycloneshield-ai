import { z } from "zod";
import { coordinatesSchema } from "./coordinates.js";

export const infrastructureTypeSchema = z.enum([
  "hospital",
  "school",
  "shelter",
  "power",
  "water",
  "road",
  "bridge",
  "communications",
]);

export const criticalitySchema = z.enum(["low", "medium", "high", "critical"]);

export const infrastructureAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: infrastructureTypeSchema,
  district: z.string().min(1),
  location: coordinatesSchema,
  capacity: z.number().nonnegative().nullable(),
  populationServed: z.number().nonnegative().nullable(),
  criticality: criticalitySchema,
  vulnerabilityScore: z.number().min(0).max(1),
  notes: z.string().min(1),
});

export type InfrastructureType = z.infer<typeof infrastructureTypeSchema>;
export type Criticality = z.infer<typeof criticalitySchema>;
export type InfrastructureAsset = z.infer<typeof infrastructureAssetSchema>;
