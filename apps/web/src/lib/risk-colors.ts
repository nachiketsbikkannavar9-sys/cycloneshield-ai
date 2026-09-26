import { getRiskCategory, type Criticality, type RiskCategory } from "@cycloneshield/shared";

/**
 * Single four-colour risk scale shared by the infrastructure list, the factor
 * chart, impact-zone circles and asset markers so every surface encodes risk
 * the same way: low green, moderate blue, high amber, critical red.
 */
export const riskCategoryColors: Record<RiskCategory, string> = {
  low: "#34d399",
  moderate: "#38bdf8",
  high: "#fbbf24",
  critical: "#fb7185",
};

export const riskCategoryLabels: Record<RiskCategory, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  critical: "Critical",
};

export const riskCategoryBadgeClasses: Record<RiskCategory, string> = {
  low: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
  moderate: "border-sky-300/20 bg-sky-300/10 text-sky-200",
  high: "border-amber-300/20 bg-amber-300/10 text-amber-200",
  critical: "border-rose-300/20 bg-rose-300/10 text-rose-200",
};

export const riskCategoryOrder: RiskCategory[] = ["low", "moderate", "high", "critical"];

/** Map markers carry baseline criticality; render it on the shared risk scale. */
export const criticalityRiskCategory: Record<Criticality, RiskCategory> = {
  low: "low",
  medium: "moderate",
  high: "high",
  critical: "critical",
};

export function riskCategoryForScore(score: number): RiskCategory {
  return getRiskCategory(score);
}
