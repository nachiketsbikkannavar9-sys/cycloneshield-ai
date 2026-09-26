import { createDatabase } from "./database.js";

const db = createDatabase();

console.log(
  JSON.stringify({
    status: "ready",
    message: "Use npm run db:seed to load the synthetic Odisha scenario.",
  }),
);

db.close();
