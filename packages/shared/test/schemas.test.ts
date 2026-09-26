import { describe, expect, it } from "vitest";
import { calculateOverallRisk, getRiskCategory } from "../src/risk/index.js";
import { scenarioSchema } from "../src/schemas/scenario.js";

describe("shared risk primitives", () => {
  it("calculates the weighted risk score and category", () => {
    const score = calculateOverallRisk({
      wind: 80,
      surge: 60,
      rainfall: 40,
      flood: 20,
      access: 10,
    });

    expect(score).toBe(51);
    expect(getRiskCategory(score)).toBe("high");
  });

  it("rejects non-synthetic scenarios", () => {
    const result = scenarioSchema.safeParse({
      id: "scenario-1",
      slug: "scenario-1",
      name: "Scenario",
      summary: "Summary",
      provenance: "Synthetic",
      isSynthetic: false,
      validFrom: "2026-01-01",
      validTo: "2026-01-02",
      landfallAt: null,
      trackPoints: [],
      impactZones: [],
    });

    expect(result.success).toBe(false);
  });
});
