import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  CloudRain,
  Filter,
  Gauge,
  RefreshCw,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Waves,
  Wind,
} from "lucide-react";
import type {
  InfrastructureAsset,
  InfrastructureRisk,
  RiskCategory,
  AnalysisResponse,
  SimulationRequest,
  SimulationResponse,
  Scenario,
} from "@cycloneshield/shared";
import { createSimulation, createSimulationAnalysis } from "../../lib/api.js";
import { formatFreshness, getPeakWind, titleCase } from "../../lib/format.js";
import {
  riskCategoryBadgeClasses,
  riskCategoryColors,
  riskCategoryForScore,
} from "../../lib/risk-colors.js";

type SimulationWorkspaceProps = {
  scenario: Scenario;
  assets: InfrastructureAsset[];
  selectedAssetId: string | null;
  onSelectAsset: (asset: InfrastructureAsset) => void;
  /**
   * Publishes the modeled per-asset risk so other surfaces (the dashboard
   * coverage snapshot) can report the same numbers this list renders, instead
   * of re-deriving a separate count from the seeded criticality attribute.
   */
  onInfrastructureChange?: (infrastructure: InfrastructureRisk[] | null) => void;
};

type SimulationParameterKey = Exclude<keyof SimulationRequest, "scenarioId">;
type RiskFilter = RiskCategory | "all";

type ParameterDefinition = {
  key: SimulationParameterKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  description: string;
  icon: typeof Wind;
};

const parameterDefinitions: ParameterDefinition[] = [
  {
    key: "windSpeedKph",
    label: "Wind speed",
    unit: "km/h",
    min: 40,
    max: 260,
    step: 5,
    description: "Peak modeled wind magnitude",
    icon: Wind,
  },
  {
    key: "rainfallMm",
    label: "Rainfall",
    unit: "mm",
    min: 0,
    max: 600,
    step: 10,
    description: "Scenario rainfall total",
    icon: CloudRain,
  },
  {
    key: "surgeMeters",
    label: "Storm surge",
    unit: "m",
    min: 0,
    max: 6,
    step: 0.1,
    description: "Coastal surge height",
    icon: Waves,
  },
  {
    key: "trackSpeedMultiplier",
    label: "Track speed",
    unit: "×",
    min: 0.5,
    max: 2,
    step: 0.05,
    description: "Movement speed multiplier",
    icon: Route,
  },
  {
    key: "exposureMultiplier",
    label: "Exposure",
    unit: "×",
    min: 0.5,
    max: 2,
    step: 0.05,
    description: "Scenario-wide exposure modifier",
    icon: Gauge,
  },
];

const riskFilters: Array<{ value: RiskFilter; label: string }> = [
  { value: "all", label: "All categories" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "moderate", label: "Moderate" },
  { value: "low", label: "Low" },
];

function formatParameterValue(value: number, step: number): string {
  return step < 1 ? value.toFixed(2) : String(Math.round(value));
}

function getDefaultParameters(scenario: Scenario): SimulationRequest {
  // The seeded profile is the source of truth. `windSpeedKph` falls back to the
  // track peak only if a scenario omits it, so the default view always reflects
  // the scenario's deliberate hazard balance.
  const seeded = scenario.defaultHazardValues;
  return {
    scenarioId: scenario.id,
    windSpeedKph: seeded?.windSpeedKph ?? getPeakWind(scenario.trackPoints),
    rainfallMm: seeded?.rainfallMm ?? 300,
    surgeMeters: seeded?.surgeMeters ?? 3,
    trackSpeedMultiplier: seeded?.trackSpeedMultiplier ?? 1,
    exposureMultiplier: seeded?.exposureMultiplier ?? 1,
  };
}

