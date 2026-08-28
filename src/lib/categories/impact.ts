/**
 * What would actually change if these two categories became one.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE CANDIDATE SCAN. A reviewer cannot judge a
 * merge from two strings. "Publico" and "Público" is a five-second decision if
 * it moves one person in a characteristic nothing is broken down by, and a
 * careful one if it moves nine people in the characteristic the journey is
 * segmented by and a published PDF already quotes. The strings are identical in
 * both cases; only the consequence differs, so the consequence is what the
 * screen leads with and what the queue is ordered by.
 *
 * THE ONE INVARIANT. Grouping changes how answers are BUCKETED. It never
 * changes how many answers there are. `totalsUnchanged` is that statement in
 * executable form and the review gate asserts it on every fixture: if a merge
 * ever moves the denominator, every percentage in the product is wrong and no
 * amount of interface makes that acceptable.
 *
 * Pure, so the honesty of an impact preview can be proved without a database.
 */

import { foldSegmentValue } from "@/lib/calc/segments";
import type { CandidateGroup } from "./candidates";
import { groupKeyMembers } from "./candidates";

/** Everything about a study that decides whether a merge matters. */
export type StudyImpactContext = {
  status: string;
  /** People who answered at all. The denominator a percentage is read against. */
  totalRespondents: number;
  /** People carrying a non-empty value, per characteristic. */
  respondentsPerDimension: Readonly<Record<string, number>>;
  /** Journey moments, so a merge can name the ones it redraws. */
  stages: readonly { id: string; label: string; metric: string }[];
  /** Which client-facing sections this study publishes. */
  sections: Readonly<Record<string, boolean>>;
  /** Characteristics a client account's access scope is written against. */
  scopedDimensions: readonly string[];
  /** Characteristics used as a saved comparison/breakdown. */
  comparisonDimensions: readonly string[];
  /** The published consultant reading, for mention detection. Never a quote. */
  publishedNarrative: string;
  /** Whether a client-visible report currently exists. */
  hasPublishedSnapshot: boolean;
};

export const EMPTY_IMPACT_CONTEXT: StudyImpactContext = {
  status: "draft",
  totalRespondents: 0,
  respondentsPerDimension: {},
  stages: [],
  sections: {},
  scopedDimensions: [],
  comparisonDimensions: [],
  publishedNarrative: "",
  hasPublishedSnapshot: false,
};

/** One surface a merge would reach, named the way the product names it. */
export type ImpactSurface = {
  id: string;
  label: string;
  detail: string;
  /** True when a client — not only the internal team — would see the change. */
  clientFacing: boolean;
};

export type CandidateImpact = {
  dimensionKey: string;
  groupKey: string;
  /** People whose answer would be re-bucketed. */
  affectedRespondents: number;
  /** Those people as a share of everyone who answered this characteristic. */
  shareOfDimension: number;
  /** People who would leave the smaller spelling(s) behind. */
  movedRespondents: number;
  categoriesBefore: number;
  categoriesAfter: number;
  surfaces: ImpactSurface[];
  /** Category names that appear verbatim in the published reading. */
  narrativeMentions: string[];
  reachesClient: boolean;
  /** 0..1. Ordering only — never a threshold on its own. */
  materiality: number;
};

/**
 * THE INVARIANT. A merge re-buckets answers; it never creates or destroys one.
 *
 * Compares two value->count maps and returns true only when the totals agree
 * exactly. Integer counts, so an exact comparison is the correct one and a
 * tolerance would only hide a defect.
 */
export function totalsUnchanged(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): boolean {
  const sum = (counts: ReadonlyMap<string, number>) =>
    [...counts.values()].reduce((total, count) => total + count, 0);
  return sum(before) === sum(after);
}

/**
 * The value distribution a characteristic would have after a group is applied.
 *
 * Returned so a screen can show both columns side by side, and so the gate can
 * assert the totals against the input rather than against a re-derivation.
 */
