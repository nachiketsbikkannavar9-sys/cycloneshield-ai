import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { createDatabase, startSimulationRetentionSweep } from "./db/database.js";

const database = createDatabase();
// Bound the simulation history while the process runs, not just at boot.
const stopSweep = startSimulationRetentionSweep(database);

const app = createApp(database);

const server = app.listen(config.port, () => {
  console.log(`CycloneShield API listening on port ${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopSweep();
    server.close(() => process.exit(0));
  });
}
