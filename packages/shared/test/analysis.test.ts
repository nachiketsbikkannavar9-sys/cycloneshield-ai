import { describe, expect, it } from "vitest";
import {
  analysisOutputSchema,
  analysisResponseSchema,
  SIMULATED_ADVISORY_DISCLAIMER,
} from "../src/index.js";

describe("analysis contracts", () => {
  it("requires the structured Gemini fields", () => {
    const result = analysisOutputSchema.safeParse({
      summary: "Exercise summary",
      keyFindings: ["One finding"],
      priorityAssetIds: ["asset-1"],
      recommendedActions: ["Review readiness"],
    });

    expect(result.success).toBe(true);
  });

  it("rejects an advisory with a different disclaimer", () => {
    const result = analysisResponseSchema.safeParse({
      id: "analysis-1",
      simulationId: "simulation-1",
      provider: "deterministic-fallback",
      model: null,
      fallbackUsed: true,
      fallbackReason: "no-api-key",
      analysis: {
        summary: "SIMULATED SCENARIO. Summary",
        keyFindings: ["Finding"],
        priorityAssets: [],
        recommendedActions: ["Review readiness"],
      },
      advisory: {
        id: "analysis-1",
        simulationId: "simulation-1",
        severity: "info",
        title: "Simulated advisory",
        summary: "Summary",
        actions: ["Review readiness"],
        disclaimer: "Official warning",
        generatedAt: "2026-10-02T00:00:00.000Z",
      },
      generatedAt: "2026-10-02T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
    expect(SIMULATED_ADVISORY_DISCLAIMER).toBe(
      "SIMULATED ADVISORY — NOT AN OFFICIAL WARNING",
    );
  });
});
