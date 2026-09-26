import { z } from "zod";
import {
  SIMULATED_ADVISORY_DISCLAIMER,
  SIMULATED_SCENARIO_BANNER,
  advisorySchema,
} from "./advisory.js";
import { riskCategorySchema } from "./simulation.js";

export const analysisProviderSchema = z.enum([
  "gemini",
  "deterministic-fallback",
]);
export const analysisFallbackReasonSchema = z.enum([
  "no-api-key",
  "auth-failed",
  "rate-limited",
  "quota-exceeded",
  "model-unavailable",
  "provider-unavailable",
  "bad-request",
  "timeout",
  "network-error",
  "invalid-response",
  "unsafe-response",
  "provider-error",
]);

/**
 * Operator-facing diagnosis for a fallback. Never contains the API key: the
 * service redacts it before building this, and `message` is length-capped.
 */
export const analysisFallbackDetailSchema = z.object({
  httpStatus: z.number().int().nullable(),
  providerCode: z.string().trim().min(1).max(80).nullable(),
  message: z.string().trim().min(1).max(400).nullable(),
});

export const analysisRequestSchema = z.object({
  simulationId: z.string().min(1),
});

export const analysisOutputSchema = z.object({
  summary: z.string().trim().min(1).max(1800),
  keyFindings: z.array(z.string().trim().min(1).max(400)).min(1).max(6),
  priorityAssetIds: z.array(z.string().trim().min(1)).max(6),
  recommendedActions: z.array(z.string().trim().min(1).max(400)).min(1).max(6),
});

export const analysisPriorityAssetSchema = z.object({
  assetId: z.string().min(1),
  assetName: z.string().min(1),
  district: z.string().min(1),
  type: z.string().min(1),
  riskScore: z.number().finite().min(0).max(100),
  riskCategory: riskCategorySchema,
  rationale: z.string().min(1).max(600),
});

export const analysisPayloadSchema = z.object({
  summary: z.string().min(1).max(2500),
  keyFindings: z.array(z.string().min(1).max(500)).min(1).max(6),
  priorityAssets: z.array(analysisPriorityAssetSchema).max(6),
  recommendedActions: z.array(z.string().min(1).max(500)).min(1).max(6),
});

export const analysisResponseSchema = z.object({
  id: z.string().min(1),
  simulationId: z.string().min(1),
  provider: analysisProviderSchema,
  model: z.string().min(1).nullable(),
  fallbackUsed: z.boolean(),
  fallbackReason: analysisFallbackReasonSchema.nullable(),
  fallbackDetail: analysisFallbackDetailSchema.nullable(),
  analysis: analysisPayloadSchema,
  advisory: advisorySchema,
  generatedAt: z.string().min(1),
});

export const analysisBoundary = {
  advisoryDisclaimer: SIMULATED_ADVISORY_DISCLAIMER,
  scenarioBanner: SIMULATED_SCENARIO_BANNER,
} as const;

export type AnalysisProvider = z.infer<typeof analysisProviderSchema>;
export type AnalysisFallbackReason = z.infer<typeof analysisFallbackReasonSchema>;
export type AnalysisFallbackDetail = z.infer<typeof analysisFallbackDetailSchema>;
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
export type AnalysisPriorityAsset = z.infer<typeof analysisPriorityAssetSchema>;
export type AnalysisPayload = z.infer<typeof analysisPayloadSchema>;
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;
