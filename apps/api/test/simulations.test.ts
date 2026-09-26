import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, type SqliteDatabase } from "../src/db/database.js";
import { seedOdishaScenario } from "../../../database/seed/odisha-scenario.js";

let database: SqliteDatabase | null = null;

const baselineParameters = {
  scenarioId: "scenario-nila-odisha-2026",
  windSpeedKph: 175,
  rainfallMm: 300,
  surgeMeters: 3,
  trackSpeedMultiplier: 1,
  exposureMultiplier: 1,
};

afterEach(() => {
  database?.close();
  database = null;
});

describe("simulation route", () => {
  it("calculates, persists, and returns an explainable simulation", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);
    const app = createApp(database);

    const response = await request(app).post("/api/simulations").send(baselineParameters);

    expect(response.status).toBe(201);
    expect(response.body.id).toEqual(expect.any(String));
    expect(response.body.scenarioId).toBe(baselineParameters.scenarioId);
    expect(response.body.result.calculationVersion).toBe("risk-engine-v1");
    expect(response.body.result.factorContributions).toHaveLength(5);
    expect(response.body.result.infrastructure).toHaveLength(8);
    expect(response.body.result.infrastructure[0].drivers.length).toBeGreaterThan(0);

    const persisted = await request(app).get(`/api/simulations/${response.body.id}`);
    expect(persisted.status).toBe(200);
    expect(persisted.body.id).toBe(response.body.id);
    expect(persisted.body.result.overallScore).toBe(response.body.result.overallScore);
  });

  it("recalculates when simulator parameters change", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);
    const app = createApp(database);

    const baseline = await request(app).post("/api/simulations").send(baselineParameters);
    const intensified = await request(app).post("/api/simulations").send({
      ...baselineParameters,
      windSpeedKph: 250,
      rainfallMm: 600,
      surgeMeters: 6,
      trackSpeedMultiplier: 2,
      exposureMultiplier: 2,
    });

    expect(baseline.status).toBe(201);
    expect(intensified.status).toBe(201);
    expect(intensified.body.result.overallScore).toBeGreaterThan(
      baseline.body.result.overallScore,
    );
  });

  it("rejects invalid parameters and unknown scenarios", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);
    const app = createApp(database);

    const invalid = await request(app).post("/api/simulations").send({
      ...baselineParameters,
      windSpeedKph: -1,
    });
    const unknown = await request(app).post("/api/simulations").send({
      ...baselineParameters,
      scenarioId: "scenario-missing",
    });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("invalid-simulation-parameters");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("scenario-not-found");
  });
});
