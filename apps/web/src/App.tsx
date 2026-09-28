import { useEffect, useState } from "react";
import type { InfrastructureRisk } from "@cycloneshield/shared";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  CloudSun,
  Database,
  Gauge,
  Map as MapIcon,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wind,
} from "lucide-react";
import { AssetDrawer } from "./components/asset-drawer.js";
import { ScenarioMap } from "./components/scenario-map.js";
import { StatusCard } from "./components/status-card.js";
import { useDashboardData } from "./features/dashboard/use-dashboard-data.js";
import { SimulationWorkspace } from "./features/dashboard/simulation-workspace.js";
import {
  formatFreshness,
  formatIstDate,
  formatIstDateTime,
  formatNumber,
  getPeakWind,
  titleCase,
} from "./lib/format.js";

const navigationSections = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "map", label: "Map", icon: MapIcon },
  { id: "simulator", label: "Simulator", icon: SlidersHorizontal },
  { id: "infrastructure", label: "Infrastructure", icon: Building2 },
  { id: "advisory", label: "Advisory", icon: Sparkles },
] as const;

function useActiveSection(): string {
  const [activeId, setActiveId] = useState<string>(navigationSections[0].id);

  useEffect(() => {
    const targets = navigationSections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -60% 0px", threshold: 0 },
    );

    targets.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return activeId;
}

function AppLoading() {
  return (
    <div className="min-h-screen bg-[#07111f] px-5 py-6 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-[1600px] animate-pulse space-y-6">
        <div className="h-16 rounded-2xl border border-white/10 bg-slate-900/70" />
        <div className="h-64 rounded-3xl border border-white/10 bg-slate-900/70" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-40 rounded-2xl border border-white/10 bg-slate-900/70" />
          ))}
        </div>
      </div>
    </div>
  );
}

function AppError({ message }: { message: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#07111f] px-6 text-slate-100">
      <section className="max-w-lg rounded-3xl border border-rose-300/20 bg-slate-900/80 p-8 text-center shadow-soft">
        <AlertTriangle className="mx-auto text-amber-300" size={32} />
        <h1 className="mt-5 text-2xl font-semibold">Scenario workspace unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">{message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
        >
          Retry connection
        </button>
      </section>
    </main>
  );
}

