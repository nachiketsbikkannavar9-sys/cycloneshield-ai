import {
  advisorySchema,
  analysisFallbackDetailSchema,
  analysisFallbackReasonSchema,
  analysisPayloadSchema,
  analysisProviderSchema,
  analysisResponseSchema,
  scenarioHazardDefaultsSchema,
  simulationResponseSchema,
  type AnalysisFallbackDetail,
  type AnalysisResponse,
  type InfrastructureAsset,
  type Scenario,
  type SimulationResponse,
} from "@cycloneshield/shared";
import { odishaScenarioSeed } from "./seed.js";
import type { SqliteDatabase } from "./database.js";

type ScenarioRow = {
  id: string;
  slug: string;
  name: string;
  summary: string;
  provenance: string;
  is_synthetic: number;
  valid_from: string;
  valid_to: string;
  landfall_at: string | null;
  default_hazard_values: string | null;
  created_at: string;
};

type TrackPointRow = {
  sequence_no: number;
  timestamp: string;
  latitude: number;
  longitude: number;
  wind_kph: number;
  pressure_hpa: number;
  movement_kph: number;
  movement_direction_deg: number;
};

type ImpactZoneRow = {
  id: string;
  name: string;
  hazard: string;
  severity: string;
  latitude: number;
  longitude: number;
  radius_km: number;
  description: string;
};

type AssetRow = {
  id: string;
  name: string;
  type: string;
  district: string;
  latitude: number;
  longitude: number;
  capacity: number | null;
  population_served: number | null;
  criticality: string;
  vulnerability_score: number;
  notes: string;
};

export type ScenarioRecord = Scenario & {
  createdAt: string;
};

/** How long recalculation history is kept. Rows older than this are pruned on
 *  boot; nothing in the product reads historical simulations. */
export const DEFAULT_SIMULATION_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * A scenario row written before the column existed would otherwise fail the
 * response schema, so fall back to the seeded profile rather than 500ing.
 */
