/**
 * What a person decided about two categories, as an append-only ledger.
 *
 * THE SHAPE, AND WHY IT IS A LEDGER. A merge changes counts, percentages,
 * filters, charts, comparisons and a PDF a client may already have read. An
 * "aliases" column that the product overwrites can answer "what is grouped
 * today" and can never answer "who decided this, when, on what evidence, and
 * what did the report say before". So every accept, every reject and every undo
 * appends a VERSION, and nothing is ever updated or deleted. The current state
 * is derived: the highest version for each group.
 *
 * UNDO IS AN INVERSE VERSION, NOT A DELETION. Reverting a merge writes a
 * `revoked` row pointing at the row it reverses. The original decision, its
 * author and its reason all survive, because the question a year from now is
 * not "is this grouped" but "why did the number change between two reports".
 *
 * FOUR DECISIONS, AND THE TWO IN THE MIDDLE MATTER MOST.
 *
 *   `grouped`   — these spellings are one answer. Changes numbers.
 *   `separate`  — these spellings are NOT one answer. Changes no number, and is
 *                 the reason this module exists as much as `grouped` is:
 *                 without a recorded rejection the product proposes the same
 *                 wrong merge every week until somebody accepts it out of
 *                 fatigue.
 *   `postponed` — not decided yet, and here is why. It carries a REQUIRED
 *                 justification and lifts a publication block without
 *                 pretending the question was answered: the candidate stays in
 *                 the queue, visibly deferred. A gate with no legitimate way
 *                 past it gets satisfied by a false merge instead.
 *   `revoked`   — an earlier decision no longer applies.
 *
 * CANONICAL IDENTITY IS SEPARATE FROM THE VISIBLE LABEL. `canonicalKey` is
 * assigned once and carried through every later version; `canonicalLabel` is
 * what a reader sees and may be rewritten freely. Renaming a category therefore
 * cannot detach anything that points at it.
 *
 * Pure. Every rule here is re-enforced by the database function that writes the
 * ledger (migration 0022) — this module exists so the UI can explain a refusal
 * before the server issues it, never so the server can trust the UI.
 */

import { foldSegmentValue, type SegmentAliases } from "@/lib/calc/segments";
import { groupKeyMembers } from "./candidates";

export type DecisionKind = "grouped" | "separate" | "postponed" | "revoked";
export type ScopeKind = "study" | "template" | "tenant";

/** Where a proposal came from. Recorded on the decision, never trusted by it. */
export type SuggestionSource =
  | "deterministic"
  | "fuzzy"
  | "ai"
  | "template_memory"
  | "tenant_memory"
  | "manual";

/** What the model said, when a model was consulted at all. Never authoritative. */
export type AdvisorRecord = {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  decision: string;
  confidence: string;
  semanticRisk: string;
};

export type CategoryDecision = {
  id: string;
  tenantId: string;
  scopeKind: ScopeKind;
  studyId: string | null;
  templateId: string | null;
  dimensionKey: string;
  /** The categories this decision is about. See `groupKeyFor`. */
  groupKey: string;
  /** The question's fingerprint when the decision was made. */
  contextSignature: string;
  decision: DecisionKind;
  /** Stable identity, carried across renames. Null for `separate`/`revoked`. */
  canonicalKey: string | null;
  /** What a reader sees. Null unless `grouped`. */
  canonicalLabel: string | null;
  /** The RAW spellings as they stood when the decision was made. */
  memberValues: string[];
  reason: string | null;
  suggestionSource: SuggestionSource;
  language: string | null;
  version: number;
  previousId: string | null;
  actorUserId: string | null;
  decidedAt: string;
  advisor: AdvisorRecord | null;
};

// ---------------------------------------------------------------------------
// Context identity
// ---------------------------------------------------------------------------