export function App() {
  const { scenarioData, weatherData, error, weatherError, loading } = useDashboardData();
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [infrastructure, setInfrastructure] = useState<InfrastructureRisk[] | null>(null);
  const activeSection = useActiveSection();

  if (loading) return <AppLoading />;
  if (error || !scenarioData) {
    return <AppError message={error ?? "The seeded scenario could not be loaded."} />;
  }

  const { scenario, assets, source } = scenarioData;
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const peakWind = getPeakWind(scenario.trackPoints);
  const lastTrackPoint = scenario.trackPoints[scenario.trackPoints.length - 1];
  const districts = new Set(assets.map((asset) => asset.district)).size;
  // Counted from the modeled simulation result, not from the seeded
  // `criticality` attribute. Those are different concepts: criticality is a
  // static planning role, while the infrastructure list renders riskCategory
  // derived from the current parameters, so counting criticality here made the
  // snapshot disagree with the list it summarises. Null until the first
  // simulation resolves, so no stale number is ever shown.
  const elevatedAssets = infrastructure
    ? infrastructure.filter(
        (item) => item.riskCategory === "high" || item.riskCategory === "critical",
      ).length
    : null;
  const weatherValue = weatherData
    ? `${Math.round(weatherData.current.windKph ?? 0)} km/h`
    : "Unavailable";
  const weatherDetail = weatherData
    ? `${weatherData.source.label} · ${formatFreshness(weatherData.source.fetchedAt)}`
    : weatherError ?? "Live context unavailable";
  const mapStatus = weatherData ? "Live context attached" : "Scenario map active";

  return (
    <div className="min-h-screen bg-[#07111f] text-slate-100">
      <header className="border-b border-white/10 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-500/20">
              <ShieldCheck size={22} strokeWidth={2.2} aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-[0.2em] text-slate-100">CYCLONESHIELD AI</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Odisha preparedness workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-xs font-medium text-slate-400 md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.8)]" />
              Workspace online
            </span>
            <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-200 sm:px-3 sm:py-1.5 sm:text-[10px] sm:tracking-[0.18em]">
              Simulated scenario
            </span>
          </div>
        </div>
      </header>

      <nav
        aria-label="Section navigation"
        className="sticky top-0 z-[1000] border-b border-white/10 bg-slate-950/90 backdrop-blur"
      >
        <div className="mx-auto flex max-w-[1600px] items-center gap-1 overflow-x-auto px-5 py-2 sm:px-8">
          {navigationSections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <a
                key={section.id}
                href={`#${section.id}`}
                aria-current={isActive ? "true" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                  isActive
                    ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                    : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-slate-100"
                }`}
              >
                <Icon size={13} aria-hidden="true" />
                {section.label}
              </a>
            );
          })}
        </div>
      </nav>

      <main className="mx-auto max-w-[1600px] px-5 py-7 sm:px-8 lg:py-9">
        <section
          id="dashboard"
          className="relative overflow-hidden rounded-3xl border border-cyan-300/15 bg-[radial-gradient(circle_at_85%_20%,rgba(14,165,233,0.18),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(8,47,73,0.72))] p-6 shadow-soft sm:p-9"
        >
          <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full border border-cyan-200/10 bg-cyan-300/5 blur-2xl" />
          <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200">
                <span className="rounded-full border border-cyan-200/20 bg-cyan-200/10 px-3 py-1.5">
                  Scenario overview
                </span>
                <span className="text-slate-500">/</span>
                <span>Coastal Odisha</span>
              </div>
              <h1 className="mt-5 max-w-4xl text-3xl font-semibold tracking-[-0.03em] text-white sm:text-5xl">
                See the storm. Understand the exposure.
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">
                {scenario.name} is a synthetic preparedness exercise. Use the map to trace
                the modeled approach, compare impact zones, and inspect the infrastructure
                that may need attention first.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 text-xs font-medium text-slate-300">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">{scenario.slug}</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">{assets.length} seeded assets</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Updated {formatFreshness(source.fetchedAt)}</span>
              </div>
            </div>
            <div className="rounded-2xl border border-amber-200/15 bg-amber-200/5 p-5">
              <div className="flex items-center gap-2 text-amber-200">
                <AlertTriangle size={17} aria-hidden="true" />
                <span className="text-[10px] font-bold uppercase tracking-[0.18em]">Planning boundary</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-amber-100/80">
                This view is for preparedness planning and demonstrations. It is not an
                official forecast, warning, or evacuation instruction.
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-amber-100">
                <Database size={14} aria-hidden="true" />
                {source.detail}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Scenario status">
          <StatusCard
            label="Scenario state"
            value="Seeded exercise"
            detail={`${titleCase(scenario.slug)} · ${formatFreshness(source.fetchedAt)}`}
            icon={Database}
            tone="amber"
            badge="Synthetic"
          />
          <StatusCard
            label="Peak modeled wind"
            value={`${peakWind} km/h`}
            detail={`${lastTrackPoint?.pressureHpa ?? "—"} hPa modeled minimum pressure`}
            icon={Wind}
            tone="rose"
            badge="P0 scenario"
          />
          <StatusCard
            label="Modeled landfall"
            value={formatIstDate(scenario.landfallAt)}
            detail={`${formatIstDateTime(scenario.landfallAt)} · coastal crossing`}
            icon={CalendarClock}
            tone="cyan"
            badge="Synthetic"
          />
          <StatusCard
            label="Live context"
            value={weatherValue}
            detail={weatherDetail}
            icon={CloudSun}
            tone={weatherData ? "emerald" : "amber"}
            badge={weatherData ? "Open-Meteo" : "Fallback"}
          />
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div
            id="map"
            className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/65 p-3 shadow-soft sm:p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 px-2 pb-4 pt-1 sm:px-3">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200">
                  <MapIcon size={14} aria-hidden="true" />
                  Scenario map
                </div>
                <h2 className="mt-2 text-xl font-semibold text-slate-100">Odisha exposure overview</h2>
                <p className="mt-1 text-sm text-slate-500">Track, hazard zones, and seeded infrastructure in one view.</p>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
                <Radio size={14} className="text-emerald-300" aria-hidden="true" />
                {mapStatus}
              </div>
            </div>
            <ScenarioMap
              scenario={scenario}
              assets={assets}
              selectedAssetId={selectedAssetId}
              onSelectAsset={(asset) => setSelectedAssetId(asset.id)}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-1 pt-4 text-xs text-slate-500 sm:px-3">
              <span>Map tiles © OpenStreetMap · scenario geometry is synthetic</span>
              <span className="flex items-center gap-1.5 text-emerald-300/80">
                <CheckCircle2 size={14} aria-hidden="true" />
                Seeded geometry validated
              </span>
            </div>
          </div>

          <AssetDrawer asset={selectedAsset} onClose={() => setSelectedAssetId(null)} />
        </section>

        <SimulationWorkspace
          scenario={scenario}
          assets={assets}
          selectedAssetId={selectedAssetId}
          onSelectAsset={(asset) => setSelectedAssetId(asset.id)}
          onInfrastructureChange={setInfrastructure}
        />

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-white/10 bg-slate-900/65 p-6 shadow-soft">
            <div className="flex items-center gap-2 text-cyan-200">
              <Sparkles size={17} aria-hidden="true" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em]">How to read this view</span>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-300/10 text-sm font-bold text-cyan-200">01</div>
                <h3 className="mt-4 text-sm font-semibold text-slate-100">Follow the track</h3>
                <p className="mt-2 text-sm leading-5 text-slate-400">The cyan path and points show modeled intensity over time.</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-300/10 text-sm font-bold text-amber-200">02</div>
                <h3 className="mt-4 text-sm font-semibold text-slate-100">Compare zones</h3>
                <p className="mt-2 text-sm leading-5 text-slate-400">Hazard circles show where wind, surge, rain, or access effects may concentrate.</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-300/10 text-sm font-bold text-rose-200">03</div>
                <h3 className="mt-4 text-sm font-semibold text-slate-100">Inspect assets</h3>
                <p className="mt-2 text-sm leading-5 text-slate-400">Select a marker to see the planning role and baseline vulnerability.</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/65 p-6 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-violet-200">
                <Gauge size={17} aria-hidden="true" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Coverage snapshot</span>
              </div>
              <ArrowUpRight size={16} className="text-slate-500" aria-hidden="true" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                <p className="text-2xl font-semibold text-slate-100">{districts}</p>
                <p className="mt-1 text-xs text-slate-500">districts represented</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                <p className="text-2xl font-semibold text-rose-100">
                  {elevatedAssets ?? "—"}
                </p>
                <p className="mt-1 text-xs text-slate-500">high / critical assets</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                <p className="text-2xl font-semibold text-cyan-100">{scenario.impactZones.length}</p>
                <p className="mt-1 text-xs text-slate-500">modeled hazard zones</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                <p className="text-2xl font-semibold text-amber-100">{formatNumber(peakWind)}</p>
                <p className="mt-1 text-xs text-slate-500">peak wind km/h</p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
              <Activity size={14} className="text-emerald-300" aria-hidden="true" />
              Scenario inputs are ready for the simulation workflow.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
