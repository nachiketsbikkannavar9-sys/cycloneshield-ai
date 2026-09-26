import type { LucideIcon } from "lucide-react";

type StatusCardProps = {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: "cyan" | "amber" | "emerald" | "rose";
  badge?: string;
};

const toneClasses = {
  cyan: {
    icon: "bg-cyan-400/10 text-cyan-300 ring-cyan-300/20",
    value: "text-cyan-100",
    badge: "border-cyan-300/20 bg-cyan-300/10 text-cyan-200",
  },
  amber: {
    icon: "bg-amber-300/10 text-amber-200 ring-amber-300/20",
    value: "text-amber-100",
    badge: "border-amber-300/20 bg-amber-300/10 text-amber-200",
  },
  emerald: {
    icon: "bg-emerald-300/10 text-emerald-200 ring-emerald-300/20",
    value: "text-emerald-100",
    badge: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
  },
  rose: {
    icon: "bg-rose-300/10 text-rose-200 ring-rose-300/20",
    value: "text-rose-100",
    badge: "border-rose-300/20 bg-rose-300/10 text-rose-200",
  },
} as const;

export function StatusCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
  badge,
}: StatusCardProps) {
  const colors = toneClasses[tone];

  return (
    <article className="rounded-card border border-hairline bg-surface-card p-5 shadow-soft backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-xl p-2.5 ring-1 ${colors.icon}`}>
          <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
        </div>
        {badge ? (
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${colors.badge}`}>
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${colors.value}`}>
        {value}
      </p>
      <p className="mt-2 text-sm leading-5 text-slate-400">{detail}</p>
    </article>
  );
}