export function distributionAfter(
  counts: ReadonlyMap<string, number>,
  group: CandidateGroup,
  canonicalLabel: string,
): Map<string, number> {
  const members = new Set(groupKeyMembers(group.groupKey));
  const after = new Map<string, number>();
  let merged = 0;
  for (const [raw, count] of counts) {
    if (members.has(foldSegmentValue(raw))) merged += count;
    else after.set(raw, (after.get(raw) ?? 0) + count);
  }
  if (merged > 0) after.set(canonicalLabel, (after.get(canonicalLabel) ?? 0) + merged);
  return after;
}

/** Whether a category name appears in the published reading as a whole word. */
function mentioned(narrative: string, label: string): boolean {
  const haystack = foldSegmentValue(narrative);
  const needle = foldSegmentValue(label);
  if (!needle || needle.length < 3) return false;
  const at = haystack.indexOf(needle);
  if (at === -1) return false;
  const before = haystack[at - 1];
  const after = haystack[at + needle.length];
  const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);
  return !isWordChar(before) && !isWordChar(after);
}

/**
 * Everything a merge would reach, named.
 *
 * The list is built from what the study ACTUALLY has — its enabled sections,
 * its real journey moments, the characteristics a client account is scoped by.
 * A surface the study does not publish is not listed, because a preview that
 * warns about a chart nobody will see is a preview a consultant stops reading.
 */
export function impactSurfaces(
  group: CandidateGroup,
  context: StudyImpactContext,
): ImpactSurface[] {
  const surfaces: ImpactSurface[] = [];
  const published = context.status === "published";
  const dimension = group.dimensionKey;

  surfaces.push({
    id: "conteos",
    label: "Conteos y porcentajes",
    detail:
      `Las ${group.values.length} respuestas se cuentan como una sola categoría. ` +
      "El total de personas no cambia; solo cómo se agrupan.",
    clientFacing: published,
  });

  if (context.sections.filters) {
    surfaces.push({
      id: "filtros",
      label: "Filtros",
      detail: `El filtro por “${dimension}” ofrecerá una opción en lugar de ${group.values.length}.`,
      clientFacing: published,
    });
  }

  const stages = context.stages.filter((stage) => stage.metric);
  if (stages.length > 0 && context.sections.journey) {
    surfaces.push({
      id: "recorrido",
      label: "Recorrido",
      detail:
        `Los ${stages.length} momentos del recorrido se recalculan cuando se segmentan por ` +
        `“${dimension}”.`,
      clientFacing: published,
    });
  }

  if (context.comparisonDimensions.includes(dimension)) {
    surfaces.push({
      id: "comparaciones",
      label: "Comparaciones guardadas",
      detail: `Esta característica se usa para comparar resultados; las barras se redibujan.`,
      clientFacing: published,
    });
  }

  if (context.scopedDimensions.includes(dimension)) {
    surfaces.push({
      id: "accesos",
      label: "Accesos de personas del cliente",
      detail:
        "Hay accesos limitados escritos con esta característica. Agrupar no quita ni da acceso " +
        "a nadie — los accesos ya se comparan sin distinguir mayúsculas ni espacios — pero la " +
        "opción que verán al elegir cambia de nombre.",
      clientFacing: true,
    });
  }

  if (context.sections.report) {
    surfaces.push({
      id: "informe",
      label: "Informe PDF",
      detail: published
        ? "El PDF que se genere a partir de ahora usará la categoría agrupada."
        : "El PDF usará la categoría agrupada cuando se publique.",
      clientFacing: published,
    });
  }

  if (context.hasPublishedSnapshot) {
    surfaces.push({
      id: "publicado",
      label: "Lo que el cliente ve ahora mismo",
      detail:
        "No cambia hasta que vuelvas a publicar. El estudio publicado conserva las categorías " +
        "con las que se calculó, para que un informe ya entregado siga siendo reproducible.",
      clientFacing: false,
    });
  }

  return surfaces;
}

