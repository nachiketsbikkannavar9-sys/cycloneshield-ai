import type Database from "better-sqlite3";

type SqliteDatabase = Database.Database;

export const odishaScenarioId = "scenario-nila-odisha-2026";

export const odishaScenarioSeed = {
  id: odishaScenarioId,
  slug: "nila-odisha-2026",
  name: "Cyclone NILA — Synthetic Odisha Scenario",
  summary:
    "A synthetic preparedness exercise representing a severe, fast-moving tropical cyclone approaching Odisha's coast, where wind is the dominant modeled hazard and surge exposure stays comparatively limited.",
  provenance:
    "Synthetic scenario for CycloneShield AI demonstration; not an observed or forecast cyclone.",
  isSynthetic: true,
  validFrom: "2026-10-02T00:00:00Z",
  validTo: "2026-10-05T12:00:00Z",
  landfallAt: "2026-10-04T06:00:00Z",
  // NILA is modelled as a fast-moving, wind-dominant system: severe wind at
  // landfall, but a modest surge and a solid-but-not-extreme rainfall total.
  // The asymmetry is intentional -- it keeps the hazard profile internally
  // coherent while spreading the factors across the risk bands on first load.
  defaultHazardValues: {
    windSpeedKph: 175,
    rainfallMm: 160,
    surgeMeters: 1.2,
    trackSpeedMultiplier: 1,
    exposureMultiplier: 1,
  },
  trackPoints: [
    {
      sequence: 0,
      timestamp: "2026-10-02T00:00:00Z",
      latitude: 12.8,
      longitude: 82.6,
      windKph: 65,
      pressureHpa: 988,
      movementKph: 18,
      movementDirectionDeg: 312,
    },
    {
      sequence: 1,
      timestamp: "2026-10-02T12:00:00Z",
      latitude: 14.1,
      longitude: 83.4,
      windKph: 85,
      pressureHpa: 976,
      movementKph: 20,
      movementDirectionDeg: 318,
    },
    {
      sequence: 2,
      timestamp: "2026-10-03T00:00:00Z",
      latitude: 15.5,
      longitude: 84.1,
      windKph: 110,
      pressureHpa: 962,
      movementKph: 22,
      movementDirectionDeg: 325,
    },
    {
      sequence: 3,
      timestamp: "2026-10-03T12:00:00Z",
      latitude: 16.9,
      longitude: 84.7,
      windKph: 140,
      pressureHpa: 948,
      movementKph: 23,
      movementDirectionDeg: 330,
    },
    {
      sequence: 4,
      timestamp: "2026-10-04T00:00:00Z",
      latitude: 18.2,
      longitude: 85.1,
      windKph: 165,
      pressureHpa: 934,
      movementKph: 24,
      movementDirectionDeg: 334,
    },
    {
      sequence: 5,
      timestamp: "2026-10-04T06:00:00Z",
      latitude: 19.7,
      longitude: 85.3,
      windKph: 175,
      pressureHpa: 928,
      movementKph: 25,
      movementDirectionDeg: 338,
    },
  ],
  impactZones: [
    {
      id: "zone-puri-surge",
      name: "Puri coastal surge",
      hazard: "surge",
      severity: "moderate",
      latitude: 19.8,
      longitude: 85.8,
      radiusKm: 95,
      description: "Coastal inundation exposure around Puri and the southern littoral.",
    },
    {
      id: "zone-kalahandi-rain",
      name: "Kalahandi rainfall belt",
      hazard: "rainfall",
      severity: "high",
      latitude: 19.9,
      longitude: 82.8,
      radiusKm: 130,
      description: "Intense rainfall exposure extending inland toward Kalahandi.",
    },
    {
      id: "zone-khordha-wind",
      name: "Khordha wind corridor",
      hazard: "wind",
      severity: "critical",
      latitude: 20.3,
      longitude: 85.6,
      radiusKm: 110,
      description: "Damaging wind corridor north of the landfall area.",
    },
    {
      id: "zone-balasore-access",
      name: "Balasore access disruption",
      hazard: "access",
      severity: "high",
      latitude: 21.1,
      longitude: 86.9,
      radiusKm: 90,
      description: "Road and service access may be disrupted after landfall.",
    },
  ],
  infrastructureAssets: [
    {
      id: "asset-puri-district-hospital",
      name: "Puri District Hospital",
      type: "hospital",
      district: "Puri",
      latitude: 19.8135,
      longitude: 85.8312,
      capacity: 420,
      populationServed: 1950000,
      criticality: "critical",
      vulnerabilityScore: 0.7,
      notes:
        "Primary coastal referral facility in the synthetic exercise; aged block with limited surge hardening.",
    },
    {
      id: "asset-khordha-community-health",
      name: "Khordha Community Health Centre",
      type: "hospital",
      district: "Khordha",
      latitude: 20.3824,
      longitude: 85.727,
      capacity: 180,
      populationServed: 1650000,
      criticality: "high",
      vulnerabilityScore: 0.36,
      notes: "Referral facility near the modeled wind corridor.",
    },
    {
      id: "asset-puri-shelter-01",
      name: "Puri Model School Shelter",
      type: "shelter",
      district: "Puri",
      latitude: 19.767,
      longitude: 85.318,
      capacity: 1200,
      populationServed: 1200,
      criticality: "high",
      vulnerabilityScore: 0.58,
      notes: "Synthetic designated shelter inventory.",
    },
    {
      id: "asset-ganjam-shelter-01",
      name: "Gajpam Model School Shelter",
      type: "shelter",
      district: "Ganjam",
      latitude: 19.381,
      longitude: 85.098,
      capacity: 900,
      populationServed: 900,
      criticality: "medium",
      vulnerabilityScore: 0.49,
      notes: "Synthetic designated shelter inventory.",
    },
    {
      id: "asset-balasore-power-01",
      name: "Balasore Grid Substation",
      type: "power",
      district: "Balasore",
      latitude: 21.4931,
      longitude: 86.9335,
      capacity: null,
      populationServed: 2400000,
      criticality: "critical",
      vulnerabilityScore: 0.31,
      notes: "Synthetic power-network dependency.",
    },
    {
      id: "asset-ganjam-water-01",
      name: "Ganjam Water Treatment Plant",
      type: "water",
      district: "Ganjam",
      latitude: 19.248,
      longitude: 85.118,
      capacity: 32000000,
      populationServed: 1600000,
      criticality: "high",
      vulnerabilityScore: 0.45,
      notes: "Synthetic water-service dependency.",
    },
    {
      id: "asset-khordha-road-01",
      name: "NH-16 Khordha Link",
      type: "road",
      district: "Khordha",
      latitude: 20.24,
      longitude: 85.72,
      capacity: 4,
      populationServed: 2200000,
      criticality: "critical",
      vulnerabilityScore: 0.72,
      notes:
        "Designated evacuation and supply corridor; single-lane stretch with exposed bridge approaches.",
    },
    {
      id: "asset-puri-bridge-01",
      name: "Mangalagiri Bridge",
      type: "bridge",
      district: "Puri",
      latitude: 19.94,
      longitude: 85.41,
      capacity: 2,
      populationServed: 850000,
      criticality: "high",
      vulnerabilityScore: 0.8,
      notes:
        "Synthetic crossing on the inland access network; narrow deck with no secondary route.",
    },
  ],
} as const;

