import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { seedOdishaScenario } from "../../../database/seed/odisha-scenario.js";

describe("database migrations and seed", () => {
  it("creates the schema and seeds the synthetic scenario", () => {
    const db = createDatabase(":memory:");
    seedOdishaScenario(db);
    seedOdishaScenario(db);

    const scenario = db
      .prepare("SELECT name, is_synthetic FROM scenarios WHERE id = ?")
      .get("scenario-nila-odisha-2026") as {
      name: string;
      is_synthetic: number;
    };
    const trackPointCount = db
      .prepare("SELECT COUNT(*) AS count FROM scenario_track_points")
      .get() as { count: number };
    const assetCount = db
      .prepare("SELECT COUNT(*) AS count FROM infrastructure_assets")
      .get() as { count: number };

    expect(scenario.is_synthetic).toBe(1);
    expect(scenario.name).toContain("Synthetic");
    expect(trackPointCount.count).toBe(6);
    expect(assetCount.count).toBe(8);

    db.close();
  });
});
