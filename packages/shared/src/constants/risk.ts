export const riskWeights = {
  wind: 0.3,
  surge: 0.25,
  rainfall: 0.2,
  flood: 0.15,
  access: 0.1,
} as const;

export const riskCategories = ["low", "moderate", "high", "critical"] as const;

export type RiskCategory = (typeof riskCategories)[number];
