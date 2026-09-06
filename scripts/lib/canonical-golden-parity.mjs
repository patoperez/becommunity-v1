// =============================================================================
// The GOLDEN PARITY comparison, shared by every gate that performs it
// =============================================================================
// WHY THIS IS ONE MODULE AND NOT TWO COPIES. Two gates now compare a canonical
// results document against the values recorded from the CEO-approved dashboard:
// the in-memory one (`canonical-results-parity.mjs`, which builds the projection
// from the two workbooks) and the database-backed one
// (`canonical-database-parity.mjs`, which reads the committed package back out
// of the canonical tables). If each carried its own resolver, "531/531 from the
// database" and "531/531 from memory" would be two different claims about two
// different comparisons, and a drift between them would look like agreement.
// They call this.
//
// IT IS PURE AND OFFLINE. No transport, no client, no write: it reads one JSON
// fixture and evaluates a finished results document against it. Both gates walk
// their own module graph and fail if any of it reaches a database or the
// network, so this file has to stay that way.
//
// EVERY CATEGORY IS REPORTED SEPARATELY, never collapsed into one number:
// offered, executed, passed, failed, skipped, unresolved, not-applicable and
// configuration-required. The last three are not passes and not failures.
// `not_applicable` means no approved value exists to compare against;
// `configuration_required` means the content comes from study configuration or
// editorial review rather than a calculation; `unresolved` means a genuine open
// question, and none remain for this study.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const GOLDEN_FIXTURE_PATH = join("scripts", "fixtures", "cuicuilco-golden-parity.v1.json");

/** The approved dashboard the fixture was derived from. Nothing else may be. */
export const REQUIRED_DASHBOARD_COMMIT = "a7248fdbccd139da80ed7c09daa70f006a62b9cf";

