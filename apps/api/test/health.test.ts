import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/database.js";

describe("health route", () => {
  it("reports service health and data mode", async () => {
    const database = createDatabase(":memory:");
    const response = await request(createApp(database)).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.dataMode).toBe("synthetic-scenario-with-live-weather");
    database.close();
  });

  it("lists the live data source without claiming cyclone support", async () => {
    const database = createDatabase(":memory:");
    const response = await request(createApp(database)).get("/api/data-sources");

    expect(response.status).toBe(200);
    expect(response.body.sources[0].id).toBe("open-meteo");
    expect(response.body.sources[0].cycloneTrackSupport).toBe(false);
    database.close();
  });
});
