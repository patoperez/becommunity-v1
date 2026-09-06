/**
 * QUALITATIVE — category labels and counts. Never anybody's words.
 *
 * Two different kinds of qualitative aggregate live here, and they are not the
 * same thing:
 *
 *   1. CODED CATEGORY COUNTS. The source's own closed-coded category columns —
 *      one per cohort — counted per label. The category vocabulary is short,
 *      closed and emergent by design («se categoriza con una lista que se van
 *      creando según lo que contestan»), so the labels ARE the data and the
 *      free-text column beside each of them never enters the read model.
 *
 *   2. CURATED FINDING COUNTS. How many curated pain-map findings attach to
 *      each curated entity, through the real foreign keys the projection wrote.
 *      Counts only: that map is consultant prose nobody has cleared for
 *      publication, and `reviewStatus` says so.
 *
 * A term cloud's SIZE is a visual decision that belongs to the interface. This
 * contract carries counts and shares; how large a word is drawn changes nothing
 * about the mathematical domain and is not decided here.
 *
 * A documented "not a reason" category is EXCLUDED from the cloud and REPORTED
 * with its count, rather than silently dropped — the reader can see that nine
 * people had no applicable reason, which is itself a finding.
 */

import type {
  CuratedFindingCount,
  QualitativeGroupResult,
  QualitativeTerm,
} from "./contract";
import { buildLookup, scopeParticipants, type ResultLookup, type ResultScope } from "./lookup";
import { countStatus, makeAccounting, makeBase, makeProvenance, share } from "./measure";
import type { CanonicalResultSource } from "./source";
import type { StudyResultsSpec } from "./spec";

