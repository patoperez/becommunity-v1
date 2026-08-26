import { z } from "zod";

const evidenceSchema = z.object({
  kind: z.enum(["metric", "theme", "journey"]),
  ref: z.string().trim().min(1).max(160),
  label: z.string().trim().min(1).max(200),
});

export const interpretationContentSchema = z.object({
  version: z.literal(1),
  whatHappened: z.string().trim().min(1).max(1800),
  whyItMatters: z.string().trim().min(1).max(1800),
  whatNext: z.string().trim().min(1).max(1800),
  evidence: z.array(evidenceSchema).max(12),
});

export type InterpretationContent = z.infer<typeof interpretationContentSchema>;

export type InterpretationState = "draft" | "in_review" | "approved";

export function parseInterpretationContent(value: unknown): InterpretationContent | null {
  const parsed = interpretationContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
