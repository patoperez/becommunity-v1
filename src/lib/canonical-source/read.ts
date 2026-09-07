/**
 * READING ONE COMMITTED PACKAGE BACK OUT OF THE CANONICAL TABLES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TRANSPORT IS INJECTED, exactly as it is in `canonical-commit/flow.ts`.
 * The safety properties here are an ORDER and a SET OF REFUSALS — scope every
 * read by tenant AND study, page every set by a unique key, refuse a set that
 * outgrows its ceiling instead of truncating it, refuse a study whose committed
 * packages are not exactly one — and an untestable refusal is an unproved one.
 * A `CanonicalReadTransport` is a single `readPage` call, so the whole workflow
 * runs against a fake in the offline gate while `adapter.ts` supplies the real
 * `SupabaseClient`. This module holds no client, no credential and no privilege.
 *
 * WHY IT PAGES, AND WHY IT REFUSES RATHER THAN TRUNCATES. PostgREST caps every
 * response at `max_rows` (1000 for this project) and applies the cap SILENTLY:
 * a `.limit(200000)` returns 1000 rows with HTTP 200 and no error. That defect
 * has already been paid for once in this repository — see
 * `src/lib/supabase/paginate.ts` — and the rule it produced is repeated here
 * rather than assumed: never read a set that can exceed the cap in one request,
 * never stop quietly, and never trust the caller to have ordered the query.
 *
 * WHY THE KEYSET CAN BE COMPOSITE. Four of the tables read here — the pain
 * point link tables — have a two-column primary key and no `id`. Paging them
 * by one column would either skip rows or repeat them, so a page is ordered by
 * the full key and the window is the lexicographic "strictly after this tuple".
 *
 * WHY EVERY CURSOR VALUE MUST BE A UUID. The window is expressed to PostgREST
 * as a filter string containing the value. A value carrying a comma, a
 * parenthesis or a dot would be parsed as filter SYNTAX, not as data. Every key
 * column in every read here is a `uuid`, so the workflow refuses any cursor
 * value that is not one and the filter can never be anything but a filter.
 *
 * WHAT NEVER CROSSES. No name, no external identifier, no lineage row, no
 * qualitative prose: those columns are not in `rows.ts` and no `select` here
 * asks for them. And no PostgreSQL message is ever returned or logged — this
 * schema's constraint messages quote respondent data, so a transport error is
 * reduced to a code by `safeErrorCode` and the message is discarded.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT CANCELS, AND WHY IT IS CONCURRENT. (Unit 5 Phase 3.1.)
 *
 * CANCELLATION. Every request carries an optional `AbortSignal` all the way to
 * `PostgrestTransformBuilder.abortSignal`, and the paging loop CHECKS IT BEFORE
 * ASKING FOR THE NEXT PAGE. Both halves are needed and neither is sufficient:
 * without the signal on the query the request in flight keeps running after its
 * caller gave up, and without the loop check the read would obediently start
 * page four of a set nobody is waiting for. A cancelled read throws `READ_ABORTED`, which
 * is a code like every other refusal here — never a message.
 *
 * CONCURRENCY. Reading twenty-six independent families one after another cost
 * about 4.86 seconds against the hosted project, which is most of the shadow's
 * entire budget spent on latency rather than on data: the Cuicuilco package is
 * 3 244 rows across 28 requests — one committed-package gate, twenty-six
 * families, and one overflow page because `survey_response` holds 1 685 rows
 * against a 1 000-row page — so the wall time was 28 round trips, not the
 * volume. The families are INDEPENDENT — nothing in one read's request depends
 * on another read's rows; only `resolveCommittedJob` must come first, because
 * its manifest names the spec — so they are now read through a bounded pool.
 *
 * WHAT BOUNDED CONCURRENCY MUST NOT COST, and does not:
 *   scope        every request still carries tenant AND study; the pool never
 *                touches the request, it only decides when to issue it.
 *   ceilings     each family keeps its own `maxRows` refusal threshold.
 *   ordering     paging WITHIN a family stays strictly sequential, because the
 *                keyset cursor is the previous page's last row; and each
 *                family's array is placed by INDEX, so the returned row set is
 *                byte-identical to the sequential one.
 *   completeness one failure fails the whole load. No new task starts after the
 *                first refusal, every started task is awaited, and the error
 *                reported is the LOWEST-INDEXED one, so the refusal a caller
 *                sees does not depend on which request happened to lose a race.
 *   cancellation the pool stops issuing on abort as well as on failure.
 *
 * WHY THE LIMIT IS SIX. This runs inside a Cloudflare Worker, which allows a
 * maximum of six simultaneous open outbound connections per invocation; asking
 * for more does not fail, it queues, so a larger number would buy nothing and
 * would misdescribe what the code is doing. Six is also gentle on PostgREST:
 * the read is six small `select`s at a time against one study, not a fan-out.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { safeErrorCode } from "../ingestion/canonical-commit/result";
import type {
  AttributeDefinitionRow,
  BandRuleRow,
  BandSchemeRow,
  CanonicalRowSet,
  CanonicalTableRead,
  CultureDimensionRow,
  ImportJobRow,
  JourneyModelRow,
  JourneyStageEvidenceLinkRow,
  JourneyStageRow,
  MetricDefinitionRow,
  OrganizationalUnitRow,
  PainPointCultureDimensionRow,
  PainPointJourneyStageRow,
  PainPointOrganizationalUnitRow,
  PainPointPerformanceDimensionRow,
  PainPointRow,
  ParticipantAttributeValueRow,
  PerformanceDimensionRow,
  PerformanceObservationRow,
  ResponseOptionRow,
  ResponseScaleRow,
  RetentionPeriodRow,
  StudyDomainRow,
  StudyParticipantRow,
  SurveyInstrumentRow,
  SurveyItemRow,
  SurveyResponseRow,
  SurveySessionRow,
} from "./rows";

/** PostgREST's own page size for this project (`supabase/config.toml`). */
export const CANONICAL_READ_PAGE_SIZE = 1000;

