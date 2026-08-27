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
  presentation: z.object({
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    coverLabel: z.string().trim().max(80).nullable().optional(),
    coverNote: z.string().trim().max(240).nullable().optional(),
    threshold: z.object({
      metric: z.string().trim().min(1).max(160),
      minimum: z.number().finite().nullable(),
      maximum: z.number().finite().nullable(),
      label: z.string().trim().min(1).max(160),
    }).nullable().optional(),
  }).optional(),
});

export type StudyThreshold = {
  metric: string;
  minimum: number | null;
  maximum: number | null;
  label: string;
};

export type StudyPresentation = {
  primaryColor: string | null;
  accentColor: string | null;
  coverLabel: string | null;
  coverNote: string | null;
  threshold: StudyThreshold | null;
};

export const DEFAULT_STUDY_PRESENTATION: StudyPresentation = {
  primaryColor: null,
  accentColor: null,
  coverLabel: null,
  coverNote: null,
  threshold: null,
};

/** Unknown or legacy config remains safe and backwards-compatible. */
export function parseDashboardConfig(value: unknown): { version: 1; sections: DashboardSections; presentation: StudyPresentation } {
  const parsed = configSchema.safeParse(value);
  return {
    version: 1,
    sections: {
      ...DEFAULT_DASHBOARD_SECTIONS,
      ...(parsed.success ? parsed.data.sections : {}),
    },
    presentation: {
      ...DEFAULT_STUDY_PRESENTATION,
      ...(parsed.success ? parsed.data.presentation : {}),
    },
  };
}

export function dashboardConfigFromSections(
  sections: DashboardSections,
  presentation: StudyPresentation = DEFAULT_STUDY_PRESENTATION,
) {
  return { version: 1 as const, sections: { ...sections }, presentation: { ...presentation } };
}
