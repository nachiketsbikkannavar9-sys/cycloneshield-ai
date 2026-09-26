import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  calculateSimulation,
  simulationRequestSchema,
  simulationResponseSchema,
} from "@cycloneshield/shared";
import {
  getCurrentScenario,
  getInfrastructureAssets,
  getSimulation,
  insertSimulation,
} from "../db/queries.js";
import type { SqliteDatabase } from "../db/database.js";

export function createSimulationsRouter(db: SqliteDatabase): Router {
  const router = Router();

  router.post("/", (request, response) => {
    const parsed = simulationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "invalid-simulation-parameters",
        details: parsed.error.flatten(),
      });
      return;
    }

    const scenario = getCurrentScenario(db);
    if (!scenario || scenario.id !== parsed.data.scenarioId) {
      response.status(404).json({ error: "scenario-not-found" });
      return;
    }

    const assets = getInfrastructureAssets(db, scenario.id);
    const result = calculateSimulation({
      scenario,
      assets,
      request: parsed.data,
    });
    const payload = simulationResponseSchema.parse({
      id: randomUUID(),
      scenarioId: scenario.id,
      parameters: parsed.data,
      result,
      createdAt: new Date().toISOString(),
    });

    insertSimulation(db, payload);
    response.status(201).json(payload);
  });

  router.get("/:simulationId", (request, response) => {
    const simulation = getSimulation(db, request.params.simulationId);
    if (!simulation) {
      response.status(404).json({ error: "simulation-not-found" });
      return;
    }
    response.json(simulation);
  });

  return router;
}