/**
 * How many family reads may be in flight at once.
 *
 * Six, because a Cloudflare Worker allows six simultaneous open outbound
 * connections per invocation. A seventh would queue behind the six rather than
 * fail, so a larger number would describe an intent the platform does not
 * honour.
 */
export const CANONICAL_READ_CONCURRENCY = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type CanonicalReadScope = { tenantId: string; studyId: string };

export type CanonicalReadRequest = {
  table: string;
  columns: readonly string[];
  keyColumns: readonly string[];
  scope: CanonicalReadScope;
  /** The last row of the previous page, keyed by `keyColumns`. Null on the first. */
  cursor: Record<string, string> | null;
  limit: number;
  /** Extra equality filters. Used only for `import_job.status`. */
  equals?: Readonly<Record<string, string>>;
  /**
   * Cancellation, carried all the way to the underlying `fetch`. Optional so
   * the offline gate and the command-line operators can call the workflow
   * without one; supplied by every caller that has a budget.
   */
  signal?: AbortSignal;
};

/** One page of one table. The only thing this workflow can do to the outside. */
export type CanonicalReadTransport = {
  readPage: (request: CanonicalReadRequest) => Promise<{
    rows: Record<string, unknown>[] | null;
    error: unknown;
  }>;
};

export class CanonicalReadError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.name = "CanonicalReadError";
  }
}

/**
 * Every read this folder performs, declared in one place.
 *
 * A ceiling is a REFUSAL THRESHOLD, not a page size, and each one is set well
 * above the largest set this study can produce so that growth is reported
 * rather than silently truncated. The largest by far is `survey_response`,
 * whose real Cuicuilco package holds 1 685 rows.
 */
