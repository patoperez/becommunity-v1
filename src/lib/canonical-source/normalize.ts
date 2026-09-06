/**
 * ONE CANONICAL ORDER, SO TWO ADAPTERS CAN BE COMPARED AT ALL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM THIS SOLVES. `CanonicalResultSource` says every array arrives in
 * the source's own order. For the in-memory adapter that order is the
 * PROJECTOR's — worksheet by worksheet, column by column. For the database
 * adapter it is whatever a keyset over a uuid primary key returns, which is a
 * hash of the package and therefore arbitrary. Both are legitimate "source
 * order"; neither is convertible into the other.
 *
 * So the two are compared in a THIRD order that neither owns: the natural
 * business key of each family, compared by codepoint. That order is defined
 * here, once, and applied to both sides. The database adapter emits its arrays
 * already in it (see `assemble.ts`), and a gate normalises the in-memory source
 * before comparing, so "semantically identical" becomes deep equality rather
 * than a judgement call.
 *
 * WHY THIS IS SAFE TO DO AT ALL. Every calculator in `src/lib/results` orders
 * what it presents explicitly — by `displayOrder`, by `itemOrder`, by
 * `stageOrder`, or by codepoint — and never by array position. That is not an
 * assumption here: the offline gate builds the whole results document from the
 * normalised source and from the projector's own order and requires the two
 * documents to be byte-identical. If a calculator ever starts depending on
 * array position, that check fails.
 *
 * PURE, DETERMINISTIC, TRANSPORT-FREE. No client, no credential, no `node:`
 * import. It sorts copies and returns a new object; the input is not mutated.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  CanonicalResultSource,
  ResultCuratedFinding,
} from "../results/source";

function codepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Compare by a list of key extractors, in order, stopping at the first difference. */
function by<T>(...keys: Array<(row: T) => string | number>): (a: T, b: T) => number {
  return (a, b) => {
    for (const key of keys) {
      const left = key(a);
      const right = key(b);
      if (typeof left === "number" && typeof right === "number") {
        if (left !== right) return left - right;
        continue;
      }
      const compared = codepoint(String(left), String(right));
      if (compared !== 0) return compared;
    }
    return 0;
  };
}

/**
 * A null sorts BEFORE every real key.
 *
 * The empty string is the sentinel because it is ordinary text and shorter
 * than every key the model uses. An earlier version used a literal NUL: it
 * sorted correctly and made the whole file BINARY to Git, so no diff of it
 * could ever be reviewed. `ids.ts` keeps its own control character out of the
 * source for the same reason.
 */
const nullable = (value: string | null): string => (value === null ? "" : value);

/** Sort a copy. Never the caller's array. */
function sorted<T>(rows: readonly T[], compare: (a: T, b: T) => number): T[] {
  return rows.slice().sort(compare);
}

/**
 * A curated finding has no identifier in the read model — deliberately, because
 * naming one would be the first step towards carrying its prose. It is
 * therefore ordered by its own content, with each link list sorted first so
 * that two adapters that read the same links in different orders produce the
 * same finding.
 */
function normalizeFinding(finding: ResultCuratedFinding): ResultCuratedFinding {
  return {
    reviewStatus: finding.reviewStatus,
    journeyStageKeys: sorted(finding.journeyStageKeys, codepoint),
    organizationalUnitKeys: sorted(finding.organizationalUnitKeys, codepoint),
    performanceDimensionKeys: sorted(finding.performanceDimensionKeys, codepoint),
    cultureDimensionKeys: sorted(finding.cultureDimensionKeys, codepoint),
  };
}

function findingSignature(finding: ResultCuratedFinding): string {
  return [
    finding.reviewStatus,
    finding.journeyStageKeys.join(","),
    finding.organizationalUnitKeys.join(","),
    finding.performanceDimensionKeys.join(","),
    finding.cultureDimensionKeys.join(","),
  ].join("|");
}

/** Put every family of a read-model source into the shared comparison order. */
export function normalizeCanonicalResultSource(source: CanonicalResultSource): CanonicalResultSource {
  const findings = source.curatedFindings.map(normalizeFinding);

  return {
    identity: source.identity,

    participants: sorted(source.participants, by((row) => row.participantId)),

    attributeDefinitions: sorted(source.attributeDefinitions, by((row) => row.key)),

    attributeValues: sorted(
      source.attributeValues,
      by(
        (row) => row.participantId,
        (row) => row.attributeKey,
      ),
    ),

    instruments: sorted(source.instruments, by((row) => row.key)),

    domains: sorted(
      source.domains,
      by(
        (row) => row.instrumentKey,
        (row) => row.key,
      ),
    ),

    items: sorted(
      source.items,
      by(
        (row) => row.instrumentKey,
        (row) => row.key,
      ),
    ),

    scaleOptions: sorted(
      source.scaleOptions,
      by(
        (row) => row.scaleKey,
        (row) => row.rawValue,
      ),
    ),

    sessions: sorted(source.sessions, by((row) => row.sessionId)),

    answers: sorted(
      source.answers,
      by(
        (row) => row.sessionId,
        (row) => row.itemKey,
      ),
    ),

    retentionPeriods: sorted(
      source.retentionPeriods,
      by(
        (row) => row.seriesKey,
        (row) => row.order,
      ),
    ),

    performanceDimensions: sorted(source.performanceDimensions, by((row) => row.key)),

    performanceObservations: sorted(
      source.performanceObservations,
      by(
        (row) => row.participantId,
        (row) => row.dimensionKey,
        (row) => row.periodStart,
      ),
    ),

    bandSchemes: sorted(source.bandSchemes, by((row) => row.key)).map((scheme) => ({
      ...scheme,
      rules: sorted(scheme.rules, by((rule) => rule.displayOrder)),
    })),

    metricDefinitions: sorted(source.metricDefinitions, by((row) => row.key)),

    journeyModels: sorted(source.journeyModels, by((row) => row.key)),

    journeyStages: sorted(
      source.journeyStages,
      by(
        (row) => row.journeyModelKey,
        (row) => row.key,
      ),
    ),

    journeyStageEvidence: sorted(
      source.journeyStageEvidence,
      by(
        (row) => row.journeyStageKey,
        (row) => row.role,
        (row) => nullable(row.metricKey),
        (row) => nullable(row.itemKey),
        (row) => nullable(row.performanceDimensionKey),
      ),
    ),

    organizationalUnits: sorted(source.organizationalUnits, by((row) => row.key)),

    cultureDimensions: sorted(
      source.cultureDimensions,
      by(
        (row) => row.audience,
        (row) => row.key,
      ),
    ),

    curatedFindings: sorted(findings, by(findingSignature)),
  };
}