/**
 * The full impact of one candidate.
 *
 * `movedRespondents` — the people who would stop being counted under the
 * spelling they answered with — is reported next to `affectedRespondents`
 * because it is the number a consultant actually weighs. Nine people affected
 * where eight keep their label is a smaller change than nine where five move.
 */
export function candidateImpact(
  group: CandidateGroup,
  counts: ReadonlyMap<string, number>,
  context: StudyImpactContext,
  canonicalLabel = group.suggestedLabel,
): CandidateImpact {
  const dimensionTotal =
    context.respondentsPerDimension[group.dimensionKey] ??
    [...counts.values()].reduce((total, count) => total + count, 0);

  const keptFold = foldSegmentValue(canonicalLabel);
  const moved = group.values
    .filter((value) => foldSegmentValue(value.raw) !== keptFold)
    .reduce((total, value) => total + value.count, 0);

  const before = new Set([...counts.keys()].map(foldSegmentValue)).size;
  const after = new Set([...distributionAfter(counts, group, canonicalLabel).keys()].map(foldSegmentValue)).size;

  const surfaces = impactSurfaces(group, context);
  const narrativeMentions = group.values
    .map((value) => value.raw)
    .filter((raw) => mentioned(context.publishedNarrative, raw));

  const share = dimensionTotal > 0 ? group.affectedCount / dimensionTotal : 0;
  const reachesClient = surfaces.some((surface) => surface.clientFacing);

  return {
    dimensionKey: group.dimensionKey,
    groupKey: group.groupKey,
    affectedRespondents: group.affectedCount,
    shareOfDimension: share,
    movedRespondents: moved,
    categoriesBefore: before,
    categoriesAfter: after,
    surfaces,
    narrativeMentions,
    reachesClient,
    materiality: materialityScore({
      share,
      moved,
      reachesClient,
      narrativeMentions: narrativeMentions.length,
      scoped: context.scopedDimensions.includes(group.dimensionKey),
      journey: context.stages.length > 0 && context.sections.journey === true,
    }),
  };
}

/**
 * How much a candidate matters, 0..1.
 *
 * ORDERING ONLY. Nothing decides anything from this number — the publication
 * gate reads the underlying facts, not the score, precisely so that tuning the
 * ordering can never quietly change what blocks a publication.
 *
 * The weights say, in order: how much of the characteristic moves, how many
 * people actually change bucket, whether a client can see it at all, whether
 * the words appear in a reading the firm has already published, and whether the
 * characteristic carries access or journey meaning.
 */
export function materialityScore(input: {
  share: number;
  moved: number;
  reachesClient: boolean;
  narrativeMentions: number;
  scoped: boolean;
  journey: boolean;
}): number {
  // A saturating curve on the moved count: the step from 1 to 4 people matters
  // far more than the step from 40 to 44.
  const movedWeight = 1 - Math.exp(-input.moved / 4);
  const score =
    0.35 * Math.min(1, input.share) +
    0.25 * movedWeight +
    0.15 * (input.reachesClient ? 1 : 0) +
    0.15 * Math.min(1, input.narrativeMentions) +
    0.05 * (input.scoped ? 1 : 0) +
    0.05 * (input.journey ? 1 : 0);
  return Math.round(Math.min(1, score) * 1000) / 1000;
}

/**
 * Candidates ordered as a person should review them.
 *
 * Materiality first, then evidence strength, then a stable alphabetical tie
 * break so the queue never reshuffles between two visits to the same screen.
 */
export function rankCandidates(
  entries: readonly { group: CandidateGroup; impact: CandidateImpact }[],
): { group: CandidateGroup; impact: CandidateImpact }[] {
  const strengthRank = { equivalent: 0, strong: 1, weak: 2 } as const;
  return [...entries].sort(
    (a, b) =>
      b.impact.materiality - a.impact.materiality ||
      strengthRank[a.group.strength] - strengthRank[b.group.strength] ||
      a.group.dimensionKey.localeCompare(b.group.dimensionKey, "es-MX") ||
      (a.group.groupKey < b.group.groupKey ? -1 : 1),
  );
}
