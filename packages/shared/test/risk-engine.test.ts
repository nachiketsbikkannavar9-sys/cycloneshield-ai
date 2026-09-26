import { describe, expect, it } from "vitest";
import { odishaScenarioSeed } from "../../../apps/api/src/db/seed.js";
import {
  calculateSimulation,
  getRiskCategory,
  simulationRequestSchema,
} from "../src/index.js";
import type { InfrastructureAsset } from "../src/schemas/infrastructure.js";
import type { Scenario } from "../src/schemas/scenario.js";

const scenario: Scenario = {
  id: odishaScenarioSeed.id,
  slug: odishaScenarioSeed.slug,
  name: odishaScenarioSeed.name,
  summary: odishaScenarioSeed.summary,
  provenance: odishaScenarioSeed.provenance,
  isSynthetic: odishaScenarioSeed.isSynthetic,
  validFrom: odishaScenarioSeed.validFrom,
  validTo: odishaScenarioSeed.validTo,
  landfallAt: odishaScenarioSeed.landfallAt,
  trackPoints: odishaScenarioSeed.trackPoints.map((point) => ({ ...point })),
  impactZones: odishaScenarioSeed.impactZones.map((zone) => ({
    ...zone,
    coordinates: { ...zone.coordinates },
  })),
};

const assets: InfrastructureAsset[] = odishaScenarioSeed.infrastructureAssets.map((asset) => ({
  id: asset.id,
  name: asset.name,
  type: asset.type,
  district: asset.district,
  location: { latitude: asset.latitude, longitude: asset.longitude },
  capacity: asset.capacity,
  populationServed: asset.populationServed,
  criticality: asset.criticality,
  vulnerabilityScore: asset.vulnerabilityScore,
  notes: asset.notes,
}));

const baselineRequest = simulationRequestSchema.parse({
  scenarioId: scenario.id,
  windSpeedKph: 175,
  rainfallMm: 300,
  surgeMeters: 3,
  trackSpeedMultiplier: 1,
  exposureMultiplier: 1,
});

describe("explainable risk engine", () => {
  it("normalizes inputs and traces every overall factor", () => {
    const result = calculateSimulation({ scenario, assets, request: baselineRequest });
    const contributionTotal = result.factorContributions.reduce(
      (total, factor) => total + factor.contribution,
      0,
    );

    expect(result.overallCategory).toBe(getRiskCategory(result.overallScore));
    expect(result.factorContributions).toHaveLength(5);
    expect(contributionTotal).toBeCloseTo(result.overallScore, 1);
    expect(result.factorContributions.every((factor) => factor.explanation.length > 20)).toBe(true);
    expect(result.hazardScores.wind).toBe(70);
    expect(result.hazardScores.surge).toBe(60);
  });

  it("recalculates higher risk when controls intensify", () => {
    const baseline = calculateSimulation({ scenario, assets, request: baselineRequest });
    const intensified = calculateSimulation({
      scenario,
      assets,
      request: {
        ...baselineRequest,
        windSpeedKph: 250,
        rainfallMm: 600,
        surgeMeters: 6,
        trackSpeedMultiplier: 2,
        exposureMultiplier: 2,
      },
    });

    expect(intensified.overallScore).toBeGreaterThan(baseline.overallScore);
    expect(intensified.infrastructure).toHaveLength(assets.length);
    expect(intensified.infrastructure[0]?.factorContributions).toHaveLength(7);
    expect(intensified.infrastructure[0]?.drivers.length).toBeGreaterThan(0);
    expect(intensified.confidence.factors).toHaveLength(5);
  });

  it("uses the documented category thresholds", () => {
    expect(getRiskCategory(24.9)).toBe("low");
    expect(getRiskCategory(25)).toBe("moderate");
    expect(getRiskCategory(50)).toBe("high");
    expect(getRiskCategory(75)).toBe("critical");
  });
});
