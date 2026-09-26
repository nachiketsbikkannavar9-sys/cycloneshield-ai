import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);

export const config = {
  port: Number(process.env.PORT ?? 8787),
  databasePath:
    process.env.DATABASE_PATH ??
    (process.env.VERCEL
      ? "/tmp/cycloneshield.db"
      : resolve(projectRoot, "database/cycloneshield.db")),
  migrationsDirectory: resolve(projectRoot, "database/migrations"),
  openMeteoBaseUrl: process.env.OPEN_METEO_BASE_URL ?? "https://api.open-meteo.com",
  openMeteoTimeoutMs: Number(process.env.OPEN_METEO_TIMEOUT_MS ?? 10000),
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || null,
  geminiBaseUrl:
    process.env.GEMINI_BASE_URL ??
    "https://generativelanguage.googleapis.com/v1beta/interactions",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
  geminiApiRevision: process.env.GEMINI_API_REVISION ?? "2026-05-20",
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 120000),
};
