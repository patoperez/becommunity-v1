/**
 * THE RUNTIME-SAFE PROJECTION — what a running server may hand to a sink.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SECOND SHAPE. `ShadowDiagnostics` is LOCAL OPERATOR evidence: it exists
 * for the length of one call, a human is watching the terminal it is printed
 * to, and it may carry the aggregates both layers already publish because that
 * is the whole point of a comparison report. A RECORD IS DIFFERENT. A record
 * outlives the request, may be written somewhere, and is read later by someone
 * who no longer has the context that made a number safe — so it carries codes
 * and totals and NO NUMBERS AT ALL.
 *
 * NO VALUES, RATHER THAN SMALL VALUES. The obvious rule would be "omit a value
 * whose base is under the disclosure threshold". That rule needs the base to
 * decide, needs to know which fields share a base, and needs re-deciding every
 * time a finding is added — three chances to be wrong, in the one place being
 * wrong is unrecoverable. `sampleVisibility` already suppresses below five
 * people (`calc/disclosure.ts`), and a FILTERED selection can sit just above
 * that threshold and still name one person to somebody who knows the segment.
 * So the record drops `legacyValue`, `canonicalValue`, `legacyBase` and
 * `canonicalBase` outright, filtered or not. What survives is what the audit
 * asked for: agreement and mismatch codes, and totals.
 *
 * IT IS A WHITELIST, NOT A REDACTION. Nothing is copied from the diagnostics
 * and then cleaned. Each field is read by name, checked against the closed list
 * it must belong to, and DROPPED if it is not there — so a field added to
 * `ShadowFinding` tomorrow does not silently appear in a record, and a value
 * that somehow reached a closed field is refused rather than logged.
 *
 * PURE. No `server-only`, no `process.env`, no client, no `fetch`, no Node
 * builtin — the offline gate asserts as much for every file in this folder
 * except `server.ts` and `sink.ts`, and this file is one of them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  COMPARISON_RULES,
  COMPATIBILITY_CLASSIFICATIONS,
  MISMATCH_KINDS,
  NOTE_CODES,
  SHADOW_FINDING_KEYS,
  SHADOW_SECTIONS,
  SHADOW_STATUSES,
  type ComparisonRule,
  type CompatibilityClassification,
  type MismatchKind,
  type NoteCode,
  type ShadowDiagnostics,
  type ShadowFindingKey,
  type ShadowSection,
  type ShadowStatus,
} from "./contract";

/** A uuid, and nothing that merely resembles one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `sha256:<64 hex>` — the shape migrations 0026 and 0028 enforce. */
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** The results contract version, e.g. `2.0.0`. Three numbers and two dots. */
const CONTRACT_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/**
 * A legacy segment key conservative enough to record.
 *
 * A segment key is whatever column the study's workbook carried, so it is the
 * one string here that is not from a closed list. Lowercase, digits and
 * underscores, starting with a letter and at most forty characters: enough for
 * `estado_membresia` and `perfil_cliente_h`, and not enough for a sentence, an
 * accented name, an address or an e-mail. A key that fails this is counted in
 * `dimensionCount` and left out of `dimensionKeys`.
 */
const SAFE_DIMENSION_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** One finding, reduced to codes. There is no field here that holds a number. */
export type ShadowRuntimeFinding = {
  key: ShadowFindingKey;
  section: ShadowSection;
  classification: CompatibilityClassification;
  agrees: boolean | null;
  mismatch: MismatchKind | null;
  rule: ComparisonRule;
  noteCode: NoteCode | null;
};

/**
 * One shadow run, reduced to codes and totals. Safe to log, store and read back.
 *
 * THE DIMENSION KEYS ARE NOT HERE, and that is deliberate. A legacy segment key
 * is the one string in the whole diagnostic that does not come from a closed
 * list — it is whatever column the study's workbook carried, and `calc/filters`
 * derives it from the row keys minus a nine-name reserved set. A shape check
 * keeps out a sentence; it cannot keep out a column somebody named
 * `correo_socio`. The LOCAL operator evidence carries the keys, where a human
 * is reading them and nothing is stored; the RECORD carries the count.
 *
 * The consequence is a property worth having: every string in this type is
 * either a member of a closed list declared in `contract.ts`, a uuid, a
 * `sha256:` digest or a dotted version number. There is no free text anywhere.
 */
