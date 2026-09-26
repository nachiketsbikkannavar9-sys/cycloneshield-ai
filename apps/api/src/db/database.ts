import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config/env.js";
import { seedOdishaScenario } from "./seed.js";
import { pruneOldSimulations } from "./queries.js";

export type SqliteDatabase = Database.Database;

export function createDatabase(filename = config.databasePath): SqliteDatabase {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  applyMigrations(db, config.migrationsDirectory);
  // Re-seed on every boot rather than only when the row is missing. The seed
  // owns all reference data (scenario, track, zones, assets) and is idempotent,
  // so this keeps a long-lived database file from serving a scenario that has
  // drifted from the code -- previously an existing row was never refreshed, so
  // a seed edit (new defaults, revised summary) silently did not take effect.
  // Simulations and advisories live in their own tables and are untouched.
  seedOdishaScenario(db);
  return db;
}

/** How often the simulation history is trimmed while the process is running. */
export const SIMULATION_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Start periodic trimming of the simulation history.
 *
 * Every recalculation writes a row (the UI recalculates on a 250ms debounce
 * while a slider is dragged) and nothing ever reads the history back, so a
 * long-running process would otherwise grow without bound.
 *
 * NOTE: a boot-time prune is not sufficient on its own -- re-seeding deletes the
 * scenario row and `simulations.scenario_id` is ON DELETE CASCADE, so every
 * restart already clears the table. Trimming during runtime is what actually
 * bounds growth within a single long-lived process.
 *
 * Returns a stop function. The interval is unref'd so it never holds the
 * process open.
 */
export function startSimulationRetentionSweep(
  db: SqliteDatabase,
  intervalMs = SIMULATION_SWEEP_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    try {
      const removed = pruneOldSimulations(db);
      if (removed > 0) {
        console.log(`[retention] pruned ${removed} simulation row(s) older than 24h`);
      }
    } catch (error) {
      // Never let a maintenance failure take the API down.
      console.error("[retention] simulation sweep failed", error);
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function applyMigrations(
  db: SqliteDatabase,
  migrationsDirectory = config.migrationsDirectory,
): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = db
    .prepare("SELECT filename FROM schema_migrations")
    .all() as Array<{ filename: string }>;
  const appliedFiles = new Set(applied.map(({ filename }) => filename));
  const migrationFiles = fs
    .readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const executed: string[] = [];

  for (const filename of migrationFiles) {
    if (appliedFiles.has(filename)) continue;
    const sql = fs.readFileSync(path.join(migrationsDirectory, filename), "utf8");
    const runMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (filename) VALUES (?)").run(filename);
    });
    runMigration();
    executed.push(filename);
  }

  return executed;
}
