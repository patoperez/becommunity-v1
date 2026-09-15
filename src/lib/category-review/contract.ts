/**
 * CANONICAL CATEGORY REVIEW — the closed vocabulary, and the projection that is
 * the only thing here able to change a number.
 *
 * Pure. This module imports nothing, reaches no transport, and is safe in a
 * client bundle. Everything it declares is either a type, a closed list, a
 * Spanish sentence, or a total function over strings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A «CATEGORY» IS HERE, AND WHAT IT IS NOT.
 *
 * It is one value of a study's own short, closed, emergent coding vocabulary —
 * the labels a qualitative family publishes as a term cloud, «se categoriza con
 * una lista que se van creando según lo que contestan». It is NEVER the
 * free-text column beside it: that column has no field on any type in this file
 * and never enters the canonical read model in any shape.
 *
 * It is also NOT a participant attribute. The legacy screen this replaces
 * offered all thirteen LEGACY segment dimensions, which canonically are filter
 * attributes with named methodological authorities behind them. Merging two of
 * those changes who is inside a cut of the population rather than what a client
 * reads as a finding, and the specification that declares them forbids a guess.
 * The explicit product requirement is editorial control over QUALITATIVE
 * categorization, and that is exactly the surface this covers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROJECTION IS A MAP FROM FOLD TO NAME, AND NOTHING ELSE.
 *
 * A decision never rewrites evidence. It contributes one entry to a map the
 * results builder consults while it counts, so the total number of people who
 * answered cannot change — only how many groups they fall into. Removing a
 * decision simply makes the next build group differently, and reconciliation
 * against the source workbooks stays exact.
 */

/* -------------------------------------------------------------------------- */
/* the fold                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * THE MERGING FOLD: case and surrounding/repeated whitespace, and nothing else.
 *
 * Applied automatically, because nobody writing a questionnaire means «Malos
 * resultados» and «malos resultados» as two answers. Widening it is a product
 * decision with a client-visible consequence, so it lives in exactly one place
 * and `./normalize.ts` deliberately does not redefine it.
 *
 * `toLowerCase` without a locale is deliberate: it is deterministic on every
 * runtime, which a locale-aware fold is not, and these labels are compared
 * against each other rather than sorted for a reader.
 */
export function foldCategoryLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* limits                                                                      */
/* -------------------------------------------------------------------------- */

export const CATEGORY_REVIEW_LIMITS = {
  /** A decision joins at least two categories and at most this many. */
  maxGroupMembers: 12,
  /** Beyond this a family is not a coding vocabulary; it is free text. */
  maxFamilyLabels: 400,
  /** Beyond this, resemblance comparison is withheld as noise. */
  maxFuzzyLabels: 150,
  /** A group's chosen name. */
  maxLabelLength: 200,
  /** A written reason. */
  maxRationaleLength: 400,
  /** Postponing must say why, in at least this many characters. */
  minPostponeReason: 10,
} as const;

/* -------------------------------------------------------------------------- */
/* what a family is                                                            */
/* -------------------------------------------------------------------------- */

/** One label and how many answers carry it. */
export type CategoryCount = { label: string; count: number };

/**
 * One qualitative family, as the review reads it.
 *
 * `terms` is what a client would see NOW — after the decisions in force are
 * applied — and `sourceLabels` is what the source coded, before any of them. A
 * reviewer needs both: one is the consequence, the other is the evidence.
 */
export type CategoryFamily = {
  /** The results specification's own group key. Not a database identifier. */
  key: string;
  /** The family's title, as a client reads it. */
  label: string;
  /** Where the categories came from. Two different editorial situations. */
  coding: "source_coded" | "be_community_curated";
  /** Client-safe description of the source. */
  sourceDescription: string;
  /** The published terms after the resolution in force. */
  terms: CategoryCount[];
  /** Documented categories kept OUT of the cloud, and their counts. */
  excluded: CategoryCount[];
  /** The source's own labels, codepoint-ordered, before any grouping. */
  sourceLabels: CategoryCount[];
  /** Answers covered by `terms`. The denominator every share rests on. */
  total: number;
};