function parseDefaultHazardValues(raw: string | null): Scenario["defaultHazardValues"] {
  const fallback = odishaScenarioSeed.defaultHazardValues;
  if (!raw) return fallback;
  try {
    const parsed = scenarioHazardDefaultsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function getCurrentScenario(db: SqliteDatabase): ScenarioRecord | null {
  const scenarioRow = db
    .prepare(
      `SELECT id, slug, name, summary, provenance, is_synthetic, valid_from,
        valid_to, landfall_at, default_hazard_values, created_at
       FROM scenarios
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get() as ScenarioRow | undefined;

  if (!scenarioRow) return null;

  const trackPoints = db
    .prepare(
      `SELECT sequence_no, timestamp, latitude, longitude, wind_kph,
        pressure_hpa, movement_kph, movement_direction_deg
       FROM scenario_track_points
       WHERE scenario_id = ?
       ORDER BY sequence_no`,
    )
    .all(scenarioRow.id) as TrackPointRow[];

  const impactZones = db
    .prepare(
      `SELECT id, name, hazard, severity, latitude, longitude, radius_km, description
       FROM impact_zones
       WHERE scenario_id = ?
       ORDER BY name`,
    )
    .all(scenarioRow.id) as ImpactZoneRow[];

  return {
    id: scenarioRow.id,
    slug: scenarioRow.slug,
    name: scenarioRow.name,
    summary: scenarioRow.summary,
    provenance: scenarioRow.provenance,
    isSynthetic: true,
    validFrom: scenarioRow.valid_from,
    validTo: scenarioRow.valid_to,
    landfallAt: scenarioRow.landfall_at,
    defaultHazardValues: parseDefaultHazardValues(scenarioRow.default_hazard_values),
    createdAt: scenarioRow.created_at,
    trackPoints: trackPoints.map((point) => ({
      sequence: point.sequence_no,
      timestamp: point.timestamp,
      latitude: point.latitude,
      longitude: point.longitude,
      windKph: point.wind_kph,
      pressureHpa: point.pressure_hpa,
      movementKph: point.movement_kph,
      movementDirectionDeg: point.movement_direction_deg,
    })),
    impactZones: impactZones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      hazard: zone.hazard as Scenario["impactZones"][number]["hazard"],
      severity: zone.severity as Scenario["impactZones"][number]["severity"],
      coordinates: {
        latitude: zone.latitude,
        longitude: zone.longitude,
      },
      radiusKm: zone.radius_km,
      description: zone.description,
    })),
  };
}

export function getInfrastructureAssets(
  db: SqliteDatabase,
  scenarioId: string,
): InfrastructureAsset[] {
  const rows = db
    .prepare(
      `SELECT id, name, type, district, latitude, longitude, capacity,
        population_served, criticality, vulnerability_score, notes
       FROM infrastructure_assets
       WHERE scenario_id = ?
       ORDER BY name`,
    )
    .all(scenarioId) as AssetRow[];

  return rows.map((asset) => ({
    id: asset.id,
    name: asset.name,
    type: asset.type as InfrastructureAsset["type"],
    district: asset.district,
    location: {
      latitude: asset.latitude,
      longitude: asset.longitude,
    },
    capacity: asset.capacity,
    populationServed: asset.population_served,
    criticality: asset.criticality as InfrastructureAsset["criticality"],
    vulnerabilityScore: asset.vulnerability_score,
    notes: asset.notes,
  }));
}

type SimulationRow = {
  id: string;
  scenario_id: string;
  parameters_json: string;
  result_json: string;
  created_at: string;
};

export function insertSimulation(
  db: SqliteDatabase,
  simulation: SimulationResponse,
): void {
  db.prepare(
    `INSERT INTO simulations (id, scenario_id, parameters_json, result_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    simulation.id,
    simulation.scenarioId,
    JSON.stringify(simulation.parameters),
    JSON.stringify(simulation.result),
    simulation.createdAt,
  );
}

/**
 * Delete simulation rows older than `maxAgeMs`.
 *
 * Every recalculation writes a row, and the UI recalculates on a 250ms debounce
 * while a slider is being dragged, so a single demo can add thousands of rows
 * that are never read again. Nothing consumes historical simulations, so old
 * rows are pruned on boot to keep the database file from growing without bound.
 *
 * Returns the number of rows removed.
 */
export function pruneOldSimulations(
  db: SqliteDatabase,
  maxAgeMs = DEFAULT_SIMULATION_RETENTION_MS,
  now: Date = new Date(),
): number {
  const cutoff = new Date(now.getTime() - maxAgeMs).toISOString();
  const result = db
    .prepare("DELETE FROM simulations WHERE created_at < ?")
    .run(cutoff);
  return result.changes;
}

export function getSimulation(
  db: SqliteDatabase,
  simulationId: string,
): SimulationResponse | null {
  const row = db
    .prepare(
      `SELECT id, scenario_id, parameters_json, result_json, created_at
       FROM simulations
       WHERE id = ?`,
    )
    .get(simulationId) as SimulationRow | undefined;

  if (!row) return null;

  return simulationResponseSchema.parse({
    id: row.id,
    scenarioId: row.scenario_id,
    parameters: JSON.parse(row.parameters_json) as unknown,
    result: JSON.parse(row.result_json) as unknown,
    createdAt: row.created_at,
  });
}

type AdvisoryRow = {
  id: string;
  simulation_id: string;
  severity: string;
  title: string;
  summary: string;
  actions_json: string;
  disclaimer: string;
  generated_at: string;
  provider: string;
  model: string | null;
  fallback_used: number;
  fallback_reason: string | null;
  fallback_detail: string | null;
  analysis_json: string;
};

/**
 * Older rows predate the column, so tolerate a null/missing/corrupt value
 * rather than failing the whole read.
 */
function parseFallbackDetail(raw: string | null): AnalysisFallbackDetail | null {
  if (!raw) return null;
  try {
    const parsed = analysisFallbackDetailSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function insertAdvisory(
  db: SqliteDatabase,
  record: AnalysisResponse,
): void {
  db.prepare(
    `INSERT INTO advisories (
       id, simulation_id, severity, title, summary, actions_json, disclaimer,
       generated_at, provider, model, fallback_used, fallback_reason,
       fallback_detail, analysis_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.simulationId,
    record.advisory.severity,
    record.advisory.title,
    record.advisory.summary,
    JSON.stringify(record.advisory.actions),
    record.advisory.disclaimer,
    record.generatedAt,
    record.provider,
    record.model,
    record.fallbackUsed ? 1 : 0,
    record.fallbackReason,
    record.fallbackDetail ? JSON.stringify(record.fallbackDetail) : null,
    JSON.stringify(record.analysis),
  );
}

export const insertAnalysis = insertAdvisory;

export function getLatestAdvisory(
  db: SqliteDatabase,
  simulationId: string,
): AnalysisResponse | null {
  const row = db
    .prepare(
      `SELECT id, simulation_id, severity, title, summary, actions_json,
        disclaimer, generated_at, provider, model, fallback_used,
        fallback_reason, fallback_detail, analysis_json
       FROM advisories
       WHERE simulation_id = ?
       ORDER BY generated_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(simulationId) as AdvisoryRow | undefined;

  if (!row) return null;

  let analysisJson: unknown;
  try {
    analysisJson = JSON.parse(row.analysis_json) as unknown;
  } catch {
    return null;
  }

  try {
    const advisory = advisorySchema.parse({
      id: row.id,
      simulationId: row.simulation_id,
      severity: row.severity,
      title: row.title,
      summary: row.summary,
      actions: JSON.parse(row.actions_json) as unknown,
      disclaimer: row.disclaimer,
      generatedAt: row.generated_at,
    });

    return analysisResponseSchema.parse({
      id: row.id,
      simulationId: row.simulation_id,
      provider: analysisProviderSchema.parse(row.provider),
      model: row.model,
      fallbackUsed: Boolean(row.fallback_used),
      fallbackReason: row.fallback_reason
        ? analysisFallbackReasonSchema.parse(row.fallback_reason)
        : null,
      fallbackDetail: parseFallbackDetail(row.fallback_detail),
      analysis: analysisPayloadSchema.parse(analysisJson),
      advisory,
      generatedAt: row.generated_at,
    });
  } catch {
    return null;
  }
}

export const getAdvisory = getLatestAdvisory;
