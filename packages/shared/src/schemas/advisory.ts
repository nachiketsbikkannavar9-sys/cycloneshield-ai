import { z } from "zod";

export const SIMULATED_ADVISORY_DISCLAIMER =
  "SIMULATED ADVISORY — NOT AN OFFICIAL WARNING";
export const SIMULATED_SCENARIO_BANNER = "SIMULATED SCENARIO";

export const advisorySeveritySchema = z.enum(["info", "watch", "warning"]);

export const advisorySchema = z.object({
  id: z.string().min(1),
  simulationId: z.string().min(1),
  severity: advisorySeveritySchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  actions: z.array(z.string().min(1)).min(1),
  disclaimer: z.literal(SIMULATED_ADVISORY_DISCLAIMER),
  generatedAt: z.string().min(1),
});

export type AdvisorySeverity = z.infer<typeof advisorySeveritySchema>;
export type Advisory = z.infer<typeof advisorySchema>;
