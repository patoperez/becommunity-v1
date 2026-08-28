/**
 * Whether the advisor may run at all — and the three independent conditions
 * that must ALL hold before it can.
 *
 * WHY THREE AND NOT ONE. An environment variable is set by whoever can reach
 * the dashboard; a key is present whenever somebody pastes one; neither is
 * evidence that the thing works well enough to put in front of a consultant
 * making a decision a client will act on. `EVALUATION_APPROVED` is a constant
 * in the repository precisely because flipping it is a reviewed commit with a
 * named author, and because it cannot be flipped from a console at 2am.
 *
 * The order matters for the message the operator sees: the screen says the
 * FIRST unmet condition, so "no evaluation" is never mistaken for "no key".
 *
 * WHAT NONE OF THIS AFFECTS. The review workflow. Candidates, impact, the
 * publication gate, decisions, undo and publication all run identically with
 * every flag off — which is the state this ships in. The advisor adds an
 * opinion to a screen that already works without one.
 */

/**
 * The evaluation bar, and whether it has been met.
 *
 * SET TO FALSE DELIBERATELY, AND ONLY A HUMAN MAY CHANGE IT. Turning this on is
 * a claim that the measured false-merge rate on the committed fixture is at or
 * below the threshold below, that a person has read the failures, and that the
 * result is written down. `npm run test:category-evaluation` produces the
 * numbers; nothing automatic may edit this line.
 *
 * See docs/SEMANTIC_CATEGORY_REVIEW.md for the acceptance criteria this
 * constant stands for.
 */
export const EVALUATION_APPROVED = false;

/** A false merge is the failure this whole feature exists to prevent. */
export const MAX_ACCEPTABLE_FALSE_MERGE_RATE = 0.0;
/** Below this, the advisor is not adding enough to justify the exposure. */
export const MIN_ACCEPTABLE_RECALL = 0.6;

export type AdvisorAvailability =
  | { available: true; model: string; reasoningEffort: string; timeoutMs: number }
  | { available: false; reason: string; detail: string };

const DEFAULT_MODEL = "gpt-5.6-terra";
const DEFAULT_EFFORT = "low";
const DEFAULT_TIMEOUT_MS = 12_000;

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  const value = Number(String(raw ?? "").trim());
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, max);
}

/**
 * Read the advisor's configuration from the environment.
 *
 * NO FALLBACK TO A DIFFERENT MODEL. If `OPENAI_ALIAS_MODEL` is set to something,
 * that is what is called; if it is unset, the documented default is used. The
 * one thing that never happens is silently calling a cheaper or older model
 * because the configured one was unavailable — the advisor's answers would stop
 * being comparable to the evaluation that approved it, and nothing on screen
 * would say so.
 */
export function advisorAvailability(
  env: Record<string, string | undefined> = process.env,
): AdvisorAvailability {
  if (!EVALUATION_APPROVED) {
    return {
      available: false,
      reason: "sin evaluación aprobada",
      detail:
        "El asistente automático está apagado hasta que su evaluación se ejecute, se documente " +
        "y una persona la acepte. La revisión manual no depende de él.",
    };
  }
  if (String(env.CATEGORY_AI_ENABLED ?? "").trim() !== "true") {
    return {
      available: false,
      reason: "desactivado por configuración",
      detail: "El asistente automático está desactivado en este entorno.",
    };
  }
  if (!String(env.OPENAI_API_KEY ?? "").trim()) {
    return {
      available: false,
      reason: "sin credencial",
      detail: "No hay credencial configurada para el asistente. La revisión manual sigue completa.",
    };
  }
  return {
    available: true,
    model: String(env.OPENAI_ALIAS_MODEL ?? "").trim() || DEFAULT_MODEL,
    reasoningEffort: String(env.OPENAI_ALIAS_REASONING_EFFORT ?? "").trim() || DEFAULT_EFFORT,
    timeoutMs: positiveInt(env.OPENAI_ALIAS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 60_000),
  };
}

/** The model that WOULD be called, for the configuration line Studio shows. */
export function configuredModel(env: Record<string, string | undefined> = process.env): string {
  return String(env.OPENAI_ALIAS_MODEL ?? "").trim() || DEFAULT_MODEL;
}
