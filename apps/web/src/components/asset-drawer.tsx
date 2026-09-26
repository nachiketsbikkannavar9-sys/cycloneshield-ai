import {
  Building2,
  CalendarDays,
  MapPin,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import type { InfrastructureAsset } from "@cycloneshield/shared";
import { formatNumber, titleCase } from "../lib/format.js";

type AssetDrawerProps = {
  asset: InfrastructureAsset | null;
  onClose: () => void;
};

const criticalityClasses: Record<InfrastructureAsset["criticality"], string> = {
  low: "border-slate-300/20 bg-slate-300/10 text-slate-200",
  medium: "border-sky-300/20 bg-sky-300/10 text-sky-200",
  high: "border-amber-300/20 bg-amber-300/10 text-amber-200",
  critical: "border-rose-300/20 bg-rose-300/10 text-rose-200",
};

export function AssetDrawer({ asset, onClose }: AssetDrawerProps) {
  if (!asset) {
    return (
      <aside className="flex min-h-[420px] flex-col justify-between rounded-2xl border border-white/10 bg-slate-900/75 p-6 shadow-soft">
        <div>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-300/20">
            <MapPin size={21} aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-xl font-semibold text-slate-100">Select an asset</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Choose a marker on the scenario map to inspect its modeled role, location,
            and vulnerability context.
          </p>
        </div>
        <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/5 p-4 text-sm text-cyan-100/80">
          Assets are synthetic preparedness inputs, not live operational inventories.
        </div>
      </aside>
    );
  }

  return (
    <aside className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-300/20">
          <Building2 size={21} aria-hidden="true" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close asset details"
          className="rounded-lg p-2 text-slate-500 transition hover:bg-white/5 hover:text-slate-100"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${criticalityClasses[asset.criticality]}`}>
          {asset.criticality} criticality
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
          {titleCase(asset.type)}
        </span>
      </div>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-100">
        {asset.name}
      </h2>
      <p className="mt-2 flex items-center gap-2 text-sm text-slate-400">
        <MapPin size={15} className="text-cyan-300" aria-hidden="true" />
        {asset.district} · {asset.location.latitude.toFixed(3)}, {asset.location.longitude.toFixed(3)}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Capacity</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">{formatNumber(asset.capacity)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Population</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">{formatNumber(asset.populationServed)}</p>
        </div>
      </div>

      <div className="mt-6 space-y-4 border-t border-white/10 pt-5">
        <div className="flex items-start gap-3">
          <ShieldAlert size={17} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Vulnerability index</p>
            <p className="mt-1 text-sm text-slate-200">{Math.round(asset.vulnerabilityScore * 100)} / 100 modeled baseline</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Users size={17} className="mt-0.5 shrink-0 text-cyan-300" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Planning role</p>
            <p className="mt-1 text-sm leading-6 text-slate-300">{asset.notes}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <CalendarDays size={17} className="mt-0.5 shrink-0 text-violet-300" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Data status</p>
            <p className="mt-1 text-sm leading-6 text-slate-300">Seeded planning input · review during scenario simulation.</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