function ParameterControl({
  definition,
  value,
  onChange,
}: {
  definition: ParameterDefinition;
  value: number;
  onChange: (value: number) => void;
}) {
  const Icon = definition.icon;

  return (
    <label className="block rounded-xl border border-hairline bg-surface-inset p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-cyan-300" aria-hidden="true" />
          <span className="text-sm font-semibold text-slate-100">{definition.label}</span>
        </div>
        <span className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-xs font-semibold text-cyan-100">
          {formatParameterValue(value, definition.step)} {definition.unit}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{definition.description}</p>
      <input
        type="range"
        min={definition.min}
        max={definition.max}
        step={definition.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        // Drives the filled portion of the track in index.css; the wiring
        // (min/max/step/value/aria-label) is unchanged.
        style={
          {
            "--range-progress": `${
              ((value - definition.min) / (definition.max - definition.min)) * 100
            }%`,
          } as CSSProperties
        }
        className="mt-4 h-1.5 w-full cursor-pointer"
        aria-label={definition.label}
      />
      <div className="mt-2 flex justify-between text-[10px] text-slate-600">
        <span>{definition.min} {definition.unit}</span>
        <span>{definition.max} {definition.unit}</span>
      </div>
    </label>
  );
}

function FactorChart({ simulation }: { simulation: SimulationResponse | null }) {
  const data =
    simulation?.result.factorContributions.map((item) => {
      // Bar length is the weighted contribution to the overall score, but the
      // colour follows the factor's own 0-100 value: contributions are capped by
      // the risk weights (wind tops out at 30 points), so colouring by points
      // alone could never leave the low/moderate end of the scale.
      const category = riskCategoryForScore(item.normalizedScore);
      return {
        factor: item.label,
        contribution: item.contribution,
        ownScore: item.normalizedScore,
        category,
        color: riskCategoryColors[category],
      };
    }) ?? [];

  return (
    <div className="h-[250px] w-full">
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid horizontal={false} stroke="rgb(148 163 184 / 0.12)" />
            <XAxis
              type="number"
              domain={[0, 100]}
              tick={{ fill: "#64748b", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              unit=""
            />
            <YAxis
              type="category"
              dataKey="factor"
              tick={{ fill: "#cbd5e1", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={66}
            />
            <Tooltip
              cursor={{ fill: "rgb(148 163 184 / 0.06)" }}
              contentStyle={{
                background: "#020617",
                border: "1px solid rgb(103 232 249 / 0.2)",
                borderRadius: 10,
                color: "#e2e8f0",
                fontSize: 12,
              }}
              formatter={(value, name, item) => {
                const payload = item?.payload as { category?: RiskCategory; ownScore?: number } | undefined;
                const scale = payload?.category ? ` · ${payload.ownScore?.toFixed(0)}/100 own risk (${payload.category})` : "";
                return [`${Number(value).toFixed(1)} points${scale}`, "Contribution"];
              }}
            />
            <Bar dataKey="contribution" radius={[0, 5, 5, 0]}>
              {data.map((item) => (
                <Cell key={item.factor} fill={item.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="grid h-full place-items-center text-sm text-slate-500">
          Run a simulation to see factor contributions.
        </div>
      )}
    </div>
  );
}

function AdvisoryPanel({ analysis }: { analysis: AnalysisResponse }) {
  const providerLabel =
    analysis.provider === "gemini"
      ? `Gemini${analysis.model ? ` · ${analysis.model}` : ""}`
      : "Deterministic fallback";

  const fallbackDetail = analysis.fallbackUsed
    ? [
        analysis.fallbackReason ? analysis.fallbackReason.replace(/-/g, " ") : null,
        analysis.fallbackDetail?.httpStatus
          ? `HTTP ${analysis.fallbackDetail.httpStatus}`
          : null,
        analysis.fallbackDetail?.providerCode,
        analysis.fallbackDetail?.message,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · ")
    : "";

  return (
    <div
      className="mt-6 rounded-2xl border border-amber-300/25 bg-amber-300/5 p-4 sm:p-5"
      data-testid="advisory-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">
            <TriangleAlert size={15} aria-hidden="true" />
            SIMULATED ADVISORY — NOT AN OFFICIAL WARNING
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-100/70">
            <span>SIMULATED SCENARIO</span>
            <span className="text-amber-100/40">·</span>
            <span>{providerLabel}</span>
            {analysis.fallbackUsed ? (
              <span className="rounded-full border border-amber-200/20 px-2 py-0.5">Fallback active</span>
            ) : null}
          </div>
          {fallbackDetail ? (
            <p
              className="mt-2 font-mono text-[10px] leading-4 text-amber-100/60"
              data-testid="advisory-fallback-detail"
            >
              Fallback reason: {fallbackDetail}
            </p>
          ) : null}
        </div>
        <span className="rounded-full border border-amber-200/25 bg-amber-200/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-100">
          {analysis.advisory.severity}
        </span>
      </div>

      <h3 className="mt-4 text-xl font-semibold text-amber-50">{analysis.advisory.title}</h3>
      <p className="mt-2 text-sm leading-6 text-amber-100/85">{analysis.advisory.summary}</p>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200/70">Key findings</p>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-amber-50/85">
            {analysis.analysis.keyFindings.map((finding) => (
              <li key={finding} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                <span>{finding}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200/70">Priority assets</p>
          <div className="mt-2 space-y-2">
            {analysis.analysis.priorityAssets.map((asset) => (
              <div key={asset.assetId} className="rounded-xl border border-amber-100/10 bg-slate-950/25 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-amber-50">{asset.assetName}</span>
                  <span className="font-semibold text-amber-200">{asset.riskScore.toFixed(1)} · {asset.riskCategory}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-amber-100/65">{asset.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-amber-100/10 pt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200/70">Suggested planning actions</p>
        <ol className="mt-2 grid gap-2 text-sm leading-6 text-amber-50/85 sm:grid-cols-2">
          {analysis.analysis.recommendedActions.map((action, index) => (
            <li key={action} className="flex gap-2">
              <span className="font-semibold text-amber-200">{index + 1}.</span>
              <span>{action}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100/55">
        {analysis.advisory.disclaimer}
      </p>
    </div>
  );
}

export function SimulationWorkspace({
  scenario,
  assets,
  selectedAssetId,
  onSelectAsset,
  onInfrastructureChange,
}: SimulationWorkspaceProps) {
  const defaultParameters = useMemo(() => getDefaultParameters(scenario), [scenario]);
  const [parameters, setParameters] = useState<SimulationRequest>(defaultParameters);
  const [simulation, setSimulation] = useState<SimulationResponse | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCalculatedAt, setLastCalculatedAt] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  // Held in a ref so publishing results does not become an effect dependency:
  // an inline callback from the parent would otherwise re-run the simulation
  // on every render.
  const publishRef = useRef(onInfrastructureChange);

  useEffect(() => {
    publishRef.current = onInfrastructureChange;
  });

  useEffect(() => {
    setParameters(defaultParameters);
  }, [defaultParameters]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    analysisAbortRef.current?.abort();
    setAnalysis(null);
    setAnalysisError(null);
    setIsCalculating(true);
    setError(null);

    const timer = window.setTimeout(() => {
      void createSimulation(parameters, controller.signal)
        .then((response) => {
          if (cancelled) return;
          setSimulation(response);
          setLastCalculatedAt(response.createdAt);
          publishRef.current?.(response.result.infrastructure);
        })
        .catch((reason: unknown) => {
          if (cancelled || controller.signal.aborted) return;
          setError(reason instanceof Error ? reason.message : "Simulation unavailable");
          // Clear rather than leave the previous run's numbers on screen.
          publishRef.current?.(null);
        })
        .finally(() => {
          if (!cancelled) setIsCalculating(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [parameters]);

  useEffect(() => {
    return () => analysisAbortRef.current?.abort();
  }, []);

  const districts = useMemo(
    () => Array.from(new Set(assets.map((asset) => asset.district))).sort(),
    [assets],
  );
  const types = useMemo(
    () => Array.from(new Set(assets.map((asset) => asset.type))).sort(),
    [assets],
  );
  const infrastructure = simulation?.result.infrastructure ?? [];
  const filteredInfrastructure = infrastructure.filter((item) => {
    const matchesRisk = riskFilter === "all" || item.riskCategory === riskFilter;
    const matchesDistrict = districtFilter === "all" || item.district === districtFilter;
    const matchesType = typeFilter === "all" || item.type === typeFilter;
    return matchesRisk && matchesDistrict && matchesType;
  });

  const runAnalysis = async (): Promise<void> => {
    if (!simulation || isAnalyzing) return;
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const record = await createSimulationAnalysis(simulation.id, controller.signal);
      if (!controller.signal.aborted) setAnalysis(record);
    } catch (reason: unknown) {
      if (!controller.signal.aborted) {
        setAnalysisError(reason instanceof Error ? reason.message : "Advisory generation unavailable");
      }
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null;
        setIsAnalyzing(false);
      }
    }
  };

  const updateParameter = (key: SimulationParameterKey, value: number): void => {
    setParameters((current) => ({ ...current, [key]: value }));
  };

  const selectRiskAsset = (assetId: string): void => {
    const asset = assets.find((candidate) => candidate.id === assetId);
    if (!asset) return;
    onSelectAsset(asset);
    setExpandedAssetId((current) => (current === assetId ? null : assetId));
  };

  return (
    <section
      id="simulator"
      className="mt-6 rounded-card border border-accent/15 bg-surface-card p-5 shadow-soft sm:p-6"
      data-testid="simulation-workspace"
      data-recalculating={isCalculating}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-200">
            <SlidersHorizontal size={17} aria-hidden="true" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Scenario simulator</span>
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-100">Stress-test the planning model</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
            Change a control to recalculate explainable risk against the synthetic track and infrastructure inventory.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
              isCalculating
                ? "border-amber-300/20 bg-amber-300/10 text-amber-200"
                : "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
            }`}
          >
            <RefreshCw size={12} className={isCalculating ? "animate-spin" : ""} aria-hidden="true" />
            {isCalculating ? "Recalculating" : "Calculation ready"}
          </span>
          <button
            type="button"
            onClick={() => void runAnalysis()}
            disabled={!simulation || isAnalyzing}
            className="flex items-center gap-2 rounded-lg border border-amber-200/25 bg-amber-200/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:border-amber-200/45 disabled:cursor-not-allowed disabled:opacity-45"
            data-testid="generate-advisory"
          >
            <Sparkles size={13} aria-hidden="true" />
            {isAnalyzing ? "Generating advisory" : "Generate advisory"}
          </button>
          <button
            type="button"
            onClick={() => setParameters(defaultParameters)}
            className="rounded-lg border border-hairline px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-100"
          >
            Reset inputs
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.18fr)]">
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-100">Simulation controls</h3>
            <span className="text-xs text-slate-500">Changes persist for this session</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {parameterDefinitions.map((definition) => (
              <ParameterControl
                key={definition.key}
                definition={definition}
                value={parameters[definition.key]}
                onChange={(value) => updateParameter(definition.key, value)}
              />
            ))}
          </div>
        </div>

        <div className="min-w-0 rounded-card border border-hairline bg-surface-raised p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                <BarChart3 size={14} aria-hidden="true" />
                Explainable overall score
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="text-4xl font-semibold tracking-tight text-white" data-testid="overall-risk-score">
                  {simulation ? simulation.result.overallScore.toFixed(1) : "—"}
                </span>
                {simulation ? (
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${riskCategoryBadgeClasses[simulation.result.overallCategory]}`}>
                    {simulation.result.overallCategory}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/5 px-3 py-2 text-right">
              <div className="flex items-center justify-end gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">
                <ShieldCheck size={13} aria-hidden="true" />
                Confidence {simulation ? `${simulation.result.confidence.score.toFixed(0)}%` : "—"}
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                {simulation ? `${simulation.result.confidence.level} model confidence` : "Awaiting first run"}
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100/80">
            <div className="flex items-start gap-2">
              <Sparkles size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{simulation?.result.confidence.explanation ?? "Confidence is calculated from scenario and input completeness."}</span>
            </div>
          </div>
          <div className="mt-5">
            <FactorChart simulation={simulation} />
            <p className="mt-2 text-[11px] text-slate-500">
              Bar length is the factor&apos;s weighted contribution to the overall score;
              bar colour is that factor&apos;s own risk on the shared low → critical scale.
            </p>
          </div>
          {lastCalculatedAt ? (
            <p className="mt-2 text-right text-[11px] text-slate-500">
              Last recalculated {formatFreshness(lastCalculatedAt)} · simulation {simulation?.id.slice(0, 8)}
            </p>
          ) : null}
        </div>
      </div>

      <div id="advisory">
        {analysisError ? (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{analysisError}</span>
          </div>
        ) : null}
        {analysis ? (
          <AdvisoryPanel analysis={analysis} />
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-amber-200/20 bg-amber-200/[0.03] p-5" data-testid="advisory-empty">
            <div className="flex items-start gap-3">
              <Sparkles size={18} className="mt-0.5 shrink-0 text-amber-200" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-amber-50">Generate a simulated advisory</p>
                <p className="mt-1 text-sm leading-6 text-amber-100/65">
                  Analyze this saved simulation with Gemini when configured, or use the deterministic local fallback. The result always carries the simulated-warning boundary.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div id="infrastructure" className="mt-6 border-t border-hairline pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
              <Filter size={14} aria-hidden="true" />
              Infrastructure comparison
            </div>
            <p className="mt-1 text-sm text-slate-500">Filter modeled assets, then open any row to trace its score.</p>
          </div>
          <span className="text-xs text-slate-500">
            Showing {filteredInfrastructure.length} of {infrastructure.length} assets
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Risk category
            <select
              value={riskFilter}
              onChange={(event) => setRiskFilter(event.target.value as RiskFilter)}
              className="mt-2 w-full rounded-lg border border-hairline bg-slate-950/70 px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-slate-200 outline-none focus:border-cyan-300/40"
            >
              {riskFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            District
            <select
              value={districtFilter}
              onChange={(event) => setDistrictFilter(event.target.value)}
              className="mt-2 w-full rounded-lg border border-hairline bg-slate-950/70 px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-slate-200 outline-none focus:border-cyan-300/40"
            >
              <option value="all">All districts</option>
              {districts.map((district) => <option key={district} value={district}>{district}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Asset type
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="mt-2 w-full rounded-lg border border-hairline bg-slate-950/70 px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-slate-200 outline-none focus:border-cyan-300/40"
            >
              <option value="all">All asset types</option>
              {types.map((type) => <option key={type} value={type}>{titleCase(type)}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-hairline">
          {filteredInfrastructure.length > 0 ? (
            <div className="divide-y divide-white/10">
              {filteredInfrastructure.map((item) => {
                const expanded = expandedAssetId === item.assetId;
                return (
                  <div key={item.assetId} className={selectedAssetId === item.assetId ? "bg-cyan-300/5" : ""}>
                    <button
                      type="button"
                      onClick={() => selectRiskAsset(item.assetId)}
                      className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-white/5"
                      aria-expanded={expanded}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-100">{item.assetName}</span>
                        <span className="mt-1 block text-xs text-slate-500">{item.district} · {titleCase(item.type)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${riskCategoryBadgeClasses[item.riskCategory]}`}>
                          {item.riskCategory}
                        </span>
                        <span className="w-12 text-right text-sm font-semibold text-slate-100">{item.riskScore.toFixed(1)}</span>
                        {expanded ? <ChevronUp size={16} className="text-slate-500" aria-hidden="true" /> : <ChevronDown size={16} className="text-slate-500" aria-hidden="true" />}
                      </span>
                    </button>
                    {expanded ? (
                      <div className="border-t border-hairline bg-slate-950/35 px-4 py-4">
                        <div className="grid gap-3 lg:grid-cols-[1fr_0.8fr]">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Score drivers</p>
                            <ul className="mt-2 space-y-2">
                              {item.drivers.map((driver) => (
                                <li key={driver} className="text-xs leading-5 text-slate-300">{driver}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Factor trace</p>
                            <div className="mt-2 space-y-2">
                              {item.factorContributions.map((factor) => (
                                <div key={factor.factor} className="rounded-lg border border-hairline bg-white/[0.02] p-2.5">
                                  <div className="flex items-center justify-between gap-3 text-xs">
                                    <span className="font-semibold text-slate-200">{factor.label}</span>
                                    <span className="font-semibold text-cyan-200">{factor.contribution.toFixed(1)} pts</span>
                                  </div>
                                  <p className="mt-1 text-[11px] leading-4 text-slate-500">{factor.explanation}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-slate-500">No assets match the selected filters.</div>
          )}
        </div>
      </div>
    </section>
  );
}
