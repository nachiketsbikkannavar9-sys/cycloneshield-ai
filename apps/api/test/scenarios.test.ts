import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, type SqliteDatabase } from "../src/db/database.js";
import { seedOdishaScenario } from "../../../database/seed/odisha-scenario.js";
import {
  getRiskCategory,
  type HazardScores,
  type Scenario,
} from "@cycloneshield/shared";

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe("scenario dashboard route", () => {
  it("returns the seeded track, impact zones, and infrastructure assets", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);

    const response = await request(createApp(database)).get("/api/scenarios/current");

    expect(response.status).toBe(200);
    expect(response.body.scenario.slug).toBe("nila-odisha-2026");
    expect(response.body.scenario.isSynthetic).toBe(true);
    expect(response.body.scenario.trackPoints).toHaveLength(6);
    expect(response.body.scenario.impactZones).toHaveLength(4);
    expect(response.body.assets).toHaveLength(8);
    expect(response.body.assets[0].location.latitude).toBeTypeOf("number");
    expect(response.body.source.status).toBe("seeded");
  });

  it("serves the seeded default hazard values", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);

    const response = await request(createApp(database)).get("/api/scenarios/current");

    expect(response.body.scenario.defaultHazardValues).toEqual({
      windSpeedKph: 175,
      rainfallMm: 160,
      surgeMeters: 1.2,
      trackSpeedMultiplier: 1,
      exposureMultiplier: 1,
    });
  });

  it("opens with hazard factors spread across at least two risk bands", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);
    const app = createApp(database);

    const scenario = (
      await request(app).get("/api/scenarios/current")
    ).body.scenario as Scenario;
    const defaults = scenario.defaultHazardValues;

    const response = await request(app).post("/api/simulations").send({
      scenarioId: scenario.id,
      ...defaults,
    });

    expect(response.status).toBe(201);
    const { hazardScores, overallScore, overallCategory } = response.body.result as {
      hazardScores: HazardScores;
      overallScore: number;
      overallCategory: string;
    };

    // Guards the reported bug: every factor rendered amber at t=0, which made
    // the per-factor colour logic look broken on first load.
    const categories = Object.values(hazardScores).map(getRiskCategory);
    expect(new Set(categories).size).toBeGreaterThanOrEqual(2);
    expect(categories).toContain("high");
    expect(getRiskCategory(hazardScores.wind)).toBe("high");
    expect(hazardScores.rainfall).toBeLessThan(50);
    expect(hazardScores.surge).toBeLessThan(25);
    expect(overallScore).toBeGreaterThan(0);
    expect(overallCategory).toBe("moderate");

    // Coherence: the surge zone must not be rated above the surge factor band.
    const surgeZone = scenario.impactZones.find((zone) => zone.hazard === "surge");
    expect(surgeZone?.severity).not.toBe("critical");
  });

  it("keeps each impact zone within one band of its own factor", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);
    const app = createApp(database);

    const scenario = (
      await request(app).get("/api/scenarios/current")
    ).body.scenario as Scenario;
    const simulation = await request(app).post("/api/simulations").send({
      scenarioId: scenario.id,
      ...scenario.defaultHazardValues,
    });
    const hazardScores = simulation.body.result.hazardScores as HazardScores;

    const order = ["low", "moderate", "high", "critical"] as const;
    for (const zone of scenario.impactZones) {
      if (!(zone.hazard in hazardScores)) continue;
      const factorBand = order.indexOf(
        getRiskCategory(hazardScores[zone.hazard as keyof HazardScores]),
      );
      const zoneBand = order.indexOf(zone.severity);
      // A zone is a local peak footprint, so it may sit one band above its
      // scenario-wide factor, but never more.
      expect(zoneBand - factorBand).toBeLessThanOrEqual(1);
      expect(zoneBand).toBeGreaterThanOrEqual(factorBand);
    }
  });
});
