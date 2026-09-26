import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, type SqliteDatabase } from "../src/db/database.js";
import { seedOdishaScenario } from "../src/db/seed.js";
import { getLatestAdvisory } from "../src/db/queries.js";
import type { AnalysisRuntime } from "../src/services/analysis.js";

let database: SqliteDatabase | null = null;

const baselineParameters = {
  scenarioId: "scenario-nila-odisha-2026",
  windSpeedKph: 175,
  rainfallMm: 300,
  surgeMeters: 3,
  trackSpeedMultiplier: 1,
  exposureMultiplier: 1,
};

function fallbackRuntime(): AnalysisRuntime {
  return {
    apiKey: null,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/interactions",
    model: "gemini-test",
    apiRevision: "2026-05-20",
    timeoutMs: 100,
    fetchImpl: async () => new Response("{}", { status: 200 }),
  };
}

async function createSimulation(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/api/simulations").send(baselineParameters);
  expect(response.status).toBe(201);
  return response.body as { id: string };
}

afterEach(() => {
  database?.close();
  database = null;
});

describe("analysis and advisory route", () => {
  it("generates and persists the deterministic advisory without an API key", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);
    const app = createApp(database, fallbackRuntime());
    const simulation = await createSimulation(app);

    const response = await request(app).post(
      `/api/simulations/${simulation.id}/analysis`,
    );

    expect(response.status).toBe(201);
    expect(response.body.provider).toBe("deterministic-fallback");
    expect(response.body.fallbackUsed).toBe(true);
    expect(response.body.fallbackReason).toBe("no-api-key");
    expect(response.body.advisory.disclaimer).toBe(
      "SIMULATED ADVISORY — NOT AN OFFICIAL WARNING",
    );
    expect(response.body.analysis.summary).toContain("SIMULATED SCENARIO");
    expect(response.body.analysis.priorityAssets.length).toBeGreaterThan(0);
    expect(response.body.advisory.actions.length).toBeGreaterThan(0);

    const persisted = await request(app).get(`/api/simulations/${simulation.id}/analysis`);
    expect(persisted.status).toBe(200);
    expect(persisted.body.id).toBe(response.body.id);
    expect(getLatestAdvisory(database, simulation.id)?.provider).toBe(
      "deterministic-fallback",
    );
  });

  it("uses structured Interactions API output when the provider succeeds", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);
    let requestBody: unknown;
    const output = {
      summary: "The exercise shows concentrated wind exposure near the coast.",
      keyFindings: ["Wind is the leading modeled factor."],
      priorityAssetIds: ["asset-puri-district-hospital"],
      recommendedActions: ["Review coastal facility continuity plans."],
    };
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as unknown;
      return new Response(
        JSON.stringify({
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: JSON.stringify(output) }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const app = createApp(database, {
      ...fallbackRuntime(),
      apiKey: "test-key",
      fetchImpl,
    });
    const simulation = await createSimulation(app);

    const response = await request(app).post(
      `/api/simulations/${simulation.id}/analysis`,
    );

    expect(response.status).toBe(201);
    expect(response.body.provider).toBe("gemini");
    expect(response.body.fallbackUsed).toBe(false);
    expect(response.body.analysis.priorityAssets[0].assetId).toBe(
      "asset-puri-district-hospital",
    );
    expect(response.body.advisory.summary).toContain("SIMULATED ADVISORY");
    expect(requestBody).toMatchObject({
      model: "gemini-test",
      system_instruction: expect.any(String),
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: expect.any(Object),
      },
    });
  });

  it("falls back when Gemini returns an unsafe operational claim", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "An official warning requires immediate evacuation.",
            keyFindings: ["Wind is elevated."],
            priorityAssetIds: [],
            recommendedActions: ["Evacuate everyone now."],
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const app = createApp(database, {
      ...fallbackRuntime(),
      apiKey: "test-key",
      fetchImpl,
    });
    const simulation = await createSimulation(app);

    const response = await request(app).post(
      `/api/simulations/${simulation.id}/analysis`,
    );

    expect(response.status).toBe(201);
    expect(response.body.provider).toBe("deterministic-fallback");
    expect(response.body.fallbackReason).toBe("unsafe-response");
    expect(response.body.fallbackDetail?.message).toContain("operational claim");
    expect(response.body.analysis.summary).toContain("SIMULATED SCENARIO");
  });

  it.each([
    [401, "API key not valid", "auth-failed"],
    [403, "PERMISSION_DENIED", "auth-failed"],
    [404, "models/x is not found", "model-unavailable"],
    [429, "Resource has been exhausted", "rate-limited"],
    [429, "Quota exceeded for quota metric", "quota-exceeded"],
    [402, "Payment required", "quota-exceeded"],
    [503, "The service is currently unavailable", "provider-unavailable"],
    [400, "Invalid JSON payload", "bad-request"],
    [400, "API_KEY_INVALID: API key not valid", "auth-failed"],
  ] as const)(
    "classifies HTTP %i as %s",
    async (status, message, expectedReason) => {
      database = createDatabase(":memory:");
      seedOdishaScenario(database);
      const fetchImpl: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            error: { code: status, status: "SOME_STATUS", message },
          }),
          { status, headers: { "content-type": "application/json" } },
        );
      const app = createApp(database, {
        ...fallbackRuntime(),
        apiKey: "test-key",
        fetchImpl,
      });
      const simulation = await createSimulation(app);

      const response = await request(app).post(
        `/api/simulations/${simulation.id}/analysis`,
      );

      expect(response.status).toBe(201);
      expect(response.body.fallbackUsed).toBe(true);
      expect(response.body.fallbackReason).toBe(expectedReason);
      expect(response.body.fallbackDetail.httpStatus).toBe(status);
      expect(response.body.fallbackDetail.message).toContain(message);
    },
  );

  it("never echoes the API key back in the fallback detail", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);
    const secret = "AIzaSyTESTKEY1234567890abcdef";
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message: `API key not valid: ${secret}. Please pass a valid API key.`,
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    const app = createApp(database, {
      ...fallbackRuntime(),
      apiKey: secret,
      fetchImpl,
    });
    const simulation = await createSimulation(app);

    const response = await request(app).post(
      `/api/simulations/${simulation.id}/analysis`,
    );

    expect(response.body.fallbackReason).toBe("auth-failed");
    expect(response.body.fallbackDetail.message).not.toContain(secret);
    expect(response.body.fallbackDetail.message).toContain("[redacted]");
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });

  it("reports a timeout separately from a transport failure", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);
    const fetchImpl: typeof fetch = async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    };
    const app = createApp(database, {
      ...fallbackRuntime(),
      apiKey: "test-key",
      fetchImpl,
    });
    const simulation = await createSimulation(app);

    const response = await request(app).post(
      `/api/simulations/${simulation.id}/analysis`,
    );

    expect(response.body.fallbackReason).toBe("timeout");
    expect(response.body.fallbackDetail.message).toContain("100 ms");
  });

  it("persists the fallback detail alongside the advisory", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({ error: { code: 401, status: "UNAUTHENTICATED", message: "API key not valid" } }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    const app = createApp(database, {
      ...fallbackRuntime(),
      apiKey: "test-key",
      fetchImpl,
    });
    const simulation = await createSimulation(app);
    await request(app).post(`/api/simulations/${simulation.id}/analysis`);

    const stored = getLatestAdvisory(database, simulation.id);
    expect(stored?.fallbackReason).toBe("auth-failed");
    expect(stored?.fallbackDetail?.httpStatus).toBe(401);
  });

  it("rejects missing simulations and invalid analysis requests", async () => {
    database = createDatabase(":memory:");
    seedOdishaScenario(database);
    const app = createApp(database, fallbackRuntime());

    const missing = await request(app).post("/api/analysis").send({
      simulationId: "simulation-missing",
    });
    const invalid = await request(app).post("/api/analysis").send({});

    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("simulation-not-found");
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("invalid-analysis-request");
  });
});
