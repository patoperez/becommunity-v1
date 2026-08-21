import { z } from "zod";

export const dashboardSectionKeys = [
  "narrative",
  "trends",
  "filters",
  "journey",
  "qualitative",
  "metrics",
  "segments",
  "pivot",
  "report",
] as const;

export type DashboardSectionKey = typeof dashboardSectionKeys[number];
export type DashboardSections = Record<DashboardSectionKey, boolean>;

export const DEFAULT_DASHBOARD_SECTIONS: DashboardSections = Object.fromEntries(
  dashboardSectionKeys.map((key) => [key, true]),
) as DashboardSections;

const configSchema = z.object({
  version: z.literal(1).optional(),
  sections: z.object(Object.fromEntries(
    dashboardSectionKeys.map((key) => [key, z.boolean().optional()]),
  ) as Record<DashboardSectionKey, z.ZodOptional<z.ZodBoolean>>).optional(),
});

/** Unknown or legacy config remains safe and backwards-compatible. */
export function parseDashboardConfig(value: unknown): { version: 1; sections: DashboardSections } {
  const parsed = configSchema.safeParse(value);
  return {
    version: 1,
    sections: {
      ...DEFAULT_DASHBOARD_SECTIONS,
      ...(parsed.success ? parsed.data.sections : {}),
    },
  };
}

export function dashboardConfigFromSections(sections: DashboardSections) {
  return { version: 1 as const, sections: { ...sections } };
}
