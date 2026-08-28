/**
 * What this client's team decided last time — offered as a suggestion, never
 * applied as a fact.
 *
 * THE RULE THIS MODULE IS BUILT AROUND. A previous decision is evidence about a
 * previous question. "No recuperé nada" and "No he recuperado nada" are the
 * same answer in a question about recovering a membership fee. In a question
 * about recovering a lost document they may not be. So memory produces a
 * PROPOSAL with its provenance attached and an explicit note when the context
 * has moved, and the consultant approves it or does not. Nothing here writes a
 * decision, and nothing here is retroactive: a study already reviewed is never
 * revisited because a later study decided something.
 *
 * TENANT ISOLATION IS STRUCTURAL, NOT POLITE. Every lookup takes a single
 * tenant id and every candidate decision is filtered against it here, in
 * addition to the RLS and the explicit `.eq("tenant_id", …)` on the read that
 * produced the ledger. Three independent layers, because one client's editorial
 * judgement about their own categories is their data.
 *
 * Pure.
 */

import { groupKeyMembers } from "./candidates";
import {
  currentDecisions,
  type CategoryDecision,
  type SuggestionSource,
} from "./decisions";

/** How much of the previous question the present one still shares. */
export type MemoryConfidence =
  /** Same characteristic, same option set, same language. */
  | "same_context"
  /** Same characteristic; the option set has changed since. */
  | "context_changed";

export type MemorySuggestion = {
  dimensionKey: string;
  groupKey: string;
  /** What was decided before. Never applied by this module. */
  decision: "grouped" | "separate";
  canonicalLabel: string | null;
  confidence: MemoryConfidence;
  source: SuggestionSource;
  /** Where the earlier decision was taken, for the provenance line. */
  fromScope: "study" | "template" | "tenant";
  fromStudyId: string | null;
  fromTemplateId: string | null;
  decidedAt: string;
  /** The sentence the review screen shows above the proposal. */
  provenance: string;
  /** Set when the consultant must look again before accepting. */
  revalidation: string | null;
};

/**
 * Prior decisions that bear on a candidate, strongest first.
 *
 * A prior decision is relevant when it is the SAME TENANT, the SAME
 * characteristic, and it covers exactly the same set of categories. "Covers the
 * same set" is deliberately exact rather than overlapping: a decision about
 * three values says nothing reliable about two of them, and guessing which two
 * is how a scale gets collapsed.
 */
export function recallForGroup(
  input: {
    tenantId: string;
    studyId: string | null;
    dimensionKey: string;
    groupKey: string;
    contextSignature: string;
  },
  ledger: readonly CategoryDecision[],
): MemorySuggestion[] {
  const members = groupKeyMembers(input.groupKey).join("|");

  const relevant = currentDecisions(ledger).filter((decision) => {
    // 1. Never across a tenant boundary. Checked here as well as in SQL.
    if (decision.tenantId !== input.tenantId) return false;
    // 2. A decision taken in THIS study is not memory; it is the current state.
    if (decision.studyId && input.studyId && decision.studyId === input.studyId) return false;
    if (decision.dimensionKey !== input.dimensionKey) return false;
    if (decision.decision !== "grouped" && decision.decision !== "separate") return false;
    return groupKeyMembers(decision.groupKey).join("|") === members;
  });

  return relevant
    .map((decision): MemorySuggestion => {
      const sameContext = decision.contextSignature === input.contextSignature;
      const scope = decision.scopeKind;
      return {
        dimensionKey: input.dimensionKey,
        groupKey: input.groupKey,
        decision: decision.decision === "grouped" ? "grouped" : "separate",
        canonicalLabel: decision.canonicalLabel,
        confidence: sameContext ? "same_context" : "context_changed",
        source: scope === "template" ? "template_memory" : "tenant_memory",
        fromScope: scope,
        fromStudyId: decision.studyId,
        fromTemplateId: decision.templateId,
        decidedAt: decision.decidedAt,
        provenance: provenanceLine(decision),
        revalidation: sameContext
          ? null
          : "Las respuestas posibles de esta característica no son las mismas que cuando se " +
            "tomó aquella decisión. Compruébalo antes de repetirla.",
      };
    })
    .sort(
      (a, b) =>
        Number(b.confidence === "same_context") - Number(a.confidence === "same_context") ||
        (a.decidedAt < b.decidedAt ? 1 : -1),
    );
}

function provenanceLine(decision: CategoryDecision): string {
  const when = decision.decidedAt.slice(0, 10);
  const what =
    decision.decision === "grouped"
      ? `se agruparon como “${decision.canonicalLabel}”`
      : "se dejaron separadas";
  if (decision.scopeKind === "template") {
    return `En una plantilla de este cliente, estas respuestas ${what} el ${when}.`;
  }
  if (decision.scopeKind === "study") {
    return `En otro estudio de este cliente, estas respuestas ${what} el ${when}.`;
  }
  return `Para este cliente, estas respuestas ${what} el ${when}.`;
}

/**
 * Whether a remembered decision conflicts with what this study already decided.
 *
 * A conflict is not an error and is never resolved automatically: it means two
 * studies of the same client answered the same question differently, which is
 * either a mistake worth catching or a real difference between two instruments.
 * Only a person can say which, so it is surfaced and left alone.
 */
export function memoryConflict(
  suggestion: MemorySuggestion,
  currentForGroup: CategoryDecision | null,
): string | null {
  if (!currentForGroup) return null;
  if (currentForGroup.decision === "revoked" || currentForGroup.decision === "postponed") return null;
  const here = currentForGroup.decision === "grouped" ? "grouped" : "separate";
  if (here === suggestion.decision) return null;
  return here === "grouped"
    ? "En este estudio están agrupadas y en otro se dejaron separadas. Revisa cuál de los dos " +
        "cuestionarios describe realmente esta pregunta."
    : "En este estudio están separadas y en otro se agruparon. Revisa cuál de los dos " +
        "cuestionarios describe realmente esta pregunta.";
}
