import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  startSimulationRetentionSweep,
  type SqliteDatabase,
} from "../src/db/database.js";
import { seedOdishaScenario } from "../src/db/seed.js";
import {
  DEFAULT_SIMULATION_RETENTION_MS,
  getCurrentScenario,
  getInfrastructureAssets,
  insertSimulation,
  pruneOldSimulations,
} from "../src/db/queries.js";
import { calculateSimulation } from "@cycloneshield/shared";

let database: SqliteDatabase | null = null;

beforeEach(() => {
  database = createDatabase(":memory:");
});

afterEach(() => {
  database?.close();
  database = null;
});

function addSimulation(db: SqliteDatabase, createdAt: string): void {
  const scenario = getCurrentScenario(db);
  if (!scenario) throw new Error("scenario missing");
  const assets = getInfrastructureAssets(db, scenario.id);
  const parameters = {
    scenarioId: scenario.id,
    windSpeedKph: 175,
    rainfallMm: 160,
    surgeMeters: 1.2,
    trackSpeedMultiplier: 1,
    exposureMultiplier: 1,
  };
  const result = calculateSimulation({ scenario, assets, request: parameters });
  insertSimulation(db, {
    id: `sim-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    scenarioId: scenario.id,
    parameters,
    result,
    createdAt,
  });
}

function count(db: SqliteDatabase): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM simulations").get() as { c: number }).c;
}

describe("simulation retention", () => {
  it("prunes rows older than 24 hours and keeps everything newer", () => {
    const db = database!;
    const now = new Date("2026-09-26T12:00:00.000Z");
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

    addSimulation(db, hoursAgo(1)); // keep
    addSimulation(db, hoursAgo(23)); // keep
    addSimulation(db, hoursAgo(25)); // prune
    addSimulation(db, hoursAgo(72)); // prune

    expect(count(db)).toBe(4);
    const removed = pruneOldSimulations(db, DEFAULT_SIMULATION_RETENTION_MS, now);
    expect(removed).toBe(2);
    expect(count(db)).toBe(2);

    const remaining = db
      .prepare("SELECT created_at FROM simulations ORDER BY created_at")
      .all() as Array<{ created_at: string }>;
    expect(remaining[0].created_at).toBe(hoursAgo(23));
    expect(remaining[1].created_at).toBe(hoursAgo(1));
  });

  it("is a no-op when every row is inside the retention window", () => {
    const db = database!;
    const now = new Date("2026-09-26T12:00:00.000Z");
    addSimulation(db, new Date(now.getTime() - 60_000).toISOString());
    addSimulation(db, now.toISOString());

    expect(pruneOldSimulations(db, DEFAULT_SIMULATION_RETENTION_MS, now)).toBe(0);
    expect(count(db)).toBe(2);
  });

  it("documents that re-seeding already clears simulations via cascade", () => {
    // simulations.scenario_id is ON DELETE CASCADE and the seeder deletes the
    // scenario row, so a restart wipes the table regardless of retention. This
    // is why retention has to run during runtime, not only on boot.
    const db = database!;
    addSimulation(db, new Date().toISOString());
    addSimulation(db, new Date().toISOString());
    expect(count(db)).toBe(2);

    seedOdishaScenario(db);

    expect(count(db)).toBe(0);
  });

  it("bounds growth within a long-lived process", () => {
    const db = database!;
    const now = new Date("2026-09-26T12:00:00.000Z");
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

    // Simulate a demo session that keeps writing rows as time moves forward.
    addSimulation(db, hoursAgo(30));
    for (let hour = 29; hour >= 0; hour -= 1) {
      addSimulation(db, hoursAgo(hour));
      pruneOldSimulations(db, DEFAULT_SIMULATION_RETENTION_MS, now);
    }

    // Only the trailing 24h window survives, no matter how long the session ran.
    // 30 rows were written; the 5 older than 24h are gone, leaving hours 0-24
    // inclusive (a row exactly 24h old is retained, since the cut is exclusive).
    expect(count(db)).toBe(25);
  });

  it("the periodic sweep prunes during runtime, not just on boot", async () => {
    const db = database!;
    addSimulation(db, new Date(Date.now() - 48 * 3600_000).toISOString());
    addSimulation(db, new Date().toISOString());
    expect(count(db)).toBe(2);

    // A boot-time prune cannot help here, because re-seeding cascades the table
    // away. This covers the runtime path that actually bounds growth.
    const stop = startSimulationRetentionSweep(db, 40);
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      stop();
    }

    expect(count(db)).toBe(1);
  });

  it("keeps running when a sweep pass throws instead of crashing", async () => {
    const db = database!;
    const stop = startSimulationRetentionSweep(db, 30);
    // Closing the handle makes the prune throw inside the interval. A
    // maintenance failure must never take the API process down.
    db.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    stop();
    database = null;
    expect(true).toBe(true);
  });
});