export function loadGoldenFixture(path = GOLDEN_FIXTURE_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Sentinel for an expectation no resolver in this file knows how to answer. */
export const NOT_COMPARABLE = Symbol("not-comparable");

/**
 * Resolve every expectation of the fixture against ONE results document.
 *
 * The document is the only input: this function cannot see a plan, a workbook,
 * a row or a database, so the same call answers for the in-memory adapter and
 * for the database-backed one and the two answers are comparable by
 * construction.
 */
export function evaluateGoldenParity(results, fixture) {
  const cohort = (key) => results.population.cohorts.find((entry) => entry.key === key) ?? null;
  const scopeFor = (key) => results.recommendation.scopes.find((entry) => entry.key === key) ?? null;
  const metricValue = (metric) => (metric && metric.status === "available" ? metric.value.value : undefined);
  const metricBand = (metric) =>
    metric && metric.status === "available" && metric.value.band ? metric.value.band.semanticColor : undefined;

  const groupTouchpoints = (groupIndex) => {
    const group = results.journey.groups[groupIndex];
    if (!group) return [];
    return group.touchpointKeys.map((key) => results.journey.touchpoints.find((tp) => tp.key === key));
  };
  const globalPositions = (groupIndex) => {
    let offset = 0;
    for (let index = 0; index < groupIndex; index += 1) {
      offset += results.journey.groups[index]?.touchpointKeys.length ?? 0;
    }
    return groupTouchpoints(groupIndex).map((_, index) => offset + index);
  };

  const NOT_COMPARABLE = Symbol("not-comparable");

  function actualFor(expectation) {
    const id = expectation.id;

    if (id === "population.total") return results.population.total;
    if (id === "population.measured") return results.population.measured;
    if (id === "population.active") return cohort("active")?.total;
    if (id === "population.former") return cohort("deserter")?.total;
    if (id === "population.formerMeasured") return cohort("deserter")?.measured;
    if (id === "population.formerAnswered") return cohort("deserter")?.responded;
    if (id === "population.formerWithoutMeasuredData") {
      const deserters = cohort("deserter");
      return deserters ? deserters.total - deserters.measured : undefined;
    }
    if (id === "population.instrument.nps.responses") return scopeFor("combinado")?.score.base.valid;
    if (id === "population.instrument.csat.responses") {
      return results.population.instruments.find((entry) => entry.key === "csat")?.base.valid;
    }
    if (id === "population.instrument.cri.responses") return results.renewal.base.valid;

    let match = /^retention\.(\d+)\.(\w+)$/.exec(id);
    if (match) {
      const period = results.retention.periods[Number(match[1])];
      if (!period) return undefined;
      switch (match[2]) {
        case "starting":
          return period.starting.count;
        case "joined":
          return period.joined.count;
        case "ending":
          return period.ending.count;
        case "lost":
          return period.lost.count;
        case "retention":
          return metricValue(period.retention);
        case "churn":
          return metricValue(period.attrition);
        default:
          return undefined;
      }
    }

    match = /^nps\.([a-z]+)\.(\w+)$/.exec(id);
    if (match) {
      const scope = scopeFor(match[1]);
      if (!scope) return undefined;
      switch (match[2]) {
        case "nps":
          return metricValue(scope.score);
        case "promoters":
          return scope.distribution.promoters;
        case "passives":
          return scope.distribution.passives;
        case "detractors":
          return scope.distribution.detractors;
        case "total":
          return scope.score.base.valid;
        default:
          return undefined;
      }
    }

    if (id === "cri.value") return metricValue(results.renewal.index);
    if (id === "cri.total") return results.renewal.base.valid;
    if (id === "cri.bandId") return metricBand(results.renewal.index);
    if (id.startsWith("cri.distribution.")) {
      return (results.renewal.distribution ?? []).find((entry) => entry.response === expectation.response)?.count;
    }

    if (id === "journey.touchpointCount") return results.journey.touchpoints.length;
    if (id === "journey.groupCount") return results.journey.groups.length;

    match = /^journey\.group\.(\d+)\.(size|positions)$/.exec(id);
    if (match) {
      const groupIndex = Number(match[1]);
      return match[2] === "size"
        ? results.journey.groups[groupIndex]?.touchpointKeys.length
        : globalPositions(groupIndex);
    }

    match = /^journey\.(\d+)\.(\d+)\.(\w+)$/.exec(id);
    if (match) {
      const touchpoint = groupTouchpoints(Number(match[1]))[Number(match[2])];
      if (!touchpoint) return undefined;
      switch (match[3]) {
        case "satisfied":
          return touchpoint.counts.satisfied;
        case "dissatisfied":
          return touchpoint.counts.dissatisfied;
        case "unaware":
          return touchpoint.counts.unaware;
        case "valid":
          return touchpoint.counts.valid;
        case "responses":
          return touchpoint.counts.responses;
        case "csat":
          return metricValue(touchpoint.satisfaction);
        case "tdp":
          return metricValue(touchpoint.tdp);
        case "band":
          return metricBand(touchpoint.satisfaction);
        default:
          return undefined;
      }
    }

    match = /^qualitative\.([a-z]+)\.(total|excludedCount)$/.exec(id);
    if (match) {
      const group = results.qualitative.groups.find((entry) => entry.key === match[1]);
      if (!group) return undefined;
      if (match[2] === "total") return group.total;
      // The approved dashboard renames the excluded category for display
      // («Sin razón aplicable») while the canonical model keeps the source's own
      // token («No aplica»). The comparable quantity is how many people had no
      // applicable reason, so the group's excluded counts are summed rather than
      // matched by a display label the source never used.
      return group.excluded.reduce((sum, entry) => sum + entry.count, 0);
    }

    if (id.startsWith("qualitative.") && expectation.termLabel) {
      const group = results.qualitative.groups.find((entry) => entry.key === expectation.groupKey);
      return group?.terms.find((term) => term.label === expectation.termLabel)?.count;
    }

    return NOT_COMPARABLE;
  }

  const sameValue = (expected, actual) => {
    if (Array.isArray(expected)) {
      return Array.isArray(actual) && expected.length === actual.length && expected.every((value, index) => value === actual[index]);
    }
    return Object.is(expected, actual);
  };
  const outcome = {
    offered: 0,
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    unresolved: 0,
    notApplicable: 0,
    configurationRequired: 0,
  };
  const mismatches = [];
  const skipped = [];
  const classified = [];
  const unknownStatuses = [];

  for (const expectation of fixture.expectations) {
    outcome.offered += 1;
    if (expectation.status === "unresolved") {
      outcome.unresolved += 1;
      classified.push(expectation);
      continue;
    }
    if (expectation.status === "not_applicable") {
      outcome.notApplicable += 1;
      classified.push(expectation);
      continue;
    }
    if (expectation.status === "configuration_required") {
      outcome.configurationRequired += 1;
      classified.push(expectation);
      continue;
    }
    if (expectation.status !== "expected") {
      unknownStatuses.push(expectation);
      continue;
    }
    const actual = actualFor(expectation);
    if (actual === NOT_COMPARABLE || actual === undefined) {
      outcome.skipped += 1;
      skipped.push({
        expectation,
        reason: actual === NOT_COMPARABLE ? "sin resolvedor" : "el documento no produce este valor",
      });
      continue;
    }
    outcome.executed += 1;
    if (sameValue(expectation.expected, actual)) {
      outcome.passed += 1;
    } else {
      outcome.failed += 1;
      mismatches.push({ expectation, actual });
    }
  }

  const bySection = new Map();
  for (const expectation of fixture.expectations) {
    const entry = bySection.get(expectation.section) ?? { offered: 0, failed: 0, classified: 0 };
    entry.offered += 1;
    if (expectation.status !== "expected") entry.classified += 1;
    bySection.set(expectation.section, entry);
  }
  for (const mismatch of mismatches) {
    const entry = bySection.get(mismatch.expectation.section);
    if (entry) entry.failed += 1;
  }

  return { outcome, mismatches, skipped, classified, unknownStatuses, bySection };
}

/** The one-line summary both gates print, so both print the same sentence. */
export function formatGoldenSummary(outcome) {
  return (
    `ofrecidas=${outcome.offered} ejecutadas=${outcome.executed} aprobadas=${outcome.passed} ` +
    `falladas=${outcome.failed} omitidas=${outcome.skipped} sin-resolver=${outcome.unresolved} ` +
    `no-aplica=${outcome.notApplicable} requieren-configuración=${outcome.configurationRequired}`
  );
}
