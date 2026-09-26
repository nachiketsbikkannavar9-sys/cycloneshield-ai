import { useEffect, useState } from "react";
import type {
  CurrentWeatherResponse,
  ScenarioDashboardResponse,
} from "@cycloneshield/shared";
import { fetchCurrentWeather, fetchDashboardScenario } from "../../lib/api.js";

const defaultLocation = {
  latitude: 20.2961,
  longitude: 85.8245,
};

type DashboardDataState = {
  scenarioData: ScenarioDashboardResponse | null;
  weatherData: CurrentWeatherResponse | null;
  error: string | null;
  weatherError: string | null;
  loading: boolean;
};

export function useDashboardData(): DashboardDataState {
  const [state, setState] = useState<DashboardDataState>({
    scenarioData: null,
    weatherData: null,
    error: null,
    weatherError: null,
    loading: true,
  });

  useEffect(() => {
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      const [scenarioResult, weatherResult] = await Promise.allSettled([
        fetchDashboardScenario(controller.signal),
        fetchCurrentWeather(defaultLocation, controller.signal),
      ]);

      if (controller.signal.aborted) return;

      setState({
        scenarioData:
          scenarioResult.status === "fulfilled" ? scenarioResult.value : null,
        weatherData: weatherResult.status === "fulfilled" ? weatherResult.value : null,
        error:
          scenarioResult.status === "rejected"
            ? scenarioResult.reason instanceof Error
              ? scenarioResult.reason.message
              : "Scenario data unavailable"
            : null,
        weatherError:
          weatherResult.status === "rejected"
            ? weatherResult.reason instanceof Error
              ? weatherResult.reason.message
              : "Live weather unavailable"
            : null,
        loading: false,
      });
    };

    void load();
    return () => controller.abort();
  }, []);

  return state;
}
