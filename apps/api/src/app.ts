import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { createDatabase, type SqliteDatabase } from "./db/database.js";
import { dataSourcesRouter } from "./routes/data-sources.js";
import {
  createAnalysisRouter,
  createSimulationAnalysisRouter,
} from "./routes/analysis.js";
import { createScenariosRouter } from "./routes/scenarios.js";
import { createSimulationsRouter } from "./routes/simulations.js";
import { createWeatherRouter } from "./routes/weather.js";
import type { AnalysisRuntime } from "./services/analysis.js";

export function createApp(
  database: SqliteDatabase = createDatabase(),
  analysisRuntime?: AnalysisRuntime,
) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get(["/health", "/api/health"], (_request, response) => {
    response.json({
      status: "ok",
      service: "cycloneshield-api",
      version: "0.1.0",
      dataMode: "synthetic-scenario-with-live-weather",
    });
  });

  app.use("/api/data-sources", dataSourcesRouter);
  app.use("/api/scenarios", createScenariosRouter(database));
  app.use("/api/simulations", createSimulationsRouter(database));
  app.use("/api/analysis", createAnalysisRouter(database, analysisRuntime));
  app.use("/api/simulations", createSimulationAnalysisRouter(database, analysisRuntime));
  app.use("/api/weather", createWeatherRouter());

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: "internal-server-error" });
  };
  app.use(errorHandler);

  return app;
}
