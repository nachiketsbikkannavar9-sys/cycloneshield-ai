import { haversineDistanceKm } from "../geo/index.js";
import { riskWeights, type RiskCategory } from "../constants/risk.js";
import type {
  Criticality,
  ImpactZone,
  InfrastructureAsset,
  InfrastructureRisk,
  Scenario,
} from "../schemas/index.js";
import {
  simulationResultSchema,
  type Confidence,
  type FactorContribution,
  type HazardScores,
  type SimulationRequest,
  type SimulationResult,
} from "../schemas/simulation.js";

const normalizationBounds = {
  windSpeedKph: 250,
  rainfallMm: 500,
  surgeMeters: 5,
  trackSpeedMultiplier: 1.5,
} as const;

const assetRiskWeights = {
  criticality: 0.2,
  vulnerability: 0.2,
  wind: 0.18,
  surge: 0.14,
  rainfall: 0.12,
  flood: 0.08,
  access: 0.08,
} as const;

const criticalityScores: Record<Criticality, number> = {
  low: 20,
  medium: 40,
  high: 65,
  critical: 85,
};

const typeSensitivity: Record<InfrastructureAsset["type"], number> = {
  hospital: 1.1,
  school: 1.05,
  shelter: 1,
  power: 1.1,
  water: 1.05,
  road: 1.2,
  bridge: 1.25,
  communications: 1.15,
};

const factorLabels: Record<FactorContribution["factor"], string> = {
  criticality: "Criticality",
  vulnerability: "Vulnerability",
  wind: "Wind",
  surge: "Surge",
  rainfall: "Rainfall",
  flood: "Flood",
  access: "Access",
};