/**
 * The fingerprint of the question a decision was made about.
 *
 * "No recuperé nada" means the same as "No he recuperado nada" in a question
 * about recovering a membership fee. In a question about recovering a lost
 * document it may not. The two are different questions, so a decision taken in
 * one must not silently apply in the other, and the signature is what makes
 * that difference machine-visible.
 *
 * It carries the characteristic, the language, and the WHOLE option set —
 * because an ordinal scale's meaning lives in its neighbours. Adding an option
 * between two bands can change what the bands mean, and that is exactly when a
 * previous decision deserves re-approval rather than quiet reuse.
 */
export function contextSignature(input: {
  dimensionKey: string;
  optionFolds: readonly string[];
  language?: string | null;
}): string {
  return JSON.stringify({
    d: input.dimensionKey,
    l: input.language ?? "es",
    o: [...new Set(input.optionFolds.filter(Boolean))].sort(),
  });
}

/** The option folds a characteristic currently offers, for the signature. */
export function optionFoldsOf(values: Iterable<string>): string[] {
  return [...new Set([...values].map(foldSegmentValue).filter(Boolean))].sort();
}

// ---------------------------------------------------------------------------
// Canonical identity
// ---------------------------------------------------------------------------

/** Ordinary letters and digits only, so a key is safe in every surface. */
function slug(label: string): string {
  return foldSegmentValue(label)
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/**
 * A stable identity for a newly created category.
 *
 * Derived from the label ONCE, then carried forward by `previousId` for the
 * lifetime of the group. This is the same lesson the journey editor learned the
 * hard way: an identifier regenerated from a name is not an identifier, and
 * anything pointing at it detaches the moment somebody renames the thing.
 */
export function canonicalKeyFor(label: string, taken: readonly string[]): string {
  const base = slug(label) || "categoria";
  if (!taken.includes(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  throw new Error("cannot allocate a canonical key");
}

// ---------------------------------------------------------------------------
// Current state
// ---------------------------------------------------------------------------

/** The scope a decision applies in, as one comparable string. */
function scopeOf(decision: CategoryDecision): string {
  return `${decision.scopeKind}:${decision.studyId ?? decision.templateId ?? decision.tenantId}`;
}

/**
 * The latest version of every decision, keyed by scope + characteristic + group.
 *
 * The ledger is append-only, so "current" is always a fold over history rather
 * than a stored flag that something could forget to update.
 */
export function currentDecisions(ledger: readonly CategoryDecision[]): CategoryDecision[] {
  const latest = new Map<string, CategoryDecision>();
  for (const decision of ledger) {
    const key = `${scopeOf(decision)}|${decision.dimensionKey}|${decision.groupKey}`;
    const held = latest.get(key);
    if (!held || decision.version > held.version) latest.set(key, decision);
  }
  return [...latest.values()];
}

/** Decisions that currently group values. Revoked and separate ones are not. */
export function activeGroupings(ledger: readonly CategoryDecision[]): CategoryDecision[] {
  return currentDecisions(ledger).filter((decision) => decision.decision === "grouped");
}

/** Groups a person explicitly said are NOT one answer, so they stop being asked. */
export function activeRejections(ledger: readonly CategoryDecision[]): CategoryDecision[] {
  return currentDecisions(ledger).filter((decision) => decision.decision === "separate");
}

/** Groups a person deliberately deferred, with the reason they gave. */
export function activePostponements(ledger: readonly CategoryDecision[]): CategoryDecision[] {
  return currentDecisions(ledger).filter((decision) => decision.decision === "postponed");
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * The alias configuration the calculation layer already understands.
 *
 * THIS IS THE ONLY THING THAT CHANGES A NUMBER, and it deliberately produces
 * exactly the structure `parseSegmentAliases` has always read
 * (`segment_dimension.config.aliases`). The ledger is the record; this is its
 * projection. Nothing in the calculation, filter, journey, PDF or client path
 * needed to learn a new concept, so this feature cannot change an aggregate
 * except through the one mechanism that was already reviewed.
 *
 * Raw values are never rewritten. Grouping happens on the way out of the
 * database, exactly as before.
 */
export function projectAliases(ledger: readonly CategoryDecision[]): Record<string, Record<string, string[]>> {
  const byDimension: Record<string, Record<string, string[]>> = {};
  for (const decision of activeGroupings(ledger)) {
    const label = (decision.canonicalLabel ?? "").trim();
    if (!label) continue;
    const forDimension = byDimension[decision.dimensionKey] ?? {};
    // Members are the folds, not the raw spellings recorded at decision time: a
    // spelling that arrives later and folds to a member is the same answer, and
    // `parseSegmentAliases` folds every variant it is given anyway.
    const members = new Set([...(forDimension[label] ?? []), ...groupKeyMembers(decision.groupKey)]);
    forDimension[label] = [...members].sort();
    byDimension[decision.dimensionKey] = forDimension;
  }
  return byDimension;
}

/** The same projection in the lookup shape the read path uses. */
export function resolveAliases(ledger: readonly CategoryDecision[]): SegmentAliases {
  const aliases: SegmentAliases = {};
  for (const [dimension, groups] of Object.entries(projectAliases(ledger))) {
    const forKey: Record<string, string> = {};
    for (const [label, members] of Object.entries(groups)) {
      forKey[foldSegmentValue(label)] = label;
      for (const member of members) forKey[member] = label;
    }
    aliases[dimension] = forKey;
  }
  return aliases;
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export type DecisionProposal = {
  dimensionKey: string;
  groupKey: string;
  decision: DecisionKind;
  canonicalLabel: string | null;
  reason?: string | null;
};

/** A deferral must say why, or it is indistinguishable from ignoring the queue. */
export const MIN_POSTPONE_REASON = 10;

/**
 * Why a proposed decision cannot be recorded, in the consultant's own words.
 *
 * Every rule here is enforced again inside the database function, which is what
 * actually protects the data. This exists so the screen can say why BEFORE the
 * click, rather than turning a considered judgement into a red banner.
 *
 * THE RULES, AND WHAT EACH ONE PREVENTS.
 *
 *  1. A value belongs to at most one category. Without it, "No recuperé nada"
 *     could sit inside two groups at once and the projection would pick one by
 *     accident of iteration order — a number that changes when nothing did.
 *  2. Two groups may not share a visible label. Sharing one is a merge of three
 *     categories that nobody approved, arrived at by naming rather than by
 *     deciding.
 *  3. A group's label may not be another group's member. That is the only shape
 *     in which this structure could form a chain, and refusing it is what keeps
 *     the mapping flat and therefore acyclic by construction.
 *  4. Grouping needs a label; not grouping must not carry one.
 */
export function decisionRefusal(
  proposal: DecisionProposal,
  ledger: readonly CategoryDecision[],
): string | null {
  const label = (proposal.canonicalLabel ?? "").trim();

  if (proposal.decision === "grouped") {
    if (!label) return "Escribe cómo se va a llamar la categoría final.";
    if (label.length > 200) return "El nombre de la categoría es demasiado largo.";
  } else if (label) {
    return "Solo una agrupación lleva nombre final.";
  }

  // A deferral is the one way past a publication block that does not answer the
  // question, so it has to cost something: a sentence a colleague can read
  // later and understand. Without that it is just a dismiss button, and a
  // dismiss button is how the block stops meaning anything.
  if (proposal.decision === "postponed") {
    const reason = (proposal.reason ?? "").trim();
    if (reason.length < MIN_POSTPONE_REASON) {
      return "Para posponerlo, escribe por qué queda pendiente. Alguien tiene que poder retomarlo.";
    }
    if (reason.length > 400) return "La explicación es demasiado larga.";
  }

  const members = groupKeyMembers(proposal.groupKey);
  if (members.length < 2) {
    return "Una decisión necesita al menos dos respuestas distintas.";
  }

  const active = activeGroupings(ledger).filter(
    (decision) =>
      decision.dimensionKey === proposal.dimensionKey && decision.groupKey !== proposal.groupKey,
  );

  if (proposal.decision === "grouped") {
    // (1) one value, one category
    for (const decision of active) {
      const held = groupKeyMembers(decision.groupKey);
      const clash = members.find((member) => held.includes(member));
      if (clash) {
        return (
          `“${clash}” ya forma parte de “${decision.canonicalLabel}”. Una respuesta solo puede ` +
          "pertenecer a una categoría: deshaz esa agrupación o añade estas respuestas a ella."
        );
      }
    }
    // (2) one label, one category
    const sameLabel = active.find(
      (decision) => foldSegmentValue(decision.canonicalLabel ?? "") === foldSegmentValue(label),
    );
    if (sameLabel) {
      return (
        `Ya existe una categoría llamada “${sameLabel.canonicalLabel}” en esta característica. ` +
        "Añade estas respuestas a esa categoría en lugar de crear otra con el mismo nombre."
      );
    }
    // (3) a label is not a member of something else
    const labelFold = foldSegmentValue(label);
    const asMember = active.find((decision) => groupKeyMembers(decision.groupKey).includes(labelFold));
    if (asMember) {
      return (
        `“${label}” ya está agrupada dentro de “${asMember.canonicalLabel}”. Usar ese nombre aquí ` +
        "encadenaría una categoría con otra."
      );
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

export type StaleFinding = {
  dimensionKey: string;
  groupKey: string;
  /** What changed since the decision was taken. */
  kind: "context_changed" | "member_absent";
  detail: string;
};

/**
 * Decisions whose question is no longer the question that was answered.
 *
 * A later import can add an option to a scale, remove one, or reword one. The
 * decision is not wrong because of that — but it was made about a different
 * option set, and the honest thing is to say so and ask again rather than to
 * keep applying it silently.
 *
 * `member_absent` is reported separately and deliberately does NOT invalidate
 * anything: a grouping whose members are all gone simply stops affecting any
 * number, and revoking it automatically would destroy the record of a judgement
 * that was correct when it was made.
 */
export function staleDecisions(
  ledger: readonly CategoryDecision[],
  currentSignatures: Readonly<Record<string, string>>,
  presentFolds: Readonly<Record<string, readonly string[]>>,
): StaleFinding[] {
  const findings: StaleFinding[] = [];
  for (const decision of currentDecisions(ledger)) {
    if (decision.decision === "revoked") continue;
    const signature = currentSignatures[decision.dimensionKey];
    if (signature && signature !== decision.contextSignature) {
      findings.push({
        dimensionKey: decision.dimensionKey,
        groupKey: decision.groupKey,
        kind: "context_changed",
        detail:
          "Las respuestas posibles de esta característica cambiaron desde que se tomó esta " +
          "decisión. Vuelve a confirmarla antes de publicar.",
      });
      continue;
    }
    const present = presentFolds[decision.dimensionKey] ?? [];
    const missing = groupKeyMembers(decision.groupKey).filter((member) => !present.includes(member));
    if (missing.length > 0) {
      findings.push({
        dimensionKey: decision.dimensionKey,
        groupKey: decision.groupKey,
        kind: "member_absent",
        detail:
          missing.length === groupKeyMembers(decision.groupKey).length
            ? "Ninguna de estas respuestas sigue presente en el estudio. La decisión ya no afecta a ningún número."
            : `Estas respuestas ya no están en el estudio: ${missing.join(", ")}.`,
      });
    }
  }
  return findings;
}

/**
 * Whether what the client is currently reading was calculated with a different
 * set of decisions from the one in force now.
 *
 * A published report must not change because somebody edited an alias
 * afterwards, so the client keeps the snapshot until a person publishes again.
 * This is what lets Studio say "hay cambios sin publicar" instead of leaving a
 * consultant to guess.
 */
export function publishedDecisionsDiffer(
  publishedDecisionIds: readonly string[],
  ledger: readonly CategoryDecision[],
): boolean {
  const now = currentDecisions(ledger)
    .filter((decision) => decision.decision === "grouped")
    .map((decision) => decision.id)
    .sort();
  const published = [...publishedDecisionIds].sort();
  return JSON.stringify(now) !== JSON.stringify(published);
}
