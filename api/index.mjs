import { createApp } from "../apps/api/dist/app.js";
import {
  createDatabase,
  startSimulationRetentionSweep,
} from "../apps/api/dist/db/database.js";

// Build the database explicitly rather than letting createApp() default it, so
// the retention sweep can be attached to the same handle. Without this the
// sweep in src/server.ts never runs in production, because Vercel loads this
// module instead of src/server.ts.
const database = createDatabase();
startSimulationRetentionSweep(database);

const app = createApp(database);

export default app;
