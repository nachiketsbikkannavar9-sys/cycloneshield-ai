import { createDatabase } from "../apps/api/src/db/database.js";
import {
  odishaScenarioId,
  seedOdishaScenario,
} from "../database/seed/odisha-scenario.js";

const db = createDatabase();
seedOdishaScenario(db);

const scenario = db
  .prepare("SELECT id, name, is_synthetic FROM scenarios WHERE id = ?")
  .get(odishaScenarioId);

console.log(JSON.stringify({ scenario }));
db.close();
