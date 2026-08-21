/**
 * Journey map configuration (§8.1). A study's `journey_definition` jsonb holds
 * the stages and which metric lives in each. The SAME component renders any
 * client's journey from this data — configuration over code (§8.3): the journey
 * is defined by editing this structure, NOT a drag-and-drop visual builder.
 *
 * Shape:
 *   { stages: [ { id, label, metric, description? }, ... ] }
 */

export type JourneyStage = {
  id: string;
  label: string;
  metric: string;
  description?: string;
};

const stageSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/),
  label: z.string().trim().min(1).max(120),
  metric: z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9_:-]*$/),
  description: z.string().trim().max(500).optional(),
});

export const journeyDefinitionSchema = z.object({
  stages: z.array(stageSchema).max(30)
    .refine((stages) => new Set(stages.map((stage) => stage.id)).size === stages.length, "stage ids must be unique"),
});

/**
 * Safely parse a study's journey_definition jsonb into stages. Defensive: the
 * blob is validated, never trusted blindly — malformed entries are dropped so a
 * bad config can never crash the UI.
 */
export function parseJourneyDefinition(def: unknown): JourneyStage[] {
  const parsed = journeyDefinitionSchema.safeParse(def);
  return parsed.success ? parsed.data.stages : [];
}
import { z } from "zod";
