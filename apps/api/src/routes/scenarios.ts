import { Router } from "express";
import {
  scenarioDashboardResponseSchema,
  type SourceStatus,
} from "@cycloneshield/shared";
import { getCurrentScenario, getInfrastructureAssets } from "../db/queries.js";
import type { SqliteDatabase } from "../db/database.js";

export function createScenariosRouter(db: SqliteDatabase): Router {
  const router = Router();

  router.get("/current", (_request, response) => {
    const scenario = getCurrentScenario(db);
    if (!scenario) {
      response.status(404).json({ error: "scenario-not-found" });
      return;
    }

    const source: SourceStatus = {
      id: "seeded-scenario",
      label: "Seeded Odisha scenario",
      kind: "synthetic-scenario",
      status: "seeded",
      fetchedAt: scenario.createdAt,
      detail: scenario.provenance,
    };

    const payload = scenarioDashboardResponseSchema.parse({
      scenario,
      assets: getInfrastructureAssets(db, scenario.id),
      source,
    });
    response.json(payload);
  });

  return router;
}
