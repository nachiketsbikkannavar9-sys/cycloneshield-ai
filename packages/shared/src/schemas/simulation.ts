import { z } from "zod";

export const riskCategorySchema = z.enum(["low", "moderate", "high", "critical"]);

export const riskFactorSchema = z.enum([
  "criticality",
  "vulnerability",
  "wind",
  "surge",
  "rainfall",
  "flood",
  "access",
]);

export const factorContributionSchema = z.object({
  factor: riskFactorSchema,
  label: z.string().min(1),
  rawValue: z.number().finite(),
  normalizedScore: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  contribution: z.number().min(0).max(100),
  explanation: z.string().min(1),
});

export const confidenceFactorSchema = z.object({
  name: z.string().min(1),
  points: z.number().min(0).max(100),
  detail: z.string().min(1),
});

export const confidenceSchema = z.object({
  score: z.number().min(0).max(100),
  level: z.enum(["low", "moderate", "high"]),
  factors: z.array(confidenceFactorSchema).min(1),
  explanation: z.string().min(1),
});

export const hazardScoresSchema = z.object({
  wind: z.number().min(0).max(100),
  surge: z.number().min(0).max(100),
  rainfall: z.number().min(0).max(100),
  flood: z.number().min(0).max(100),
  access: z.number().min(0).max(100),
});

export const simulationRequestSchema = z.object({
  scenarioId: z.string().min(1),
  windSpeedKph: z.coerce.number().finite().min(0).max(300),
  rainfallMm: z.coerce.number().finite().min(0).max(1000),
  surgeMeters: z.coerce.number().finite().min(0).max(10),
  trackSpeedMultiplier: z.coerce.number().finite().min(0.5).max(2),
  exposureMultiplier: z.coerce.number().finite().min(0.5).max(2),
});

export const infrastructureRiskSchema = z.object({
  assetId: z.string().min(1),
  assetName: z.string().min(1),
  district: z.string().min(1),
  type: z.string().min(1),
  criticality: z.string().min(1),
  riskScore: z.number().min(0).max(100),
  riskCategory: riskCategorySchema,
  confidence: confidenceSchema,
  factorContributions: z.array(factorContributionSchema).min(1),
  drivers: z.array(z.string().min(1)).min(1),
});

export const simulationResultSchema = z.object({
  calculationVersion: z.literal("risk-engine-v1"),
  scenarioSynthetic: z.literal(true),
  overallScore: z.number().min(0).max(100),
  overallCategory: riskCategorySchema,
  hazardScores: hazardScoresSchema,
  factorContributions: z.array(factorContributionSchema).length(5),
  confidence: confidenceSchema,
  infrastructure: z.array(infrastructureRiskSchema),
});

export const simulationResponseSchema = z.object({
  id: z.string().min(1),
  scenarioId: z.string().min(1),
  parameters: simulationRequestSchema,
  result: simulationResultSchema,
  createdAt: z.string().min(1),
});

export type RiskFactor = z.infer<typeof riskFactorSchema>;
export type FactorContribution = z.infer<typeof factorContributionSchema>;
export type ConfidenceFactor = z.infer<typeof confidenceFactorSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type HazardScores = z.infer<typeof hazardScoresSchema>;
export type SimulationRequest = z.infer<typeof simulationRequestSchema>;
export type InfrastructureRisk = z.infer<typeof infrastructureRiskSchema>;
export type SimulationResult = z.infer<typeof simulationResultSchema>;
export type SimulationResponse = z.infer<typeof simulationResponseSchema>;
