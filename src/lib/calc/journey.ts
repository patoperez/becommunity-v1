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

/**
 * Safely parse a study's journey_definition jsonb into stages. Defensive: the
 * blob is validated, never trusted blindly — malformed entries are dropped so a
 * bad config can never crash the UI.
 */
export function parseJourneyDefinition(def: unknown): JourneyStage[] {
  if (!def || typeof def !== "object") return [];
  const stages = (def as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return [];

  const out: JourneyStage[] = [];
  for (const s of stages) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    if (typeof o.id === "string" && typeof o.label === "string" && typeof o.metric === "string") {
      out.push({
        id: o.id,
        label: o.label,
        metric: o.metric,
        description: typeof o.description === "string" ? o.description : undefined,
      });
    }
  }
  return out;
}