/* -------------------------------------------------------------------------- */
/* what a decision is                                                          */
/* -------------------------------------------------------------------------- */

/** The four things a person may decide. «Nobody looked» is the absence of a row. */
export type CategoryDisposition = "grouped" | "separate" | "postponed" | "revoked";

export const CATEGORY_DISPOSITIONS: readonly CategoryDisposition[] = [
  "grouped",
  "separate",
  "postponed",
  "revoked",
];

/** One decision in force, as the ledger returns it. Never the actor. */
export type StoredCategoryDecision = {
  decisionId: string;
  familyKey: string;
  /** Sorted, de-duplicated folded labels. This IS the group's identity. */
  memberFolds: string[];
  /** The spellings as they stood when the decision was taken. */
  memberLabels: string[];
  sourceDigest: string;
  disposition: CategoryDisposition;
  canonicalKey: string | null;
  canonicalLabel: string | null;
  rationale: string | null;
  version: number;
  decidedAt: string;
};

/**
 * What ANOTHER study of the same client decided about the same question.
 *
 * Evidence about a previous question, offered as a suggestion and never
 * applied. Nothing is retroactive: a study already reviewed is never revisited
 * because a later study decided something.
 */
export type CategoryMemoryEntry = {
  familyKey: string;
  memberFolds: string[];
  disposition: CategoryDisposition;
  canonicalLabel: string | null;
  decidedAt: string;
};

/* -------------------------------------------------------------------------- */
/* the projection                                                              */
/* -------------------------------------------------------------------------- */

/** One grouping: a chosen name over a set of folded labels. */
export type CategoryGrouping = {
  label: string;
  memberFolds: readonly string[];
};

/**
 * The whole projection a build applies: per family, the groupings in force.
 *
 * FROZEN AND ORDERED. A results document must be byte-identical for the same
 * evidence, so the groupings are sorted by their first member's fold and the
 * object is built once rather than mutated.
 */
export type CategoryResolution = {
  readonly groups: Readonly<Record<string, readonly CategoryGrouping[]>>;
};

/** A study with no decisions, and the value every path defaults to. */
export const EMPTY_CATEGORY_RESOLUTION: CategoryResolution = Object.freeze({
  groups: Object.freeze({}),
});

/** Whether a resolution would change anything at all. */
export function resolutionIsEmpty(resolution: CategoryResolution): boolean {
  return Object.values(resolution.groups).every((groups) => groups.length === 0);
}

/**
 * The map a builder consults while counting: folded label → the name it counts
 * under.
 *
 * Returns an empty map for a family with no groupings, so a caller never has to
 * branch on absence, and a label with no entry keeps its own spelling.
 */