function clamp(value: number, minimum = 0, maximum = 100): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalize(value: number, maximum: number): number {
  return clamp((value / maximum) * 100);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function getRiskCategory(score: number): RiskCategory {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "moderate";
  return "low";
}

export function calculateOverallRisk(input: HazardScores): number {
  const score =
    input.wind * riskWeights.wind +
    input.surge * riskWeights.surge +
    input.rainfall * riskWeights.rainfall +
    input.flood * riskWeights.flood +
    input.access * riskWeights.access;

  return round(clamp(score));
}

export function calculateHazardScores(request: SimulationRequest): HazardScores {
  const wind = normalize(request.windSpeedKph, normalizationBounds.windSpeedKph);
  const surge = normalize(request.surgeMeters, normalizationBounds.surgeMeters);
  const rainfall = normalize(request.rainfallMm, normalizationBounds.rainfallMm);
  const trackSpeed = normalize(
    request.trackSpeedMultiplier - 0.5,
    normalizationBounds.trackSpeedMultiplier,
  );
  const flood = clamp(rainfall * 0.65 + surge * 0.35);
  const access = clamp(trackSpeed * 0.4 + wind * 0.25 + surge * 0.2 + rainfall * 0.15);

  return {
    wind: round(wind),
    surge: round(surge),
    rainfall: round(rainfall),
    flood: round(flood),
    access: round(access),
  };
}

function createContribution(input: {
  factor: FactorContribution["factor"];
  label: string;
  rawValue: number;
  normalizedScore: number;
  weight: number;
  explanation: string;
}): FactorContribution {
  return {
    factor: input.factor,
    label: input.label,
    rawValue: round(input.rawValue, 2),
    normalizedScore: round(input.normalizedScore),
    weight: input.weight,
    contribution: 0,
    explanation: input.explanation,
  };
}

function scaleContributions(
  contributions: FactorContribution[],
  exposureMultiplier: number,
): FactorContribution[] {
  const weighted = contributions.map((item) => ({
    ...item,
    contribution: item.normalizedScore * item.weight * exposureMultiplier,
  }));
  const total = sum(weighted.map((item) => item.contribution));
  const scale = total > 100 ? 100 / total : 1;

  return weighted.map((item) => ({
    ...item,
    contribution: round(item.contribution * scale, 2),
    explanation: `${item.explanation} Exposure multiplier ${round(exposureMultiplier, 2)}× applied${
      scale < 1 ? "; scores above 100 were capped proportionally." : "."
    }`,
  }));
}

function buildOverallContributions(
  request: SimulationRequest,
  hazardScores: HazardScores,
): FactorContribution[] {
  const contributions = [
    createContribution({
      factor: "wind",
      label: factorLabels.wind,
      rawValue: request.windSpeedKph,
      normalizedScore: hazardScores.wind,
      weight: riskWeights.wind,
      explanation: `${round(request.windSpeedKph)} km/h wind normalized against a ${normalizationBounds.windSpeedKph} km/h reference.`,
    }),
    createContribution({
      factor: "surge",
      label: factorLabels.surge,
      rawValue: request.surgeMeters,
      normalizedScore: hazardScores.surge,
      weight: riskWeights.surge,
      explanation: `${round(request.surgeMeters, 2)} m surge normalized against a ${normalizationBounds.surgeMeters} m reference.`,
    }),
    createContribution({
      factor: "rainfall",
      label: factorLabels.rainfall,
      rawValue: request.rainfallMm,
      normalizedScore: hazardScores.rainfall,
      weight: riskWeights.rainfall,
      explanation: `${round(request.rainfallMm)} mm rainfall normalized against a ${normalizationBounds.rainfallMm} mm reference.`,
    }),
    createContribution({
      factor: "flood",
      label: factorLabels.flood,
      rawValue: hazardScores.flood,
      normalizedScore: hazardScores.flood,
      weight: riskWeights.flood,
      explanation: `Flood score is 65% rainfall plus 35% surge, producing ${round(hazardScores.flood)}/100.`,
    }),
    createContribution({
      factor: "access",
      label: factorLabels.access,
      rawValue: hazardScores.access,
      normalizedScore: hazardScores.access,
      weight: riskWeights.access,
      explanation: `Access score combines track speed (40%), wind (25%), surge (20%), and rainfall (15%), producing ${round(hazardScores.access)}/100.`,
    }),
  ];

  return scaleContributions(contributions, request.exposureMultiplier);
}

function getConfidenceLevel(score: number): "low" | "moderate" | "high" {
  if (score >= 75) return "high";
  if (score >= 50) return "moderate";
  return "low";
}

function calculateConfidence(
  scenario: Scenario,
  assets: InfrastructureAsset[],
): Confidence {
  const factors = [
    {
      name: "Synthetic scenario boundary",
      points: 35,
      detail: "The scenario is synthetic and is not an observed or forecast cyclone.",
    },
    {
      name: "Parameter completeness",
      points: 15,
      detail: "All five simulator multipliers and hazard magnitudes are present in the request.",
    },
    {
      name: "Track coverage",
      points: Math.min(10, round(scenario.trackPoints.length * 2)),
      detail: `${scenario.trackPoints.length} modeled track points provide the track geometry.`,
    },
    {
      name: "Hazard-zone coverage",
      points: Math.min(8, round(scenario.impactZones.length * 2)),
      detail: `${scenario.impactZones.length} synthetic impact zones provide hazard-specific exposure context.`,
    },
    {
      name: "Infrastructure coverage",
      points: Math.min(12, round(assets.length * 1.5)),
      detail: `${assets.length} seeded assets are included in the infrastructure comparison.`,
    },
  ];
  const score = round(clamp(sum(factors.map((factor) => factor.points))));

  return {
    score,
    level: getConfidenceLevel(score),
    factors,
    explanation:
      "Confidence measures completeness and internal consistency of the synthetic inputs; it is not real-world forecast accuracy.",
  };
}

function getHazardZones(
  hazard: FactorContribution["factor"],
  impactZones: ImpactZone[],
): ImpactZone[] {
  if (hazard === "flood") {
    return impactZones.filter(
      (zone) => zone.hazard === "surge" || zone.hazard === "rainfall",
    );
  }
  return impactZones.filter((zone) => zone.hazard === hazard);
}

function getAssetHazardExposure(
  asset: InfrastructureAsset,
  hazard: FactorContribution["factor"],
  impactZones: ImpactZone[],
): { score: number; zoneName: string | null } {
  const zones = getHazardZones(hazard, impactZones);
  let bestExposure = 0;
  let bestZoneName: string | null = null;

  for (const zone of zones) {
    const distance = haversineDistanceKm(asset.location, zone.coordinates);
    const exposure =
      zone.radiusKm <= 0
        ? distance === 0
          ? 1
          : 0
        : distance <= zone.radiusKm
          ? 1
          : clamp(1 - (distance - zone.radiusKm) / (zone.radiusKm * 0.75));
    if (exposure > bestExposure) {
      bestExposure = exposure;
      bestZoneName = zone.name;
    }
  }

  return { score: round(bestExposure, 2), zoneName: bestZoneName };
}

function buildAssetContributions(
  asset: InfrastructureAsset,
  request: SimulationRequest,
  hazardScores: HazardScores,
  impactZones: ImpactZone[],
): FactorContribution[] {
  const vulnerabilityScore = clamp(
    asset.vulnerabilityScore * typeSensitivity[asset.type] * 100,
  );
  const definitions: Array<{
    factor: FactorContribution["factor"];
    rawValue: number;
    normalizedScore: number;
    explanation: string;
    weight: number;
  }> = [
    {
      factor: "criticality",
      rawValue: criticalityScores[asset.criticality],
      normalizedScore: criticalityScores[asset.criticality],
      weight: assetRiskWeights.criticality,
      explanation: `${asset.criticality} criticality maps to ${criticalityScores[asset.criticality]}/100.`,
    },
    {
      factor: "vulnerability",
      rawValue: asset.vulnerabilityScore,
      normalizedScore: vulnerabilityScore,
      weight: assetRiskWeights.vulnerability,
      explanation: `${Math.round(asset.vulnerabilityScore * 100)} baseline vulnerability × ${round(typeSensitivity[asset.type], 2)} type sensitivity = ${round(vulnerabilityScore)}/100.`,
    },
  ];

  for (const hazard of ["wind", "surge", "rainfall", "flood", "access"] as const) {
    const localExposure = getAssetHazardExposure(asset, hazard, impactZones);
    const hazardScore = hazardScores[hazard];
    const normalizedScore = clamp(hazardScore * localExposure.score);
    definitions.push({
      factor: hazard,
      rawValue: localExposure.score,
      normalizedScore,
      weight: assetRiskWeights[hazard],
      explanation: `${round(hazardScore)}/100 scenario hazard × ${round(localExposure.score, 2)} local exposure${
        localExposure.zoneName ? ` from ${localExposure.zoneName}` : " outside mapped zones"
      } = ${round(normalizedScore)}/100.`,
    });
  }

  return scaleContributions(
    definitions.map((definition) =>
      createContribution({
        factor: definition.factor,
        label: factorLabels[definition.factor],
        rawValue: definition.rawValue,
        normalizedScore: definition.normalizedScore,
        weight: definition.weight,
        explanation: definition.explanation,
      }),
    ),
    request.exposureMultiplier,
  );
}

function buildInfrastructureRisk(
  asset: InfrastructureAsset,
  request: SimulationRequest,
  hazardScores: HazardScores,
  impactZones: ImpactZone[],
  confidence: Confidence,
): InfrastructureRisk {
  const factorContributions = buildAssetContributions(
    asset,
    request,
    hazardScores,
    impactZones,
  );
  const riskScore = round(sum(factorContributions.map((item) => item.contribution)));
  const ranked = [...factorContributions].sort(
    (left, right) => right.contribution - left.contribution,
  );
  const drivers = ranked
    .slice(0, 3)
    .map(
      (item) =>
        `${item.label}: ${round(item.contribution)} points. ${item.explanation}`,
    );

  return {
    assetId: asset.id,
    assetName: asset.name,
    district: asset.district,
    type: asset.type,
    criticality: asset.criticality,
    riskScore,
    riskCategory: getRiskCategory(riskScore),
    confidence,
    factorContributions,
    drivers,
  };
}

export function calculateSimulation(input: {
  scenario: Scenario;
  assets: InfrastructureAsset[];
  request: SimulationRequest;
}): SimulationResult {
  const hazardScores = calculateHazardScores(input.request);
  const factorContributions = buildOverallContributions(input.request, hazardScores);
  const overallScore = round(sum(factorContributions.map((item) => item.contribution)));
  const confidence = calculateConfidence(input.scenario, input.assets);
  const infrastructure = input.assets.map((asset) =>
    buildInfrastructureRisk(
      asset,
      input.request,
      hazardScores,
      input.scenario.impactZones,
      confidence,
    ),
  );

  return simulationResultSchema.parse({
    calculationVersion: "risk-engine-v1",
    scenarioSynthetic: true,
    overallScore,
    overallCategory: getRiskCategory(overallScore),
    hazardScores,
    factorContributions,
    confidence,
    infrastructure,
  });
}