function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildQualitativeGroups(
  source: CanonicalResultSource,
  spec: StudyResultsSpec,
  scope: ResultScope,
  lookup: ResultLookup = buildLookup(source),
): QualitativeGroupResult[] {
  return spec.qualitative.map((groupSpec) => {
    const item = lookup.itemByKey.get(groupSpec.itemKey);
    const instrumentKey = item?.instrumentKey ?? null;
    const sessionIds = new Set(
      (instrumentKey ? lookup.sessionsByInstrument.get(instrumentKey) ?? [] : [])
        .filter((session) => scope.participantIds.has(session.participantId))
        .map((session) => session.sessionId),
    );

    const accounting = makeAccounting();
    const counts = new Map<string, number>();
    const excludedCounts = new Map<string, number>(groupSpec.excludedLabels.map((entry) => [entry.label, 0]));
    const excludedByText = new Set(
      groupSpec.excludedLabels.filter((entry) => entry.canonicalStatus === null).map((entry) => entry.label),
    );
    // A documented category the canonical classifier turned into an absence
    // state before this column was ever read. Recovering its count from that
    // state is exact — only that one token maps to it — and it is the
    // difference between reporting "nine people had no applicable reason" and
    // reporting nothing at all.
    const excludedByStatus = new Map(
      groupSpec.excludedLabels
        .filter((entry) => entry.canonicalStatus !== null)
        .map((entry) => [entry.canonicalStatus as string, entry.label]),
    );
    let records = 0;
    let coded = 0;

    for (const answer of lookup.answersByItem.get(groupSpec.itemKey) ?? []) {
      if (!sessionIds.has(answer.sessionId)) continue;
      records += 1;
      countStatus(accounting, answer.status, answer.numeric);
      if (answer.status !== "answered") {
        const recovered = excludedByStatus.get(answer.status);
        if (recovered !== undefined) {
          // Reported in `excluded`, and already partitioned into its own absence
          // state by `countStatus`. It is NOT added to `phenomenon`: the
          // contract declares that field a subset of `answered`, and this record
          // is not answered.
          excludedCounts.set(recovered, (excludedCounts.get(recovered) ?? 0) + 1);
        }
        continue;
      }
      const label = answer.text;
      if (label === null || label === "") {
        accounting.outOfScale += 1;
        continue;
      }
      if (excludedByText.has(label)) {
        excludedCounts.set(label, (excludedCounts.get(label) ?? 0) + 1);
        accounting.phenomenon += 1;
        continue;
      }
      // Counted only once the label is known to be a reported category, so
      // `coded` — which becomes `base.valid` — stays the denominator every
      // `share` below actually rests on, whichever way a category is excluded.
      coded += 1;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const terms: QualitativeTerm[] = [...counts.entries()]
      // Descending by count, then by label, so ordering never depends on a hash.
      .sort((a, b) => (b[1] - a[1]) || codepointCompare(a[0], b[0]))
      .map(([label, count]) => ({ label, count, share: share(count, total) }));

    const eligible = scopeParticipants(lookup, scope, groupSpec.cohortKeys).length;

    return {
      key: groupSpec.key,
      label: groupSpec.label,
      cohortKeys: groupSpec.cohortKeys,
      sourceDescription: groupSpec.sourceDescription,
      total,
      base: makeBase(eligible, records, coded, accounting),
      excluded: [...excludedCounts.entries()]
        .sort((a, b) => codepointCompare(a[0], b[0]))
        .map(([label, count]) => ({ label, count })),
      terms,
      reviewStatus: "pending",
      provenance: makeProvenance({
        calculationVersion: spec.calculationVersion,
        explanation:
          "Con qué frecuencia aparece cada categoría entre las razones que las personas dieron. " +
          "El tamaño con que una categoría se dibuje es una decisión de la interfaz y no altera " +
          "estos conteos.",
        sources: ["survey_response", "survey_item"],
        authorityIds: groupSpec.authorityIds,
        notes: [
          "Sólo se leen las columnas de categoría cerrada. La columna de texto libre contigua no " +
            "entra al modelo de lectura en ninguna forma, así que una respuesta textual no puede " +
            "agregarse ni siquiera por error.",
          "«pending» describe el estado de revisión editorial: estas categorías son la codificación " +
            "de la propia fuente, no un artefacto de revisión de Be Community, así que la frontera " +
            "de publicación debe decidir sobre ellas antes de mostrarlas a un cliente.",
          "Una categoría documentada como «no aplica» viaja como estado de ausencia canónico, no como " +
            "texto de respuesta, y su conteo se recupera desde ese estado. Se reporta aparte y nunca " +
            "entra a la nube.",
        ],
      }),
    };
  });
}

/** Counts of curated findings per curated entity. Labels of ENTITIES, never of findings. */
export function buildCuratedFindingCounts(source: CanonicalResultSource): CuratedFindingCount[] {
  const stageLabels = new Map(source.journeyStages.map((stage) => [stage.key, stage.label]));
  const unitLabels = new Map(source.organizationalUnits.map((unit) => [unit.key, unit.label]));
  const dimensionLabels = new Map(source.performanceDimensions.map((d) => [d.key, d.label]));
  const cultureLabels = new Map(source.cultureDimensions.map((d) => [d.key, d.label]));

  type Bucket = { count: number; statuses: Set<string> };
  const buckets = new Map<string, Bucket>();

  const add = (kind: CuratedFindingCount["entityKind"], key: string, status: string): void => {
    const id = `${kind}|${key}`;
    const bucket = buckets.get(id);
    if (bucket) {
      bucket.count += 1;
      bucket.statuses.add(status);
    } else {
      buckets.set(id, { count: 1, statuses: new Set([status]) });
    }
  };

  for (const finding of source.curatedFindings) {
    for (const key of finding.journeyStageKeys) add("journey_stage", key, finding.reviewStatus);
    for (const key of finding.organizationalUnitKeys) add("organizational_unit", key, finding.reviewStatus);
    for (const key of finding.performanceDimensionKeys) add("performance_dimension", key, finding.reviewStatus);
    for (const key of finding.cultureDimensionKeys) add("culture_dimension", key, finding.reviewStatus);
  }

  const labelFor = (kind: CuratedFindingCount["entityKind"], key: string): string => {
    if (kind === "journey_stage") return stageLabels.get(key) ?? key;
    if (kind === "organizational_unit") return unitLabels.get(key) ?? key;
    if (kind === "performance_dimension") return dimensionLabels.get(key) ?? key;
    return cultureLabels.get(key) ?? key;
  };

  return [...buckets.entries()]
    .sort((a, b) => codepointCompare(a[0], b[0]))
    .map(([id, bucket]) => {
      const [kind, key] = id.split("|") as [CuratedFindingCount["entityKind"], string];
      const statuses = [...bucket.statuses];
      const reviewStatus: CuratedFindingCount["reviewStatus"] =
        statuses.length > 1 ? "mixed" : statuses[0] === "confirmed" ? "confirmed" : "pending";
      return { entityKind: kind, entityKey: key, entityLabel: labelFor(kind, key), count: bucket.count, reviewStatus };
    });
}
