import { createDatabase } from "./database.js";
import { config } from "../config/env.js";

const db = createDatabase();
const count = db
  .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
  .get() as { count: number };

console.log(
  JSON.stringify({
    database: config.databasePath,
    migrations: count.count,
  }),
);

db.close();