export function categoryLabelMap(
  resolution: CategoryResolution,
  familyKey: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of resolution.groups[familyKey] ?? []) {
    for (const fold of group.memberFolds) map.set(fold, group.label);
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* why a write was refused                                                     */
/* -------------------------------------------------------------------------- */

/**
 * CLOSED. A refusal is a member of this list or it is not a refusal.
 *
 * The reason is the same one the publication contract gives for its blockers:
 * a free-text refusal is a refusal nothing can assert on, and a screen that
 * explains itself differently every time teaches nobody anything.
 */
export type CategoryRefusalCode =
  | "family_unknown"
  | "members_not_current"
  | "too_few_members"
  | "too_many_members"
  | "name_required"
  | "name_too_long"
  | "name_conflicts"
  | "member_already_grouped"
  | "name_is_a_member"
  | "reason_required"
  | "nothing_to_undo"
  | "stale_source"
  | "stale_version"
  | "ledger_not_provisioned"
  | "not_authorized"
  | "write_failed";

export const CATEGORY_REFUSAL_DETAIL: Record<CategoryRefusalCode, string> = {
  family_unknown:
    "Esa familia de categorías ya no está en este estudio. Vuelve a cargar la pantalla.",
  members_not_current:
    "Alguna de esas respuestas ya no está en el estudio tal como se guardó. Vuelve a cargar la pantalla y decide sobre las categorías que hay ahora.",
  too_few_members: "Una decisión es sobre dos categorías o más.",
  too_many_members: `No se pueden juntar más de ${CATEGORY_REVIEW_LIMITS.maxGroupMembers} categorías en una sola decisión.`,
  name_required: "Escribe cómo se va a llamar la categoría final.",
  name_too_long: `Ese nombre es demasiado largo: como mucho ${CATEGORY_REVIEW_LIMITS.maxLabelLength} caracteres.`,
  name_conflicts: "Ya hay una categoría con ese nombre en esta familia.",
  member_already_grouped: "Alguna de esas respuestas ya pertenece a otra categoría.",
  name_is_a_member: "Ese nombre ya está agrupado dentro de otra categoría.",
  reason_required:
    "Para posponerlo, escribe por qué queda pendiente. Alguien tiene que poder retomarlo.",
  nothing_to_undo: "No hay nada que deshacer en este grupo.",
  stale_source:
    "Las categorías de esta familia cambiaron mientras tenías la pantalla abierta. Vuelve a cargarla: lo que ves ya no es lo que hay.",
  stale_version:
    "Alguien decidió sobre este mismo grupo mientras tenías la pantalla abierta. Vuelve a cargarla para ver su decisión antes de tomar la tuya.",
  ledger_not_provisioned:
    "En este entorno todavía no se puede registrar una decisión de categorías: falta aplicar la migración que crea su historial. Las categorías se ven; decidir queda para cuando esté aplicada.",
  not_authorized: "No tienes permiso para decidir sobre las categorías de este estudio.",
  write_failed:
    "No se pudo guardar la decisión. No se guardó nada a medias: vuelve a intentarlo.",
};

/* -------------------------------------------------------------------------- */
/* the shape of the one act this feature offers                                */
/* -------------------------------------------------------------------------- */

/** What a person submits. Labels and a version — never a digest, never a count. */
export type CategoryDecisionSubmission = {
  familyKey: string;
  memberLabels: string[];
  disposition: CategoryDisposition;
  canonicalLabel: string | null;
  rationale: string | null;
  /** The version the screen displayed. Zero when the group has no history. */
  expectedVersion: number;
};

export type CategoryDecisionOutcome =
  | { ok: true; created: boolean; version: number }
  | { ok: false; code: string; detail: string };

/**
 * The action the review screen is handed as a PROP.
 *
 * It is never imported by the `"use client"` component: a static import of the
 * action module from a client module would give that module a path into the
 * canonical read layer's import graph, which the boundary gate refuses by name.
 */
export type RecordCategoryDecision = (
  studyId: string,
  input: CategoryDecisionSubmission,
) => Promise<CategoryDecisionOutcome>;

/* -------------------------------------------------------------------------- */
/* why a read could not be trusted                                             */
/* -------------------------------------------------------------------------- */

/**
 * THE LEDGER'S THREE STATES, AND WHY THERE ARE THREE RATHER THAN TWO.
 *
 * Unit 6B.4B2K found what two costs: on the Cloudflare edge a decision read was
 * refused by the RUNTIME, not by the database, the failure was swallowed, and
 * fifteen recorded approvals were reported to their own author as unreviewed.
 *
 *   `ready`           — the ledger answered. Zero decisions means zero
 *                       decisions.
 *   `not_provisioned` — the ledger's own function does not exist in this
 *                       environment. That is a FACT ABOUT PROVISIONING, not a
 *                       failure: no decision can exist where nothing can record
 *                       one, so the empty resolution is exactly right and
 *                       saying so is honest. Deciding is disabled and the
 *                       screen says why.
 *   `unavailable`     — the read was attempted and failed. The resolution is
 *                       NOT empty; it is unknown, and every surface that would
 *                       have used it refuses instead.
 */
export type CategoryLedgerState =
  | {
      kind: "ready";
      decisions: readonly StoredCategoryDecision[];
      memory: readonly CategoryMemoryEntry[];
    }
  | { kind: "not_provisioned" }
  | { kind: "unavailable"; code: string; detail: string };