export function seedOdishaScenario(db: SqliteDatabase): void {
  const seed = odishaScenarioSeed;
  const insertScenario = db.prepare(`
    INSERT INTO scenarios (
      id, slug, name, summary, provenance, is_synthetic, valid_from, valid_to,
      landfall_at, default_hazard_values
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `);
  const insertTrackPoint = db.prepare(`
    INSERT INTO scenario_track_points (
      scenario_id, sequence_no, timestamp, latitude, longitude, wind_kph,
      pressure_hpa, movement_kph, movement_direction_deg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertImpactZone = db.prepare(`
    INSERT INTO impact_zones (
      id, scenario_id, name, hazard, severity, latitude, longitude,
      radius_km, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAsset = db.prepare(`
    INSERT INTO infrastructure_assets (
      id, scenario_id, name, type, district, latitude, longitude, capacity,
      population_served, criticality, vulnerability_score, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    const deleteAsset = db.prepare("DELETE FROM infrastructure_assets WHERE id = ?");
    for (const asset of seed.infrastructureAssets) {
      deleteAsset.run(asset.id);
    }
    db.prepare("DELETE FROM scenarios WHERE id = ?").run(seed.id);
    insertScenario.run(
      seed.id,
      seed.slug,
      seed.name,
      seed.summary,
      seed.provenance,
      seed.validFrom,
      seed.validTo,
      seed.landfallAt,
      JSON.stringify(seed.defaultHazardValues),
    );

    for (const point of seed.trackPoints) {
      insertTrackPoint.run(
        seed.id,
        point.sequence,
        point.timestamp,
        point.latitude,
        point.longitude,
        point.windKph,
        point.pressureHpa,
        point.movementKph,
        point.movementDirectionDeg,
      );
    }

    for (const zone of seed.impactZones) {
      insertImpactZone.run(
        zone.id,
        seed.id,
        zone.name,
        zone.hazard,
        zone.severity,
        zone.latitude,
        zone.longitude,
        zone.radiusKm,
        zone.description,
      );
    }

    for (const asset of seed.infrastructureAssets) {
      insertAsset.run(
        asset.id,
        seed.id,
        asset.name,
        asset.type,
        asset.district,
        asset.latitude,
        asset.longitude,
        asset.capacity,
        asset.populationServed,
        asset.criticality,
        asset.vulnerabilityScore,
        asset.notes,
      );
    }
  });

  run();
}
