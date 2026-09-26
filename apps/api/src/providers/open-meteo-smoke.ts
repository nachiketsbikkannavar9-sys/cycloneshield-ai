import { OpenMeteoClient } from "./open-meteo.js";

const client = new OpenMeteoClient({ timeoutMs: 15000 });
const location = { latitude: 20.2961, longitude: 85.8245 };

try {
  const [forecast, elevation] = await Promise.all([
    client.getForecast({ ...location, forecastDays: 1 }),
    client.getElevation(location),
  ]);

  console.log(
    JSON.stringify({
      source: "open-meteo",
      status: "ok",
      location,
      timezone: forecast.timezone,
      elevationMeters: elevation[0] ?? null,
      firstHour: forecast.hourly.time[0] ?? null,
    }),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown Open-Meteo error";
  console.error(JSON.stringify({ source: "open-meteo", status: "error", message }));
  process.exitCode = 1;
}