export const CANONICAL_READS = {
  importJob: {
    table: "import_job",
    // `manifest->plan` is the privacy-safe plan header the commit stored:
    // spec id, mapping version, fingerprint, package key and expected counts.
    // Selecting the whole manifest would drag the entire preflight report
    // through the process for five scalars.
    columns: ["id", "idempotency_key", "mapping_version", "status", "committed_at", "manifest->plan"],
    keyColumns: ["id"],
    maxRows: 200,
  },
  participants: {
    table: "study_participant",
    columns: ["id", "cohort_key", "participation_status", "survey_participation_status", "source_status"],
    keyColumns: ["id"],
    maxRows: 20_000,
  },
  attributeDefinitions: {
    table: "attribute_definition",
    columns: ["id", "key", "label", "data_type", "sensitivity", "filterable", "display_order"],
    keyColumns: ["id"],
    maxRows: 2_000,
  },
  attributeValues: {
    table: "participant_attribute_value",
    columns: ["id", "participant_id", "attribute_definition_id", "status", "value_text", "value_numeric"],
    keyColumns: ["id"],
    maxRows: 400_000,
  },
  responseScales: {
    table: "response_scale",
    columns: ["id", "key"],
    keyColumns: ["id"],
    maxRows: 2_000,
  },
  responseOptions: {
    table: "response_option",
    columns: ["id", "response_scale_id", "raw_value", "numeric_value", "derived_label", "display_order"],
    keyColumns: ["id"],
    maxRows: 20_000,
  },
  instruments: {
    table: "survey_instrument",
    columns: ["id", "key", "label", "audience", "instrument_type"],
    keyColumns: ["id"],
    maxRows: 2_000,
  },
  domains: {
    table: "study_domain",
    columns: ["id", "survey_instrument_id", "key", "label", "display_order", "visual_annotation_id"],
    keyColumns: ["id"],
    maxRows: 5_000,
  },
  items: {
    table: "survey_item",
    columns: ["id", "survey_instrument_id", "study_domain_id", "response_scale_id", "key", "label", "item_order"],
    keyColumns: ["id"],
    maxRows: 20_000,
  },
  sessions: {
    table: "survey_session",
    columns: ["id", "survey_instrument_id", "participant_id", "status"],
    keyColumns: ["id"],
    maxRows: 100_000,
  },
  responses: {
    table: "survey_response",
    columns: [
      "id",
      "survey_session_id",
      "survey_item_id",
      "response_option_id",
      "status",
      "value_numeric",
      "value_text",
      "source_derived_label",
    ],
    keyColumns: ["id"],
    maxRows: 2_000_000,
  },
  retentionPeriods: {
    table: "retention_period",
    columns: [
      "id",
      "series_key",
      "period_order",
      "period_label",
      "period_starts_on",
      "period_ends_on",
      "starting_status",
      "starting_count",
      "new_status",
      "new_count",
      "ending_status",
      "ending_count",
      "lost_status",
      "lost_count",
      "identity_verified",
    ],
    keyColumns: ["id"],
    maxRows: 5_000,
  },
  performanceDimensions: {
    table: "performance_dimension",
    columns: ["id", "key", "label", "display_order"],
    keyColumns: ["id"],
    maxRows: 2_000,
  },
  performanceObservations: {
    table: "performance_observation",
    columns: ["id", "participant_id", "performance_dimension_id", "period_start", "period_label", "status", "value"],
    keyColumns: ["id"],
    maxRows: 500_000,
  },
  bandSchemes: {
    table: "band_scheme",
    columns: ["id", "key", "label", "unit", "description"],
    keyColumns: ["id"],
    maxRows: 2_000,
  },
  bandRules: {
    table: "band_rule",
    columns: [
      "id",
      "band_scheme_id",
      "lower_bound",
      "upper_bound",
      "lower_inclusive",
      "upper_inclusive",
      "label",
      "semantic_color",
      "display_order",
    ],
    keyColumns: ["id"],
    maxRows: 10_000,
  },
  metricDefinitions: {
    table: "metric_definition",
    columns: ["id", "key", "label", "family", "unit", "precision", "calculation_version", "band_scheme_id"],
    keyColumns: ["id"],
    maxRows: 10_000,
  },
  journeyModels: {
    table: "journey_model",
    columns: ["id", "key", "label", "audience", "display_order"],
    keyColumns: ["id"],
    maxRows: 2_000,
  },
  journeyStages: {
    table: "journey_stage",
    columns: ["id", "journey_model_id", "key", "label", "stage_order"],
    keyColumns: ["id"],
    maxRows: 5_000,
  },
  journeyStageEvidenceLinks: {
    table: "journey_stage_evidence_link",
    columns: [
      "id",
      "journey_stage_id",
      "metric_definition_id",
      "survey_item_id",
      "performance_dimension_id",
      "role",
      "display_order",
    ],
    keyColumns: ["id"],
    maxRows: 20_000,
  },
  organizationalUnits: {
    table: "organizational_unit",
    columns: ["id", "key", "label", "display_order"],
    keyColumns: ["id"],
    maxRows: 2_000,
  },
  cultureDimensions: {
    table: "culture_dimension",
    columns: ["id", "key", "label", "audience", "display_order"],
    keyColumns: ["id"],
    maxRows: 2_000,
  },
  // `raw_text` and `normalized_text` are deliberately not selected.
  painPoints: {
    table: "pain_point",
    columns: ["id", "review_status", "created_at"],
    keyColumns: ["id"],
    maxRows: 50_000,
  },
  painPointJourneyStages: {
    table: "pain_point_journey_stage",
    columns: ["pain_point_id", "journey_stage_id", "display_order"],
    keyColumns: ["pain_point_id", "journey_stage_id"],
    maxRows: 200_000,
  },
  painPointOrganizationalUnits: {
    table: "pain_point_organizational_unit",
    columns: ["pain_point_id", "organizational_unit_id", "display_order"],
    keyColumns: ["pain_point_id", "organizational_unit_id"],
    maxRows: 200_000,
  },
  painPointPerformanceDimensions: {
    table: "pain_point_performance_dimension",
    columns: ["pain_point_id", "performance_dimension_id", "display_order"],
    keyColumns: ["pain_point_id", "performance_dimension_id"],
    maxRows: 200_000,
  },
  painPointCultureDimensions: {
    table: "pain_point_culture_dimension",
    columns: ["pain_point_id", "culture_dimension_id", "display_order"],
    keyColumns: ["pain_point_id", "culture_dimension_id"],
    maxRows: 200_000,
  },
} as const satisfies Record<string, CanonicalTableRead>;