export type ShadowRuntimeRecord = {
  status: ShadowStatus;
  tenantId: string;
  studyId: string;
  filtered: boolean;
  filterDimensionCount: number;
  contractVersion: string | null;
  planFingerprint: string | null;
  packageIdempotencyKey: string | null;
  budgetMs: number;
  elapsedMs: number;
  counts: { compared: number; agreed: number; disagreed: number; classified: number };
  findings: ShadowRuntimeFinding[];
};

/** A member of a closed list, or null. Never the value that was not a member. */
function oneOf<T extends string>(allowed: readonly T[], candidate: unknown): T | null {
  if (typeof candidate !== "string") return null;
  return allowed.find((entry) => entry === candidate) ?? null;
}

/** A finite non-negative integer, or zero. A count is never a float or a NaN. */
function count(candidate: unknown): number {
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 0) return 0;
  return candidate;
}

/** A string matching an exact shape, or null. */
function shaped(pattern: RegExp, candidate: unknown): string | null {
  if (typeof candidate !== "string" || !pattern.test(candidate)) return null;
  return candidate;
}

/**
 * The dimension KEYS worth recording, sorted and deduplicated.
 *
 * A key that is not plainly a machine identifier is dropped. It is never
 * truncated, hashed or described: a partial value is still a value.
 */
export function safeDimensionKeys(keys: readonly unknown[]): string[] {
  const kept = new Set<string>();
  for (const key of keys) {
    if (typeof key === "string" && SAFE_DIMENSION_KEY.test(key)) kept.add(key);
  }
  return [...kept].sort();
}

/**
 * Turn one run's local evidence into the record a sink may keep.
 *
 * Every field is read by name and validated against its closed list. A finding
 * whose key or section is not in the contract is DROPPED WHOLE rather than
 * partially recorded, because a key that is not in the list is by definition a
 * key nobody proved was safe.
 */
export function runtimeShadowRecord(diagnostics: ShadowDiagnostics): ShadowRuntimeRecord {
  const findings: ShadowRuntimeFinding[] = [];
  for (const finding of diagnostics.findings ?? []) {
    const key = oneOf(SHADOW_FINDING_KEYS, finding?.key);
    const section = oneOf(SHADOW_SECTIONS, finding?.section);
    const classification = oneOf(COMPATIBILITY_CLASSIFICATIONS, finding?.classification);
    const rule = oneOf(COMPARISON_RULES, finding?.rule);
    if (key === null || section === null || classification === null || rule === null) continue;
    findings.push({
      key,
      section,
      classification,
      agrees: typeof finding.agrees === "boolean" ? finding.agrees : null,
      mismatch: oneOf(MISMATCH_KINDS, finding.mismatch),
      rule,
      noteCode: oneOf(NOTE_CODES, finding.noteCode),
    });
  }

  return {
    status: oneOf(SHADOW_STATUSES, diagnostics.status) ?? "comparator_error",
    tenantId: shaped(UUID, diagnostics.tenantId) ?? "",
    studyId: shaped(UUID, diagnostics.studyId) ?? "",
    filtered: diagnostics.filterScope?.filtered === true,
    filterDimensionCount: count(diagnostics.filterScope?.dimensionCount),
    contractVersion: shaped(CONTRACT_VERSION, diagnostics.contractVersion),
    planFingerprint: shaped(DIGEST, diagnostics.planFingerprint),
    packageIdempotencyKey: shaped(DIGEST, diagnostics.packageIdempotencyKey),
    budgetMs: count(diagnostics.budgetMs),
    elapsedMs: count(diagnostics.elapsedMs),
    counts: {
      compared: count(diagnostics.counts?.compared),
      agreed: count(diagnostics.counts?.agreed),
      disagreed: count(diagnostics.counts?.disagreed),
      classified: count(diagnostics.counts?.classified),
    },
    findings,
  };
}
