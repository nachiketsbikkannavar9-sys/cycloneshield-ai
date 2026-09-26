import { Router, type Request } from "express";
import {
  analysisRequestSchema,
  type AnalysisResponse,
} from "@cycloneshield/shared";
import { asyncHandler } from "../http/async-handler.js";
import { generateSimulationAnalysis, type AnalysisRuntime } from "../services/analysis.js";
import {
  getLatestAdvisory,
  getSimulation,
  insertAdvisory,
} from "../db/queries.js";
import type { SqliteDatabase } from "../db/database.js";

function getRouteParam(request: Request, name: string): string {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value;
}

async function analyzeAndPersist(
  db: SqliteDatabase,
  simulationId: string,
  runtime?: AnalysisRuntime,
): Promise<AnalysisResponse | null> {
  const simulation = getSimulation(db, simulationId);
  if (!simulation) return null;

  const record = await generateSimulationAnalysis(simulation, runtime);
  insertAdvisory(db, record);
  return record;
}

export function createAnalysisRouter(
  db: SqliteDatabase,
  runtime?: AnalysisRuntime,
): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (request, response) => {
      const parsed = analysisRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: "invalid-analysis-request",
          details: parsed.error.flatten(),
        });
        return;
      }

      const record = await analyzeAndPersist(db, parsed.data.simulationId, runtime);
      if (!record) {
        response.status(404).json({ error: "simulation-not-found" });
        return;
      }
      response.status(201).json(record);
    }),
  );

  router.post(
    "/:simulationId",
    asyncHandler(async (request, response) => {
      const record = await analyzeAndPersist(db, getRouteParam(request, "simulationId"), runtime);
      if (!record) {
        response.status(404).json({ error: "simulation-not-found" });
        return;
      }
      response.status(201).json(record);
    }),
  );

  router.get("/:simulationId", (request, response) => {
    const record = getLatestAdvisory(db, getRouteParam(request, "simulationId"));
    if (!record) {
      response.status(404).json({ error: "advisory-not-found" });
      return;
    }
    response.json(record);
  });

  return router;
}

export function createSimulationAnalysisRouter(
  db: SqliteDatabase,
  runtime?: AnalysisRuntime,
): Router {
  const router = Router();

  router.post(
    "/:simulationId/analysis",
    asyncHandler(async (request, response) => {
      const record = await analyzeAndPersist(db, getRouteParam(request, "simulationId"), runtime);
      if (!record) {
        response.status(404).json({ error: "simulation-not-found" });
        return;
      }
      response.status(201).json(record);
    }),
  );

  router.get("/:simulationId/analysis", (request, response) => {
    const record = getLatestAdvisory(db, getRouteParam(request, "simulationId"));
    if (!record) {
      response.status(404).json({ error: "advisory-not-found" });
      return;
    }
    response.json(record);
  });

  return router;
}