export type CanonicalReadName = keyof typeof CANONICAL_READS;

/** Compare two key tuples lexicographically, by codepoint. */
function compareKeys(a: readonly string[], b: readonly string[]): number {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

function keyOf(row: Record<string, unknown>, keyColumns: readonly string[], table: string): string[] {
  return keyColumns.map((column) => {
    const value = row[column];
    if (typeof value !== "string" || !UUID.test(value)) {
      throw new CanonicalReadError("READ_KEY_NOT_UUID", table);
    }
    return value;
  });
}

/**
 * Read one whole table, one page at a time, and prove the read was complete.
 *
 * Three things make the completeness claim checkable rather than assumed: every
 * page is verified to be strictly increasing in the key (so a forgotten
 * `order` fails on the first page instead of silently skipping rows), a short
 * page ends the read (so the last page is never guessed), and reaching the
 * ceiling throws (so a set larger than the caller declared is a refusal).
 */
export async function readCanonicalTable<T>(
  transport: CanonicalReadTransport,
  read: CanonicalTableRead,
  scope: CanonicalReadScope,
  equals?: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<T[]> {
  const rows: Record<string, unknown>[] = [];
  let cursor: Record<string, string> | null = null;
  let previous: string[] | null = null;

  while (rows.length < read.maxRows) {
    // BEFORE the page, not after it. A read whose caller has given up must not
    // open another connection, and a signal that only reached the query would
    // still let this loop start page four of a set nobody is waiting for.
    if (signal?.aborted) throw new CanonicalReadError("READ_ABORTED", read.table);

    const limit = Math.min(CANONICAL_READ_PAGE_SIZE, read.maxRows - rows.length);
    let page: { rows: Record<string, unknown>[] | null; error: unknown };
    try {
      page = await transport.readPage({
        table: read.table,
        columns: read.columns,
        keyColumns: read.keyColumns,
        scope,
        cursor,
        limit,
        equals,
        signal,
      });
    } catch (thrown) {
      // An aborted request rejects, and PostgREST wraps the reason in a message
      // this module may not repeat. The signal is the reliable witness, so it
      // decides the code and the thrown value is discarded.
      if (signal?.aborted) throw new CanonicalReadError("READ_ABORTED", read.table);
      throw new CanonicalReadError(safeErrorCode(thrown), read.table);
    }
    if (page.error) {
      if (signal?.aborted) throw new CanonicalReadError("READ_ABORTED", read.table);
      throw new CanonicalReadError(safeErrorCode(page.error), read.table);
    }
    const batch = page.rows ?? [];

    for (const row of batch) {
      const key = keyOf(row, read.keyColumns, read.table);
      if (previous !== null && compareKeys(previous, key) >= 0) {
        throw new CanonicalReadError("READ_NOT_ORDERED", read.table);
      }
      previous = key;
    }

    rows.push(...batch);
    if (batch.length < limit) return rows as T[];
    cursor = Object.fromEntries(read.keyColumns.map((column, index) => [column, previous![index]]));
  }

  throw new CanonicalReadError("READ_EXCEEDS_CEILING", read.table);
}

/**
 * Run `task` over `items` with at most `limit` in flight, and refuse as a whole.
 *
 * DETERMINISM IS THE POINT, so three things are fixed rather than emergent:
 *   · results are placed BY INDEX, so the output order is the input order and
 *     never the completion order;
 *   · after the first failure no NEW task is started, but every task already
 *     started is awaited, so nothing is left running behind the rejection;
 *   · the error thrown is the LOWEST-INDEXED failure, so two families failing
 *     in the same run report the same refusal every time.
 *
 * `signal` stops the pool issuing further work; an in-flight task observes the
 * same signal through its own transport.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  // A limit that is not a positive integer would silently produce ZERO workers
  // and hand back an array of holes that every caller would then treat as an
  // empty-but-complete read. Refuse it, exactly as an out-of-range ceiling is
  // refused: a concurrency bug must not be able to look like an empty study.
  if (!Number.isSafeInteger(limit) || limit < 1) throw new CanonicalReadError("READ_CONCURRENCY_INVALID");

  const results = new Array<R>(items.length);
  const filled = new Array<boolean>(items.length).fill(false);
  const failures = new Array<unknown>(items.length);
  let failed = false;
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (failed) return;
      const index = next;
      next += 1;
      if (index >= items.length) return;
      // Claimed, then checked: the refusal is recorded at the position that
      // would have run, so "the lowest-indexed failure wins" holds for a
      // cancellation exactly as it does for a transport error.
      if (signal?.aborted) {
        failures[index] = new CanonicalReadError("READ_ABORTED");
        failed = true;
        return;
      }
      try {
        results[index] = await task(items[index], index);
        filled[index] = true;
      } catch (thrown) {
        failures[index] = thrown ?? new CanonicalReadError("CLIENT_TRANSPORT");
        failed = true;
        return;
      }
    }
  };

  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, () => worker());
  await Promise.all(workers);

  for (let index = 0; index < items.length; index += 1) {
    if (failures[index] !== undefined) throw failures[index];
  }
  // Complete or not at all. A hole here would mean a worker returned without
  // either filling its slot or recording a refusal — impossible today, and a
  // silently empty family is exactly the failure this module exists to refuse.
  if (filled.some((done) => !done)) throw new CanonicalReadError("READ_INCOMPLETE");
  return results;
}

export type LoadCanonicalRowSetOptions = {
  tenantId: string;
  studyId: string;
  /**
   * The package to read. When supplied, the committed job must carry exactly
   * this idempotency key; when omitted, the study must have exactly one
   * committed job and that one is read.
   */
  packageIdempotencyKey?: string;
  /** Cancellation for every page of every family. */
  signal?: AbortSignal;
};

/** The plan header the commit stored on `import_job.manifest`. */
type ManifestPlan = { specId?: unknown; planFingerprint?: unknown; packageIdempotencyKey?: unknown };

/**
 * Resolve the ONE committed package of a study, and refuse every other shape.
 *
 * A study with two committed packages is not a study this reader can answer
 * for: a caller asking "what does the canonical model say about this study"
 * would silently receive the union of two imports. Refusing names the problem;
 * picking the newest would hide it.
 */
async function resolveCommittedJob(
  transport: CanonicalReadTransport,
  options: LoadCanonicalRowSetOptions,
): Promise<{ job: ImportJobRow; specId: string; planFingerprint: string }> {
  const scope = { tenantId: options.tenantId, studyId: options.studyId };
  const rows = await readCanonicalTable<Record<string, unknown>>(
    transport,
    CANONICAL_READS.importJob,
    scope,
    { status: "committed" },
    options.signal,
  );
  const candidates = options.packageIdempotencyKey
    ? rows.filter((row) => row.idempotency_key === options.packageIdempotencyKey)
    : rows;
  if (candidates.length === 0) throw new CanonicalReadError("NO_COMMITTED_PACKAGE");
  if (candidates.length > 1) throw new CanonicalReadError("MULTIPLE_COMMITTED_PACKAGES");

  const row = candidates[0];
  const plan = (row.plan ?? null) as ManifestPlan | null;
  if (!plan || typeof plan !== "object") throw new CanonicalReadError("MANIFEST_PLAN_MISSING");
  const specId = plan.specId;
  const planFingerprint = plan.planFingerprint;
  if (typeof specId !== "string" || specId === "") throw new CanonicalReadError("MANIFEST_PLAN_MISSING");
  if (typeof planFingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/.test(planFingerprint)) {
    throw new CanonicalReadError("MANIFEST_PLAN_MISSING");
  }
  if (typeof row.id !== "string" || typeof row.idempotency_key !== "string") {
    throw new CanonicalReadError("READ_SHAPE_INVALID", "import_job");
  }
  if (typeof row.mapping_version !== "number" || !Number.isInteger(row.mapping_version)) {
    throw new CanonicalReadError("READ_SHAPE_INVALID", "import_job");
  }

  return {
    job: {
      id: row.id,
      idempotency_key: row.idempotency_key,
      mapping_version: row.mapping_version,
      status: "committed",
      committed_at: typeof row.committed_at === "string" ? row.committed_at : null,
    },
    specId,
    planFingerprint,
  };
}

/**
 * Read one committed package's canonical rows, complete or not at all.
 *
 * Every read is scoped by BOTH tenant and study. The scope is applied by the
 * transport before the keyset window, so a window can never widen one, and a
 * row belonging to another tenant cannot enter the set even if the connection
 * bypasses RLS — which the service-role connection does.
 */
export async function loadCanonicalRowSet(
  transport: CanonicalReadTransport,
  options: LoadCanonicalRowSetOptions,
): Promise<CanonicalRowSet> {
  if (!UUID.test(options.tenantId)) throw new CanonicalReadError("SCOPE_TENANT_INVALID");
  if (!UUID.test(options.studyId)) throw new CanonicalReadError("SCOPE_STUDY_INVALID");
  const scope: CanonicalReadScope = { tenantId: options.tenantId, studyId: options.studyId };
  const signal = options.signal;

  // FIRST, AND ALONE. The manifest names the spec every other read is
  // interpreted under, and a study with anything but exactly one committed
  // package is refused before a single family is fetched.
  const { job, specId, planFingerprint } = await resolveCommittedJob(transport, options);

  // The families, in a FIXED order. The order is not the fetch order — the pool
  // decides that — it is the order results are placed in, which is what makes
  // the concurrent read byte-identical to the sequential one it replaced.
  const FAMILIES = [
    "participants",
    "attributeDefinitions",
    "attributeValues",
    "responseScales",
    "responseOptions",
    "instruments",
    "domains",
    "items",
    "sessions",
    "responses",
    "retentionPeriods",
    "performanceDimensions",
    "performanceObservations",
    "bandSchemes",
    "bandRules",
    "metricDefinitions",
    "journeyModels",
    "journeyStages",
    "journeyStageEvidenceLinks",
    "organizationalUnits",
    "cultureDimensions",
    "painPoints",
    "painPointJourneyStages",
    "painPointOrganizationalUnits",
    "painPointPerformanceDimensions",
    "painPointCultureDimensions",
  ] as const satisfies readonly Exclude<keyof CanonicalRowSet, "importJob" | "specId" | "planFingerprint">[];

  const fetched = await mapBounded(
    FAMILIES,
    CANONICAL_READ_CONCURRENCY,
    (family) =>
      readCanonicalTable<Record<string, unknown>>(
        transport,
        CANONICAL_READS[family] as CanonicalTableRead,
        scope,
        undefined,
        signal,
      ),
    signal,
  );

  // One lookup, then the same per-family typed reads the sequential version
  // performed. The cast is exactly the one `readCanonicalTable<T>` always made:
  // the row shape is declared by `rows.ts` and enforced by the `select`, not by
  // a runtime check that never existed.
  const byFamily = new Map(FAMILIES.map((family, index) => [family, fetched[index]]));
  const rows = <T>(family: (typeof FAMILIES)[number]): T[] => byFamily.get(family) as unknown as T[];

  return {
    importJob: job,
    specId,
    planFingerprint,
    participants: rows<StudyParticipantRow>("participants"),
    attributeDefinitions: rows<AttributeDefinitionRow>("attributeDefinitions"),
    attributeValues: rows<ParticipantAttributeValueRow>("attributeValues"),
    responseScales: rows<ResponseScaleRow>("responseScales"),
    responseOptions: rows<ResponseOptionRow>("responseOptions"),
    instruments: rows<SurveyInstrumentRow>("instruments"),
    domains: rows<StudyDomainRow>("domains"),
    items: rows<SurveyItemRow>("items"),
    sessions: rows<SurveySessionRow>("sessions"),
    responses: rows<SurveyResponseRow>("responses"),
    retentionPeriods: rows<RetentionPeriodRow>("retentionPeriods"),
    performanceDimensions: rows<PerformanceDimensionRow>("performanceDimensions"),
    performanceObservations: rows<PerformanceObservationRow>("performanceObservations"),
    bandSchemes: rows<BandSchemeRow>("bandSchemes"),
    bandRules: rows<BandRuleRow>("bandRules"),
    metricDefinitions: rows<MetricDefinitionRow>("metricDefinitions"),
    journeyModels: rows<JourneyModelRow>("journeyModels"),
    journeyStages: rows<JourneyStageRow>("journeyStages"),
    journeyStageEvidenceLinks: rows<JourneyStageEvidenceLinkRow>("journeyStageEvidenceLinks"),
    organizationalUnits: rows<OrganizationalUnitRow>("organizationalUnits"),
    cultureDimensions: rows<CultureDimensionRow>("cultureDimensions"),
    painPoints: rows<PainPointRow>("painPoints"),
    painPointJourneyStages: rows<PainPointJourneyStageRow>("painPointJourneyStages"),
    painPointOrganizationalUnits: rows<PainPointOrganizationalUnitRow>("painPointOrganizationalUnits"),
    painPointPerformanceDimensions: rows<PainPointPerformanceDimensionRow>("painPointPerformanceDimensions"),
    painPointCultureDimensions: rows<PainPointCultureDimensionRow>("painPointCultureDimensions"),
  };
}
