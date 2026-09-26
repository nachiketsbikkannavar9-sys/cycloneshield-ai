import {
  analysisResponseSchema,
  currentWeatherResponseSchema,
  scenarioDashboardResponseSchema,
  simulationResponseSchema,
  type AnalysisResponse,
  type CurrentWeatherResponse,
  type ScenarioDashboardResponse,
  type SimulationRequest,
  type SimulationResponse,
} from "@cycloneshield/shared";

export class ApiError extends Error {
  public readonly status: number;

  public constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.message ?? body.error ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

export async function fetchDashboardScenario(
  signal?: AbortSignal,
): Promise<ScenarioDashboardResponse> {
  const response = await fetch("/api/scenarios/current", { signal });
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return scenarioDashboardResponseSchema.parse(await response.json());
}

export async function fetchCurrentWeather(
  location: { latitude: number; longitude: number },
  signal?: AbortSignal,
): Promise<CurrentWeatherResponse> {
  const search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
  });
  const response = await fetch(`/api/weather/current?${search.toString()}`, { signal });
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return currentWeatherResponseSchema.parse(await response.json());
}

export async function createSimulation(
  parameters: SimulationRequest,
  signal?: AbortSignal,
): Promise<SimulationResponse> {
  const response = await fetch("/api/simulations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parameters),
    signal,
  });
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return simulationResponseSchema.parse(await response.json());
}

export async function createSimulationAnalysis(
  simulationId: string,
  signal?: AbortSignal,
): Promise<AnalysisResponse> {
  const response = await fetch(`/api/simulations/${simulationId}/analysis`, {
    method: "POST",
    signal,
  });
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return analysisResponseSchema.parse(await response.json());
}
