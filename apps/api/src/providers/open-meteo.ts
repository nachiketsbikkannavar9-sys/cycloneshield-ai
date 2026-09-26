import { z } from "zod";
import { openMeteoForecastSchema, type OpenMeteoForecast } from "@cycloneshield/shared";

const elevationResponseSchema = z.object({
  elevation: z.array(z.number()),
});

export type OpenMeteoRequestOptions = {
  latitude: number;
  longitude: number;
  forecastDays?: number;
  pastDays?: number;
};

export type OpenMeteoClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

export class OpenMeteoClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  public constructor(options: OpenMeteoClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://api.open-meteo.com";
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.fetcher = options.fetcher ?? fetch;
  }

  public async getForecast(options: OpenMeteoRequestOptions): Promise<OpenMeteoForecast> {
    const url = new URL("/v1/forecast", this.baseUrl);
    url.searchParams.set("latitude", String(options.latitude));
    url.searchParams.set("longitude", String(options.longitude));
    url.searchParams.set("hourly", [
      "temperature_2m",
      "precipitation",
      "rain",
      "wind_speed_10m",
      "wind_gusts_10m",
      "wind_direction_10m",
    ].join(","));
    url.searchParams.set("forecast_days", String(options.forecastDays ?? 7));
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("wind_speed_unit", "kmh");

    const response = await this.fetchJson(url);
    return openMeteoForecastSchema.parse(response);
  }

  public async getElevation(
    options: Pick<OpenMeteoRequestOptions, "latitude" | "longitude">,
  ): Promise<number[]> {
    const url = new URL("/v1/elevation", this.baseUrl);
    url.searchParams.set("latitude", String(options.latitude));
    url.searchParams.set("longitude", String(options.longitude));

    const response = elevationResponseSchema.parse(await this.fetchJson(url));
    return response.elevation;
  }

  public async checkAvailability(): Promise<boolean> {
    try {
      await this.getElevation({ latitude: 20.2961, longitude: 85.8245 });
      return true;
    } catch {
      return false;
    }
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Open-Meteo request failed with status ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Open-Meteo request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function getOpenMeteoDescriptor() {
  return {
    id: "open-meteo",
    label: "Open-Meteo",
    kind: "live-weather-and-elevation" as const,
    documentation: "https://open-meteo.com/en/docs",
    cycloneTrackSupport: false,
    stormSurgeSupport: false,
    officialWarningSupport: false,
  };
}
