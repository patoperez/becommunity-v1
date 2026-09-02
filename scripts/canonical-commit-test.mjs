// =============================================================================
// MANDATORY canonical commit and rollback gate
//   npx tsx scripts/canonical-commit-test.mjs
// =============================================================================
// Unit 3 turns a VALIDATED package into canonical rows inside one transaction,
// and can take every one of those rows back out again. This gate proves four
// separable things, and is explicit about which of them a database executed.
//
//   THE PROJECTION (executed here, against synthetic workbooks built below).
//   Every canonical family is emitted; every absence state survives as itself;
//   an answered zero stays zero; a person who did not take part gets no
//   answers; the spreadsheet's own derived label rides on the response row
//   instead of becoming a second one; a colour becomes uninterpreted evidence
//   and never a meaning; lineage reaches every persisted fact with the exact
//   worksheet spelling and coordinate; and the same two files in either order
//   produce the same package AND the same plan.
//
//   THE PRIVATE/SAFE BOUNDARY (executed here). The plan carries real values —
//   that is what it is for. The preflight report, the stored manifest, the
//   commit result and every error path must carry none. Sentinels are planted
//   where a name, an identifier, an answer and a free-text comment would be,
//   and the gate fails if one of them reaches anything that is displayed,
//   logged or stored.
//
//   THE WORKFLOW (executed here, against a fake transport). Preflight before
//   staging; refuse on a blocker; stage the fingerprint; commit once; reconcile
//   the counts the database reports; revert when they disagree; reduce every
//   database error to a code and never carry its message.
//
//   THE TRANSACTION AND SECURITY CONTRACT (STRUCTURAL — read from the SQL, not
//   executed HERE). Sections [14] to [17] read migration 0024's text: the
//   grants, the empty search path, the FOR UPDATE lock, the subtransaction, the
//   ledger vocabulary, the rollback ordering against every ON DELETE RESTRICT
//   edge in 0022/0023, and the exact reverse script. Those statements ARE
//   executed — by `scripts/canonical-commit-live-test.mjs`, against a
//   disposable PostgreSQL cluster. This gate keeps its own reading of the SQL
//   because a structural break should fail offline too, but it never reports a
//   database-executed result: read the live gate's output for that.
//
//   THE DATABASE GATE'S OWN REFUSALS (section [19], executed here). A rule that
//   runs only when somebody remembers to run the database gate is not a rule, so
//   every guard deciding which database that gate may touch is executed in
//   `npm test`.
//
// Every fixture is BUILT HERE from synthetic values. No client workbook, name,
// answer or identifier is committed to this repository.
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { readXlsxWorkbook } from "../src/lib/ingestion/xlsx-reader.ts";
import { WorkbookView } from "../src/lib/ingestion/canonical-package/sheet-view.ts";
import { preflightCanonicalPackage } from "../src/lib/ingestion/canonical-package/preflight.ts";
import { CUICUILCO_PACKAGE_SPEC_V1 } from "../src/lib/ingestion/canonical-package/spec.ts";
import {
  CUICUILCO_PROJECTION_V1,
  PLAN_FAMILIES,
  buildCanonicalCommitPlan,
  canonicalJson,
  commitPlanFingerprint,
  derivedRecordId,
  isUuid,
  reconcileCounts,
  safeErrorCode,
  sha256Hex,
} from "../src/lib/ingestion/canonical-commit/index.ts";
import { runCanonicalCommit, runCanonicalRollback, safeManifest } from "../src/lib/ingestion/canonical-commit/flow.ts";

let failures = 0;
const ok = (message) => console.log("  ✓", message);
const bad = (message) => {
  console.error("  ✗ FAIL:", message);
  failures += 1;
};
const check = (condition, message) => (condition ? ok(message) : bad(message));

const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (path) => readFileSync(join(root, path), "utf8");

const FORWARD = read("supabase/migrations/0024_canonical_commit_and_rollback.sql");
const REVERSE = read("supabase/rollbacks/0024_drop_canonical_commit_and_rollback.sql");
const FOUNDATION = read("supabase/migrations/0022_canonical_ingestion_foundation.sql");
const ANALYSIS = read("supabase/migrations/0023_canonical_analysis_model.sql");

import {
  DISPOSABLE_DATABASE_PATTERN,
  DisposableTargetError,
  FORBIDDEN_ENVIRONMENT,
  assertDisposableWorkDatabase,
  disposableDatabaseName,
  resolveDisposableTarget,
  sqlstateOf,
} from "./lib/disposable-postgres.mjs";
import {
  ACTIVE,
  CRI_OPTIONS,
  CSAT_LABELS,
  CSAT_VALUES,
  DESERTERS,
  RESPONDING_DESERTERS,
  STYLE,
  TOTAL,
  buildWorkbook,
  cleanSheets,
  num,
  painSheets,
  text,
} from "./lib/canonical-fixtures.mjs";

const TENANT = "11111111-1111-4111-8111-111111111111";
const STUDY = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";

// ---------------------------------------------------------------------------
// Fixtures — shared with the database gate
// ---------------------------------------------------------------------------
// The synthetic package lives in `scripts/lib/canonical-fixtures.mjs` so that
// this gate and `canonical-commit-live-test.mjs` prove their claims about the
// SAME bytes. A second copy would drift, and a drifted fixture lets two gates
// report the same names while testing different things.

const cleanBytes = await buildWorkbook(cleanSheets());
const painBytes = await buildWorkbook(painSheets());
const cleanFile = { fileName: "limpios.xlsx", bytes: cleanBytes };
const painFile = { fileName: "curado.xlsx", bytes: painBytes };

async function projectFrom(cleanBuffer, painBuffer, packageKey = `sha256:${"a".repeat(64)}`) {
  const workbooks = new Map();
  workbooks.set("clean_study_data", new WorkbookView(await readXlsxWorkbook(cleanBuffer)));
  workbooks.set("curated_pain_map", new WorkbookView(await readXlsxWorkbook(painBuffer)));
  return buildCanonicalCommitPlan({
    tenantId: TENANT,
    studyId: STUDY,
    packageIdempotencyKey: packageKey,
    spec: CUICUILCO_PACKAGE_SPEC_V1,
    projection: CUICUILCO_PROJECTION_V1,
    workbooks,
  });
}

const blockerCodes = (build) =>
  build.issues.filter((issue) => issue.severity === "blocker").map((issue) => issue.code);

console.log("Be Community — canonical commit and rollback gate");

// ---- [1] The digest and the derived identifier -----------------------------
console.log("\n[1] The synchronous digest matches WebCrypto, and identifiers are derived");
{
  const samples = ["", "a", "abc", "hola mundo", "ZNOMBREPRIV001", "x".repeat(1000), "ñÁé—✓"];
  let mismatches = 0;
  for (const sample of samples) {
    const expected = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sample)))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (sha256Hex(sample) !== expected) mismatches += 1;
  }
  check(mismatches === 0, `the local SHA-256 equals crypto.subtle for ${samples.length} inputs`);
  check(
    sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "and matches the FIPS 180-4 published vector for \"abc\"",
  );

  const first = derivedRecordId("sha256:key", "study_participant", "active|A1");
  const again = derivedRecordId("sha256:key", "study_participant", "active|A1");
  check(first === again, "the same inputs derive the same identifier");
  check(isUuid(first), `the derived identifier is a canonical uuid (${first})`);
  check(first[14] === "8", "it declares RFC 9562 version 8, which is what a derived uuid is");
  check("89ab".includes(first[19]), "and the RFC variant bits");
  check(
    derivedRecordId("sha256:key", "study_participant", "active|A1") !==
      derivedRecordId("sha256:key", "person_private", "active|A1"),
    "a different target table derives a different identifier",
  );
  check(
    derivedRecordId("sha256:key", "a", "bc") !== derivedRecordId("sha256:key", "ab", "c"),
    "the separator keeps two different splits apart",
  );
}

// ---- [2] Canonical serialisation and the plan fingerprint ------------------
console.log("\n[2] The plan fingerprint is stable and order-independent");
{
  check(
    canonicalJson({ b: 1, a: 2 }) === canonicalJson({ a: 2, b: 1 }),
    "object key order does not change the canonical serialisation",
  );
  check(
    canonicalJson({ a: [1, 2] }) !== canonicalJson({ a: [2, 1] }),
    "array order DOES, because the projector's order is deterministic and meaningful",
  );
  let threw = false;
  try {
    canonicalJson({ a: Number.POSITIVE_INFINITY });
  } catch {
    threw = true;
  }
  check(threw, "a non-finite number is refused instead of becoming null");
}

// ---- [3] Every canonical family is emitted ---------------------------------
console.log("\n[3] The package projects every canonical entity family");
const build = await projectFrom(cleanBytes, painBytes);
check(build.ok, `the synthetic package projects without blockers (${blockerCodes(build).join(", ") || "none"})`);
const plan = build.plan;
{
  const emptyFamilies = PLAN_FAMILIES.filter((family) => plan[family].length === 0);
  check(
    emptyFamilies.length === 1 && emptyFamilies[0] === "journeyStageEvidenceLinks",
    `only the family the mapping declares empty is empty (${emptyFamilies.join(", ") || "none"})`,
  );
  check(plan.persons.length === TOTAL, `${TOTAL} stable persons (${plan.persons.length})`);
  check(plan.participants.length === TOTAL, `${TOTAL} participations (${plan.participants.length})`);
  check(
    plan.participants.filter((row) => row.cohortKey === "active").length === ACTIVE,
    `${ACTIVE} active participations`,
  );
  check(
    plan.participants.filter((row) => row.cohortKey === "deserter").length === DESERTERS,
    `${DESERTERS} former participations`,
  );
  check(plan.membershipEpisodes.length === TOTAL, `${TOTAL} membership episodes`);
  check(
    plan.membershipEpisodes.filter((row) => row.endsOn !== null).length === DESERTERS,
    "only the former cohort's episodes carry an end date",
  );
  check(plan.surveyItems.length === 55 + 1 + 3 + 3, `62 survey items (${plan.surveyItems.length})`);
  check(plan.studyDomains.length === 4, "4 CSAT domains");
  check(plan.responseScales.length === 3, "3 response scales");
  check(plan.retentionPeriods.length === 6, "6 retention periods with their source counts");
  check(
    plan.retentionPeriods.every((row) => row.identityVerified),
    "and each satisfies final = inicial - perdidos + nuevos",
  );
  check(new Set(plan.performanceObservations.map((row) => row.periodStart)).size === 9, "9 performance months");
  check(plan.journeyStages.length === 18, "18 ordered journey stages");
  check(plan.organizationalUnits.length === 10, "10 organizational units");
  check(plan.cultureDimensions.length === 20, "20 culture dimensions across both audiences");
  check(
    plan.performanceDimensions.length === 8,
    `7 curated performance dimensions plus the monthly one (${plan.performanceDimensions.length})`,
  );
  check(plan.bandSchemes.length === 4 && plan.bandRules.length === 13, "4 band schemes with 13 rules");
  // The curated fixtures leave a different set of entities without text than the
  // real workbooks do, so the expected total is derived from the fixture's own
  // shape instead of being copied from the source study.
  const expectedPainPoints = [
    [18, 4],
    [10, 5],
    [7, 8],
    [10, 6],
    [10, 7],
  ].reduce((total, [entities, emptyEvery]) => {
    let filled = 0;
    for (let index = 0; index < entities; index++) if (index % emptyEvery !== 0) filled += 1;
    return total + filled;
  }, 0);
  check(
    plan.painPoints.length === expectedPainPoints,
    `${expectedPainPoints} curated pain points, one per entity that carries text (${plan.painPoints.length})`,
  );
  const relations =
    plan.painPointJourneyStages.length +
    plan.painPointOrganizationalUnits.length +
    plan.painPointPerformanceDimensions.length +
    plan.painPointCultureDimensions.length;
  check(relations === plan.painPoints.length, "every pain point has exactly one real relationship");
  check(plan.metricDefinitions.length === 116, `116 metric definitions (${plan.metricDefinitions.length})`);
  check(
    plan.metricDefinitions.every((row) => row.isPublishable === false),
    "nothing arrives publishable — publication is an editorial act, not an import",
  );
  check(
    plan.metricDefinitions.filter((row) => row.family === "csat").length === 55 &&
      plan.metricDefinitions.filter((row) => row.family === "tdp").length === 55,
    "CSAT and TDP are defined per touchpoint, as the calculation catalogue requires",
  );
  const cri = plan.metricDefinitions.find((row) => row.key === "cri");
  const criLink = plan.metricItemLinks.find((row) => row.metricDefinitionId === cri?.id);
  const criItem = plan.surveyItems.find((row) => row.id === criLink?.surveyItemId);
  check(criItem?.key === "cri_d", `the CRI metric identified its evidence column from the documented options (${criItem?.key})`);
}

// ---- [4] Absence stays absence; a zero stays a zero -------------------------
console.log("\n[4] Every absence state survives, and an answered zero is still zero");
{
  const statuses = new Set([
    ...plan.participantAttributeValues.map((row) => row.status),
    ...plan.surveyResponses.map((row) => row.status),
    ...plan.performanceObservations.map((row) => row.status),
    ...plan.surveySessions.map((row) => row.status),
  ]);
  for (const state of ["answered", "missing", "unknown", "not_applicable", "source_unavailable", "not_participated"]) {
    check(statuses.has(state), `the plan distinguishes '${state}'`);
  }
  check(
    plan.performanceObservations.every((row) => (row.status === "answered") === (row.value !== null)),
    "no performance absence carries a value and no value lacks its state",
  );
  check(
    plan.performanceObservations.filter((row) => row.status === "unknown").length === 1,
    "an answered but non-numeric month is 'unknown', never a score and never 0",
  );
  check(
    plan.performanceObservations.every((row) => row.value !== 0 || row.status === "answered"),
    "no absence was rewritten as the number 0",
  );

  const zeroItem = plan.surveyItems.find((row) => row.key === "csat_d");
  const zeroResponses = plan.surveyResponses.filter(
    (row) => row.surveyItemId === zeroItem?.id && row.valueNumeric === 0,
  );
  check(zeroResponses.length === 1, `one answered zero survived as the number 0 (${zeroResponses.length})`);
  check(
    zeroResponses[0]?.status === "answered" && zeroResponses[0]?.responseOptionId === null,
    "and it is an answer, not an absence and not a scale option",
  );

  const errorCells = plan.participantAttributeValues.filter((row) => row.sourceRawValue?.startsWith("#"));
  check(
    errorCells.every((row) => row.status !== "answered" && row.valueNumeric === null),
    "a spreadsheet error is never read as a value",
  );
  const blankAttributes = plan.participantAttributeValues.filter((row) => row.status === "missing");
  check(
    blankAttributes.length === DESERTERS - RESPONDING_DESERTERS,
    `a genuinely blank cell is 'missing' (${blankAttributes.length})`,
  );
}

// ---- [5] Non-participation is not an answer --------------------------------
console.log("\n[5] Non-participation never becomes an answer");
{
  const absent = plan.surveySessions.filter((row) => row.status === "not_participated");
  check(
    absent.length === DESERTERS - RESPONDING_DESERTERS,
    `${DESERTERS - RESPONDING_DESERTERS} non-participation sessions were recorded explicitly (${absent.length})`,
  );
  const absentIds = new Set(absent.map((row) => row.id));
  check(
    plan.surveyResponses.every((row) => !absentIds.has(row.surveySessionId)),
    "and not one response hangs off any of them",
  );
  check(
    plan.participants.filter((row) => row.surveyParticipationStatus === "not_participated").length ===
      DESERTERS - RESPONDING_DESERTERS,
    "the participation state is recorded on the participation too",
  );
  check(
    absent.every((row) => row.submittedAt === null && row.sourceRowNumber === null),
    "a session that did not happen has no timestamp and no source row",
  );
}

// ---- [6] A derived label is evidence, not a second response ----------------
console.log("\n[6] The spreadsheet's own label rides on the response, not beside it");
{
  const labelled = plan.surveyResponses.filter((row) => row.sourceDerivedLabel !== null);
  check(labelled.length > 0, `${labelled.length} responses carry the source's derived label`);
  const expected = ACTIVE * 55 + ACTIVE * 1 + RESPONDING_DESERTERS * 3 + ACTIVE * 3;
  check(
    plan.surveyResponses.length === expected,
    `the response count is unchanged by those labels (${plan.surveyResponses.length} of ${expected})`,
  );
  const csatInstrument = plan.surveyInstruments.find((row) => row.key === "csat");
  const csatItemColumns = plan.surveyItems
    .filter((row) => row.surveyInstrumentId === csatInstrument.id)
    .map((row) => row.key.slice("csat_".length).toUpperCase());
  const labelColumns = new Set(CSAT_LABELS);
  const onLabelColumn = csatItemColumns.filter((column) => labelColumns.has(column));
  check(
    onLabelColumn.length === 0 && csatItemColumns.length === CSAT_VALUES.length,
    `every CSAT item sits on a value column and none on a label column (${onLabelColumn.length} on labels)`,
  );
}

// ---- [7] A colour is evidence, never a meaning -----------------------------
console.log("\n[7] Colour stays evidence; the bands come from documented ranges");
{
  check(
    plan.visualAnnotations.every((row) => row.reviewStatus === "pending"),
    "every visual annotation arrives pending human review",
  );
  check(
    plan.visualAnnotations.every((row) => row.confidence === "observed"),
    "and is recorded as observed, never as confirmed",
  );
  check(
    plan.visualAnnotations
      .filter((row) => row.fillRgb !== null)
      .every((row) => row.interpretation.includes("sin interpretar")),
    "a fill's interpretation states outright that it means nothing yet",
  );
  const roles = new Set(plan.visualAnnotations.map((row) => row.role));
  check(
    roles.has("metric_band") && roles.has("curated_annotation") && roles.has("structural_group"),
    "the same colour vocabulary carries three different contextual roles",
  );
  const red = plan.visualAnnotations.filter((row) => row.fillRgb === "FFFF0000");
  check(
    red.length > 1 && new Set(red.map((row) => row.role)).size > 1,
    "one RGB value produces different contextual annotations on different sheets — it has no global meaning",
  );
  const monthly = CUICUILCO_PROJECTION_V1.bandSchemes.find((row) => row.key === "desempeno_mensual");
  check(
    monthly.rules.map((rule) => `${rule.lowerBound}-${rule.upperBound}`).join(",") === "0-29,30-49,50-69,70-100",
    "the performance bands are the documented ranges, not the workbook's colours",
  );
  check(
    plan.bandRules.every((rule) => rule.lowerBound !== null || rule.upperBound !== null),
    "every band rule is bounded on at least one side, as the schema requires",
  );
}

// ---- [8] Lineage reaches every persisted fact ------------------------------
console.log("\n[8] Lineage keeps the exact worksheet spelling and the coordinate");
{
  const sheets = new Set(plan.sourceLineage.map((row) => row.sheetName));
  check(sheets.has("Equipos "), "the worksheet whose name ends in a space keeps the space");
  check(sheets.size === 16, `all 16 worksheets are cited (${sheets.size})`);
  check(
    plan.sourceLineage.every((row) => /^[A-Z]{1,3}(\d+)?(:[A-Z]{1,3}\d+)?$/.test(row.cellOrRange)),
    "every lineage row names a cell, a range or a column",
  );
  check(
    plan.sourceLineage.every((row) => /^[a-z][a-z0-9_]{0,79}$/.test(row.transformationKey)),
    "every lineage row names the transformation that produced it",
  );
  check(
    plan.sourceLineage.every((row) => /^[a-z][a-z0-9_]{0,79}$/.test(row.targetField)),
    "and the field it landed in",
  );
  check(
    plan.sourceLineage.every((row) => row.sourceColumn === null || /^[A-Z]{1,3}$/.test(row.sourceColumn)),
    "the source column matches the shape the schema enforces",
  );
  const traced = new Set(plan.sourceLineage.map((row) => `${row.targetTable}|${row.targetRecordId}`));
  for (const [table, rows] of [
    ["person_private", plan.persons],
    ["person_external_identifier", plan.personIdentifiers],
    ["study_participant", plan.participants],
    ["membership_episode", plan.membershipEpisodes],
    ["participant_attribute_value", plan.participantAttributeValues],
    ["survey_response", plan.surveyResponses],
    ["survey_session", plan.surveySessions],
    ["performance_observation", plan.performanceObservations],
    ["retention_period", plan.retentionPeriods],
    ["pain_point", plan.painPoints],
    ["journey_stage", plan.journeyStages],
    ["organizational_unit", plan.organizationalUnits],
    ["culture_dimension", plan.cultureDimensions],
    ["visual_annotation", plan.visualAnnotations],
  ]) {
    const missing = rows.filter((row) => !traced.has(`${table}|${row.id}`)).length;
    check(missing === 0, `every ${table} row is traceable to its source (${rows.length - missing}/${rows.length})`);
  }
  const targets = new Set(plan.sourceLineage.map((row) => row.targetTable));
  const vocabulary = new Set(
    (FORWARD.match(/add constraint source_lineage_target_table_check check \(target_table in \(([\s\S]*?)\)\)/)?.[1] ?? "")
      .split(",")
      .map((entry) => entry.trim().replace(/^'|'$/g, ""))
      .filter(Boolean),
  );
  const unrepresentable = [...targets].filter((table) => !vocabulary.has(table));
  check(
    unrepresentable.length === 0,
    `migration 0024's lineage vocabulary can name every target the projector writes${unrepresentable.length ? `: ${unrepresentable.join(", ")}` : ""}`,
  );
}

// ---- [9] Order independence and determinism --------------------------------
console.log("\n[9] The same bytes, in either order, are the same package and the same plan");
{
  const forward = await preflightCanonicalPackage([cleanFile, painFile], CUICUILCO_PACKAGE_SPEC_V1);
  const reversed = await preflightCanonicalPackage([painFile, cleanFile], CUICUILCO_PACKAGE_SPEC_V1);
  check(forward.confirmationAllowed, `the synthetic package passes preflight (${forward.counts.blockers} blockers)`);
  check(
    forward.packageIdempotencyKey === reversed.packageIdempotencyKey,
    "the package key is identical whichever order the files arrive in",
  );
  const a = await projectFrom(cleanBytes, painBytes, forward.packageIdempotencyKey);
  const b = await projectFrom(cleanBytes, painBytes, reversed.packageIdempotencyKey);
  check(a.ok && b.ok && a.plan.planFingerprint === b.plan.planFingerprint, "and so is the plan fingerprint");
  check(
    a.plan.planFingerprint === commitPlanFingerprint(a.plan),
    "the plan still fingerprints to the value it carries",
  );
  // REGRESSION (found by the database gate). The package key is derived from
  // the mapping version, the roles and the file hashes — not from the study. If
  // the record identifiers were scoped to it alone, importing the same two
  // files into a second study would derive the SAME primary key for every row
  // and collide on the first insert. Nothing offline noticed; PostgreSQL did.
  {
    const workbooks = new Map();
    workbooks.set("clean_study_data", new WorkbookView(await readXlsxWorkbook(cleanBytes)));
    workbooks.set("curated_pain_map", new WorkbookView(await readXlsxWorkbook(painBytes)));
    const shared = {
      packageIdempotencyKey: forward.packageIdempotencyKey,
      spec: CUICUILCO_PACKAGE_SPEC_V1,
      projection: CUICUILCO_PROJECTION_V1,
      workbooks,
    };
    const studyOne = buildCanonicalCommitPlan({ ...shared, tenantId: TENANT, studyId: STUDY });
    const studyTwo = buildCanonicalCommitPlan({
      ...shared,
      tenantId: TENANT,
      studyId: "55555555-5555-4555-8555-555555555555",
    });
    check(studyOne.ok && studyTwo.ok, "the same package projects for two studies of one tenant");
    const idsOf = (build) =>
      new Set(
        PLAN_FAMILIES.filter((family) => family !== "sourceLineage").flatMap((family) =>
          build.plan[family].map((row) => row.id),
        ),
      );
    const one = idsOf(studyOne);
    const two = idsOf(studyTwo);
    const collisions = [...one].filter((value) => two.has(value));
    check(
      collisions.length === 0,
      `and shares NO record identifier with it (${collisions.length} collisions of ${one.size})`,
    );
    const otherTenant = buildCanonicalCommitPlan({ ...shared, tenantId: OTHER_TENANT, studyId: STUDY });
    const three = idsOf(otherTenant);
    check(
      [...one].filter((value) => three.has(value)).length === 0,
      "and a second tenant shares none either",
    );
  }

  const differentKey = await projectFrom(cleanBytes, painBytes, `sha256:${"b".repeat(64)}`);
  check(
    differentKey.plan.planFingerprint !== a.plan.planFingerprint,
    "a different package key produces a different plan, so identities cannot be reused across packages",
  );
  const mutated = await buildWorkbook(
    cleanSheets({ perfilCliente: (rows) => { rows[3].N = num(999999); } }),
  );
  const changed = await projectFrom(mutated, painBytes, forward.packageIdempotencyKey);
  check(
    changed.ok && changed.plan.planFingerprint !== a.plan.planFingerprint,
    "one changed source value changes the fingerprint",
  );
}

// ---- [10] The projector refuses rather than guessing -----------------------
console.log("\n[10] Where the source does not say, the projector refuses");
{
  const wrongType = await buildWorkbook(
    cleanSheets({ perfilCliente: (rows) => { rows[3].M = text("aproximadamente dos"); } }),
  );
  const typed = await projectFrom(wrongType, painBytes);
  check(
    !typed.ok && blockerCodes(typed).includes("PROJECTION_ATTRIBUTE_TYPE_MISMATCH"),
    "a declared numeric column holding prose is refused, not downgraded to text",
  );

  const ambiguous = await buildWorkbook(
    cleanSheets({
      cri: (rows) => {
        for (let index = 0; index < ACTIVE; index++) rows[index + 2].E = text(CRI_OPTIONS[index % CRI_OPTIONS.length]);
      },
    }),
  );
  const twoMatches = await projectFrom(ambiguous, painBytes);
  check(
    !twoMatches.ok && blockerCodes(twoMatches).includes("PROJECTION_METRIC_EVIDENCE_AMBIGUOUS"),
    "two columns matching the documented options is a refusal, not a coin flip",
  );

  const backwards = await buildWorkbook(
    cleanSheets({ perfilDesertores: (rows) => { rows[3].L = num(40000, STYLE.date); } }),
  );
  const episode = await projectFrom(backwards, painBytes);
  check(
    !episode.ok && blockerCodes(episode).includes("PROJECTION_EPISODE_ORDER"),
    "a membership that ends before it starts is refused",
  );

  const stranger = await buildWorkbook(
    cleanSheets({ idCliente: (rows) => { delete rows[2]; } }),
  );
  const orphan = await projectFrom(stranger, painBytes);
  check(
    !orphan.ok && blockerCodes(orphan).includes("PROJECTION_IDENTITY_NOT_CATALOGUED"),
    "a cohort identity missing from the catalogue is refused",
  );
  check(orphan.plan === null, "and a refused projection produces NO plan at all");

  const mismatchedSpec = buildCanonicalCommitPlan({
    tenantId: TENANT,
    studyId: STUDY,
    packageIdempotencyKey: `sha256:${"c".repeat(64)}`,
    spec: CUICUILCO_PACKAGE_SPEC_V1,
    projection: { ...CUICUILCO_PROJECTION_V1, mappingVersion: 99 },
    workbooks: new Map(),
  });
  check(
    !mismatchedSpec.ok && blockerCodes(mismatchedSpec).includes("PROJECTION_SPEC_MISMATCH"),
    "a projection configured for another mapping version is refused before anything is read",
  );
}

// ---- [11] The private plan and the safe report are different shapes --------
console.log("\n[11] Private values live in the plan and nowhere else");
const sentinelPattern = /Z(?:NOMBRE|ID|TEXTO|CATEG)PRIV\d{3}/g;
{
  const planText = JSON.stringify(plan);
  const inPlan = new Set(planText.match(sentinelPattern) ?? []);
  check(inPlan.size >= 20, `the plan does carry the source's real values (${inPlan.size} sentinels)`);

  const preflight = await preflightCanonicalPackage([cleanFile, painFile], CUICUILCO_PACKAGE_SPEC_V1);
  const preflightText = JSON.stringify(preflight);
  check(
    (preflightText.match(sentinelPattern) ?? []).length === 0,
    "the preflight report carries none of them",
  );

  const manifest = JSON.stringify(safeManifest(preflight, plan));
  check((manifest.match(sentinelPattern) ?? []).length === 0, "and neither does what is stored on import_job.manifest");

  const refused = await projectFrom(
    await buildWorkbook(cleanSheets({ perfilCliente: (rows) => { rows[3].M = text("aproximadamente dos"); } })),
    painBytes,
  );
  check(
    (JSON.stringify(refused.issues).match(sentinelPattern) ?? []).length === 0,
    "a projection blocker names the sheet and the coordinate, never the value",
  );

  check(
    safeErrorCode({ message: 'duplicate key value violates unique constraint "x" Key (id)=(ZIDPRIV001) already exists' }) ===
      "CLIENT_TRANSPORT",
    "a PostgreSQL message quoting a private key is reduced to a code and discarded",
  );
  check(safeErrorCode({ message: "COUNT_MISMATCH" }) === "COUNT_MISMATCH", "a code the migration raised is kept");
  check(safeErrorCode("PLAN_TOO_LARGE") === "PLAN_TOO_LARGE", "including when it arrives as a bare string");
  check(safeErrorCode({ message: "SOMETHING_UNDOCUMENTED" }) === "CLIENT_TRANSPORT", "an unknown code is not trusted either");
  check(
    safeErrorCode({ message: 'PGRST202 detail: ZIDPRIV001 — COUNT_MISMATCH' }) === "COUNT_MISMATCH",
    "a wrapped message is searched past the noise for the code the migration raised",
  );
  check(safeErrorCode(undefined) === "CLIENT_TRANSPORT", "and nothing at all is still not a success");
}

// ---- [12] Count reconciliation ---------------------------------------------
console.log("\n[12] The database's counts are the authority, and they are checked");
{
  const measured = { ...plan.expectedCounts, _personsCreated: 60, _personsReused: 0, _ledgerRows: 12 };
  const good = reconcileCounts(plan.expectedCounts, measured);
  check(good.ok, "matching counts reconcile");
  check(good.ownership._personsReused === 0, "ownership detail is reported, not reconciled");
  check(Object.keys(good.measured).length === PLAN_FAMILIES.length, "every family is measured");

  const short = reconcileCounts(plan.expectedCounts, { ...measured, surveyResponses: measured.surveyResponses - 1 });
  check(!short.ok && short.disagreements[0].family === "surveyResponses", "one missing row is a disagreement");

  const absent = reconcileCounts(plan.expectedCounts, { ...measured, painPoints: undefined });
  check(!absent.ok, "a family the database did not measure at all is a disagreement");

  const extra = reconcileCounts(plan.expectedCounts, { ...measured, somethingElse: 3 });
  check(!extra.ok, "a family the plan never declared is a disagreement too");

  const empty = reconcileCounts(plan.expectedCounts, null);
  check(!empty.ok && empty.disagreements.length === PLAN_FAMILIES.length, "no counts at all is never a success");
}

// ---- [13] The workflow, against a fake transport ---------------------------
console.log("\n[13] The workflow preflights, stages, commits, reconciles and reverts");
{
  const IMPORT_JOB = "44444444-4444-4444-8444-444444444444";
  const fakeTransport = (behaviour) => {
    const calls = [];
    return {
      calls,
      rpc: async (name, args) => {
        calls.push({ name, args });
        return behaviour(name, args, calls);
      },
    };
  };
  const committedCounts = (counts) => ({
    importJobId: IMPORT_JOB,
    status: "committed",
    replayed: false,
    counts: { ...counts, _personsCreated: 60, _personsReused: 0, _ledgerRows: 7 },
    planFingerprint: "sha256:x",
    commitAttempts: 1,
    rollbackCount: 0,
  });

  const happy = fakeTransport((name, args) => {
    if (name === "stage_canonical_package") return { data: { importJobId: IMPORT_JOB, status: "validated", assets: 2 }, error: null };
    if (name === "commit_canonical_package") return { data: committedCounts(args.p_plan.expectedCounts), error: null };
    return { data: null, error: null };
  });
  const success = await runCanonicalCommit(happy, {
    tenantId: TENANT,
    studyId: STUDY,
    files: [cleanFile, painFile],
  });
  check(success.ok && success.status === "committed", `the happy path commits (${success.ok ? "ok" : success.code})`);
  check(
    happy.calls.map((call) => call.name).join(" -> ") ===
      "stage_canonical_package -> commit_canonical_package",
    "staging happens before the commit, and the commit happens exactly once",
  );
  check(
    happy.calls[1].args.p_plan.tenantId === TENANT && happy.calls[1].args.p_plan.studyId === STUDY,
    "the payload states its scope so the database can refuse it",
  );
  check(
    typeof happy.calls[0].args.p_request.planFingerprint === "string" &&
      happy.calls[0].args.p_request.planFingerprint === happy.calls[1].args.p_plan.planFingerprint,
    "the fingerprint staged is the fingerprint committed",
  );
  check(
    (JSON.stringify(happy.calls[0].args.p_request.manifest).match(sentinelPattern) ?? []).length === 0,
    "the staged manifest carries no private value",
  );
  check(
    (JSON.stringify(success).match(sentinelPattern) ?? []).length === 0,
    "and neither does the result the operator is shown",
  );

  const replay = fakeTransport((name, args) => {
    if (name === "stage_canonical_package") return { data: { importJobId: IMPORT_JOB, status: "committed", assets: 2 }, error: null };
    if (name === "commit_canonical_package") {
      return { data: { ...committedCounts(args.p_plan.expectedCounts), replayed: true }, error: null };
    }
    return { data: null, error: null };
  });
  const replayed = await runCanonicalCommit(replay, { tenantId: TENANT, studyId: STUDY, files: [painFile, cleanFile] });
  check(replayed.ok && replayed.replayed === true, "a replay reports itself as a replay");
  check(
    replay.calls.filter((call) => call.name === "commit_canonical_package").length === 1,
    "and still calls the commit exactly once, with the same reversed-order package",
  );

  const mismatch = fakeTransport((name, args) => {
    if (name === "stage_canonical_package") return { data: { importJobId: IMPORT_JOB }, error: null };
    if (name === "commit_canonical_package") {
      const counts = { ...args.p_plan.expectedCounts, surveyResponses: 1 };
      return { data: committedCounts(counts), error: null };
    }
    return { data: { importJobId: IMPORT_JOB, status: "rolled_back", replayed: false, counts: {}, rollbackCount: 1 }, error: null };
  });
  const wrongCounts = await runCanonicalCommit(mismatch, { tenantId: TENANT, studyId: STUDY, files: [cleanFile, painFile] });
  check(!wrongCounts.ok && wrongCounts.code === "COUNTS_NOT_RECONCILED", "a count the database reports wrong is not a success");
  check(
    mismatch.calls.some((call) => call.name === "rollback_canonical_package"),
    "and the package is reverted rather than left half-believed",
  );

  const failed = fakeTransport((name) => {
    if (name === "stage_canonical_package") return { data: { importJobId: IMPORT_JOB }, error: null };
    return {
      data: { importJobId: IMPORT_JOB, status: "failed", replayed: false, code: "DATABASE_CONSTRAINT", counts: {} },
      error: null,
    };
  });
  const failure = await runCanonicalCommit(failed, { tenantId: TENANT, studyId: STUDY, files: [cleanFile, painFile] });
  check(!failure.ok && failure.status === "failed" && failure.code === "DATABASE_CONSTRAINT", "a recorded failure is reported as one");
  check(failure.message.length > 20 && !failure.message.includes("constraint"), "with a sentence the product wrote");

  const hostile = fakeTransport(() => ({
    data: null,
    error: { message: 'Key (study_id, person_id)=(…, ZIDPRIV001) already exists' },
  }));
  const redacted = await runCanonicalCommit(hostile, { tenantId: TENANT, studyId: STUDY, files: [cleanFile, painFile] });
  check(
    !redacted.ok && (JSON.stringify(redacted).match(sentinelPattern) ?? []).length === 0,
    "a database message quoting a private value never reaches the caller",
  );

  const blocked = await runCanonicalCommit(fakeTransport(() => ({ data: null, error: null })), {
    tenantId: TENANT,
    studyId: STUDY,
    files: [cleanFile],
  });
  check(!blocked.ok && blocked.status === "blocked" && blocked.code === "PREFLIGHT_BLOCKED", "an incomplete package never reaches the database");
  const noCalls = fakeTransport(() => ({ data: null, error: null }));
  await runCanonicalCommit(noCalls, { tenantId: TENANT, studyId: STUDY, files: [cleanFile] });
  check(noCalls.calls.length === 0, "and makes no database call at all");

  const badScope = await runCanonicalCommit(noCalls, { tenantId: "not-a-uuid", studyId: STUDY, files: [cleanFile, painFile] });
  check(!badScope.ok, "a malformed tenant identifier is refused before any read");

  const reverting = fakeTransport(() => ({
    data: {
      importJobId: IMPORT_JOB,
      status: "rolled_back",
      replayed: false,
      counts: { _removed: { study_participant: 60, survey_response: 1685 }, _retainedSharedIdentities: 2 },
      rollbackCount: 1,
    },
    error: null,
  }));
  const reverted = await runCanonicalRollback(reverting, IMPORT_JOB, null);
  check(reverted.ok && reverted.removed.survey_response === 1685, "a rollback reports exactly what it removed");
  check(reverted.ok && reverted.retainedSharedIdentities === 2, "and how many shared identities it deliberately kept");
  const repeated = fakeTransport(() => ({
    data: { importJobId: IMPORT_JOB, status: "rolled_back", replayed: true, counts: {}, rollbackCount: 1 },
    error: null,
  }));
  const again = await runCanonicalRollback(repeated, IMPORT_JOB, null);
  check(again.ok && again.replayed === true, "repeating a rollback answers the same way instead of refusing");
  // A plan validated for one tenant cannot be presented for another: the scope
  // is inside the fingerprint, so the staged value and the payload can only
  // agree for the tenant and study the plan was built for.
  const foreign = fakeTransport((name) => {
    if (name === "stage_canonical_package") return { data: { importJobId: IMPORT_JOB }, error: null };
    return { data: null, error: { message: "TENANT_SCOPE_MISMATCH" } };
  });
  const crossTenant = await runCanonicalCommit(foreign, {
    tenantId: OTHER_TENANT,
    studyId: STUDY,
    files: [cleanFile, painFile],
  });
  check(
    !crossTenant.ok && crossTenant.code === "TENANT_SCOPE_MISMATCH",
    "a cross-tenant refusal from the database is surfaced as its own code",
  );
  check(
    foreign.calls[1].args.p_plan.planFingerprint !== happy.calls[1].args.p_plan.planFingerprint,
    "and the same files projected for another tenant produce a different plan fingerprint",
  );
}

// ---- [14] Migration 0024: the security contract of the RPCs ----------------
console.log("\n[14] STRUCTURAL — migration 0024's security contract (SQL text, not executed)");
const FUNCTIONS = [
  ["record_canonical_rows", "uuid, uuid, uuid, text, uuid\\[\\], text"],
  ["stage_canonical_package", "uuid, uuid, jsonb"],
  ["commit_canonical_package", "uuid, jsonb"],
  ["rollback_canonical_package", "uuid, uuid"],
];
{
  const created = [...FORWARD.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1]);
  check(created.length === 4, `0024 creates exactly 4 functions (${created.length})`);
  check(
    FUNCTIONS.every(([name]) => created.includes(name)),
    "and they are the four the unit declares",
  );
  const definerBlocks = FORWARD.match(/language plpgsql\s*\n\s*security definer\s*\n\s*set search_path = ''/g) ?? [];
  check(definerBlocks.length === 4, `all 4 are SECURITY DEFINER with an EMPTY search_path (${definerBlocks.length})`);
  check(
    !/set search_path = '[^']/.test(FORWARD),
    "no function is given a non-empty search path",
  );
  for (const [name, signature] of FUNCTIONS) {
    const revoke = new RegExp(`revoke all on function public\\.${name}\\(${signature}\\)\\s*\\n?\\s*from public, anon, authenticated`);
    const grant = new RegExp(`grant execute on function public\\.${name}\\(${signature}\\)\\s*\\n?\\s*to service_role`);
    check(revoke.test(FORWARD), `${name} is revoked from public, anon and authenticated`);
    check(grant.test(FORWARD), `${name} is granted only to service_role`);
  }
  check(
    !/grant\s+execute\s+on\s+function[\s\S]*?to\s+(anon|authenticated|public)\b/i.test(FORWARD),
    "no browser role is ever granted execute",
  );
  // Comments and string literals are stripped first: this migration explains
  // itself in English, and it names tables inside quoted vocabularies that are
  // data, not references. What remains is executable SQL, and in it every
  // canonical table must be reached through its schema.
  const executable = FORWARD.replace(/(^|\s)--[^\n]*/g, "$1").replace(/'[^']*'/g, "''");
  const tableNames = [
    ...new Set([
      ...[...FOUNDATION.matchAll(/create table public\.([a-z_]+)/g)].map((m) => m[1]),
      ...[...ANALYSIS.matchAll(/create table public\.([a-z_]+)/g)].map((m) => m[1]),
      ...[...FORWARD.matchAll(/create table public\.([a-z_]+)/g)].map((m) => m[1]),
      "study",
      "tenant",
    ]),
  ];
  const unqualified = tableNames.filter((table) => {
    const pattern = new RegExp(`(^|[^.\\w])${table}\\b`, "g");
    for (const match of executable.matchAll(pattern)) {
      const before = executable.slice(Math.max(0, match.index - 7), match.index + match[1].length);
      if (!before.endsWith("public.")) return true;
    }
    return false;
  });
  check(
    unqualified.length === 0,
    `every canonical table is reached through its schema${unqualified.length ? `: ${unqualified.join(", ")}` : ""}`,
  );
  check(
    /select \* into job\s*\n?\s*from public\.import_job where id = p_import_job_id for update/.test(FORWARD),
    "the commit locks the import job with FOR UPDATE, so two confirmations serialise",
  );
  check(
    /select \* into job\s*\n?\s*from public\.import_job where id = p_import_job_id for update/.test(
      FORWARD.slice(FORWARD.indexOf("rollback_canonical_package")),
    ),
    "and so does the rollback",
  );
  check(
    /for update/.test(FORWARD.slice(FORWARD.indexOf("stage_canonical_package"), FORWARD.indexOf("commit_canonical_package"))),
    "staging locks the job it is about to bind, so two uploads cannot both create one",
  );
}

// ---- [15] Migration 0024: scope, counts and failure recording --------------
const LEDGER_VOCABULARY = (
  FORWARD.match(/target_table\s+text not null check \(target_table in \(([\s\S]*?)\)\),/)?.[1] ?? ""
)
  .split(",")
  .map((entry) => entry.trim().replace(/^'|'$/g, ""))
  .filter(Boolean);
console.log("\n[15] STRUCTURAL — scope is derived, counts are measured, failures are contained");
{
  const commit = FORWARD.slice(FORWARD.indexOf("create or replace function public.commit_canonical_package"));
  check(
    /TENANT_SCOPE_MISMATCH/.test(commit) && /STUDY_SCOPE_MISMATCH/.test(commit),
    "a payload claiming another tenant or study is refused",
  );
  check(
    /\(p_plan ->> 'tenantId'\)::uuid is distinct from job\.tenant_id/.test(commit),
    "the refusal compares the payload against the LOCKED row, not the other way round",
  );
  const inserts = [...commit.matchAll(/insert into public\.[a-z_]+ \(([\s\S]*?)\)\s*\n\s*select([\s\S]*?);/g)];
  const stamped = inserts.filter((match) => /job\.tenant_id/.test(match[2]) || !/tenant_id/.test(match[1]));
  check(
    stamped.length === inserts.length,
    `every insert stamps tenant from the locked job (${stamped.length}/${inserts.length})`,
  );
  check(
    !/insert into public\.[a-z_]+[\s\S]*?p_plan ->> 'tenantId'/.test(commit),
    "no insert ever takes its tenant from the payload",
  );
  check(
    (commit.match(/get diagnostics n = row_count/g) ?? []).length >= 25,
    "every family's count is measured with the database's own ROW_COUNT",
  );
  check(
    /returning id\s*\n\s*\)\s*\n\s*select coalesce\(array_agg\(id\)/.test(commit),
    "shared identity families record the rows RETURNING really inserted",
  );
  // The SQL's own list of families must be exactly the one the plan declares.
  // A family in the plan and not in the list would be written without ever
  // being shape-checked; one in the list and not in the plan would be dead SQL.
  const declaredFamilies = (commit.match(/foreach family_name in array array\[([\s\S]*?)\] loop/)?.[1] ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
  const missingFamilies = PLAN_FAMILIES.filter((family) => !declaredFamilies.includes(family));
  const strayFamilies = declaredFamilies.filter((family) => !PLAN_FAMILIES.includes(family));
  check(
    missingFamilies.length === 0 && strayFamilies.length === 0,
    `the SQL shape-checks exactly the ${PLAN_FAMILIES.length} families the plan declares` +
      `${missingFamilies.length ? ` (missing ${missingFamilies.join(", ")})` : ""}` +
      `${strayFamilies.length ? ` (stray ${strayFamilies.join(", ")})` : ""}`,
  );
  // Every family must also be MEASURED exactly once. A family the SQL forgets
  // to measure would reconcile as `null` against its declared count, which
  // `COUNT_MISMATCH` catches — but a family measured twice would silently
  // overwrite its own count, which nothing else would.
  const measuredFamilies = [
    ...[...commit.matchAll(/actual := actual \|\| jsonb_build_object\('(\w+)'/g)].map((m) => m[1]),
    ...[...commit.matchAll(/'(\w+)', created_(?:people|ids) \+ reused_(?:people|ids)/g)].map((m) => m[1]),
  ];
  const measuredOnce = new Set(measuredFamilies);
  check(
    measuredFamilies.length === PLAN_FAMILIES.length &&
      measuredOnce.size === measuredFamilies.length &&
      PLAN_FAMILIES.every((family) => measuredOnce.has(family)),
    `each of the ${PLAN_FAMILIES.length} families is measured exactly once (${measuredFamilies.length} measurements, ${measuredOnce.size} distinct)`,
  );
  // And every table the ledger can own must actually be written by the commit.
  const written = new Set([...commit.matchAll(/insert into public\.([a-z_]+)/g)].map((m) => m[1]));
  check(
    LEDGER_VOCABULARY.every((table) => written.has(table)),
    `the commit writes every table the ledger can own` +
      `${LEDGER_VOCABULARY.filter((table) => !written.has(table)).length ? `: missing ${LEDGER_VOCABULARY.filter((t) => !written.has(t)).join(", ")}` : ""}`,
  );
  check(/EXPECTED_COUNTS_MISSING/.test(commit), "a plan with no declared counts is refused");
  check(/COUNT_MISMATCH/.test(commit), "a measured count that disagrees raises");
  check(/COUNT_FAMILY_UNDECLARED/.test(commit), "and so does a family the plan never declared");
  check(/LEDGER_INCONSISTENT/.test(commit), "an incomplete ownership ledger refuses the commit");
  check(
    /exception\s*\n\s*when others then/.test(commit),
    "the whole write lives inside one exception-guarded block — a PL/pgSQL subtransaction",
  );
  check(
    /get stacked diagnostics[\s\S]*?failure_code\s*=\s*message_text/.test(commit),
    "the handler reads the message once",
  );
  check(
    /failure_code !~ '\^\[A-Z\]\[A-Z0-9_\]\{1,59\}\$'[\s\S]*?failure_code := 'DATABASE_CONSTRAINT'/.test(commit),
    "and keeps it ONLY when it is a code this migration raised itself",
  );
  check(
    !/error_report\s*=\s*jsonb_build_object\([^)]*message_text/.test(commit),
    "no PostgreSQL message is ever stored on the job",
  );
  check(
    /status\s*=\s*'failed'[\s\S]*?actual_counts\s*=\s*'\{\}'::jsonb/.test(commit),
    "a failed attempt records zero counts, not the counts it hoped for",
  );
  check(
    /if job\.status = 'committed' then[\s\S]*?COMMITTED_PAYLOAD_DIFFERS[\s\S]*?'replayed', true/.test(commit),
    "a replay of a committed package returns without writing, and refuses a different payload",
  );
  check(
    /select count\(\*\) into owned_rows[\s\S]*?PACKAGE_ROWS_PRESENT/.test(commit),
    "a retry over a ledger that still owns rows is refused",
  );
  check(
    /'staged', 'validated', 'failed', 'rolled_back', 'committing'/.test(commit),
    "the legal states a commit may start from are enumerated",
  );
  check(
    /pg_catalog\.sha256\(pg_catalog\.convert_to\(\(p_plan - 'planFingerprint'\)::text, 'UTF8'\)\)/.test(commit),
    "the database digests the payload it actually received, independently of the caller",
  );
  check(
    /commit_attempts = commit_attempts \+ 1/.test(commit) && /committed_at\s*=\s*now\(\)/.test(commit),
    "attempts and timestamps are recorded coherently",
  );
}

// ---- [16] Migration 0024: ownership and rollback ---------------------------
console.log("\n[16] STRUCTURAL — the ownership ledger and the rollback order");
{
  check(LEDGER_VOCABULARY.length === 31, `the ledger names 31 canonical tables (${LEDGER_VOCABULARY.length})`);
  check(
    !LEDGER_VOCABULARY.includes("source_asset") && !LEDGER_VOCABULARY.includes("import_job_asset"),
    "source assets and their job links are NOT owned rows — they are provenance and survive a rollback",
  );
  check(
    !/delete from public\.(source_asset|import_job_asset|import_job)\b/.test(FORWARD),
    "and nothing in 0024 ever deletes an asset, an asset link or the audit job itself",
  );
  check(
    /ownership\s+text not null check \(ownership in \('created', 'reused'\)\)/.test(FORWARD),
    "the ledger separates a row this package CREATED from one it REUSED",
  );

  const rollback = FORWARD.slice(FORWARD.indexOf("create or replace function public.rollback_canonical_package"));
  const ordered = (rollback.match(/ordered_tables text\[\] := array\[([\s\S]*?)\];/)?.[1] ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
  check(ordered.length === 29, `the rollback walks 29 tables in order (${ordered.length})`);
  // `person_private` and `person_external_identifier` are handled AFTER the
  // ordered pass, together: an identity is kept whole or removed whole, and
  // deleting a retained person's identifier would make that person invisible to
  // the reuse path and collide on the next commit.
  const covered = new Set([...ordered, "person_private", "person_external_identifier"]);
  const uncovered = LEDGER_VOCABULARY.filter((table) => !covered.has(table));
  const extra = [...covered].filter((table) => !LEDGER_VOCABULARY.includes(table));
  check(
    uncovered.length === 0 && extra.length === 0,
    `the rollback covers exactly the ledger vocabulary${uncovered.length ? ` (missing ${uncovered.join(", ")})` : ""}${extra.length ? ` (extra ${extra.join(", ")})` : ""}`,
  );
  check(
    /where import_job_id = \$1 and target_table = \$2 and ownership = ''created''/.test(rollback),
    "it deletes ONLY the rows this package created",
  );
  check(
    /not exists \(select 1 from public\.study_participant sp where sp\.person_id = stored\.id\)/.test(rollback),
    "a person still referenced by another study is kept, not destroyed",
  );
  check(
    /_retainedSharedIdentities/.test(rollback),
    "and the number kept is reported rather than silently absorbed",
  );
  check(
    /if job\.status = 'rolled_back' then[\s\S]*?'replayed', true/.test(rollback),
    "repeating a rollback is idempotent",
  );
  check(
    /ROLLED_BACK_LEDGER_NOT_EMPTY/.test(rollback),
    "unless the job says rolled back while still owning rows, which is refused for human review",
  );
  check(/ONLY_COMMITTED_CAN_ROLL_BACK/.test(rollback), "only a committed package may be reverted");
  check(
    /status\s*=\s*'rolled_back',\s*\n\s*rolled_back_at\s*=\s*now\(\)/.test(rollback) &&
      /rollback_count\s*=\s*rollback_count \+ 1/.test(rollback),
    "the audit job survives with an honest final status, timestamp and count",
  );

  // The delete order must respect every ON DELETE RESTRICT edge in 0022/0023:
  // the referencing table has to go before the table it points at.
  const restrictEdges = [];
  for (const sql of [FOUNDATION, ANALYSIS]) {
    for (const block of sql.split(/create table public\./).slice(1)) {
      const owner = block.match(/^([a-z_]+)/)?.[1];
      if (!owner) continue;
      const body = block.slice(0, block.indexOf("\n);") + 3);
      for (const edge of body.matchAll(/references public\.([a-z_]+) \([^)]*\) on delete restrict/g)) {
        if (edge[1] !== owner) restrictEdges.push([owner, edge[1]]);
      }
    }
  }
  check(restrictEdges.length >= 12, `0022 and 0023 declare ${restrictEdges.length} ON DELETE RESTRICT edges`);
  const position = new Map(
    [...ordered, "person_external_identifier", "person_private"].map((table, index) => [table, index]),
  );
  const violations = restrictEdges.filter(([owner, referenced]) => {
    if (!position.has(owner) || !position.has(referenced)) return false;
    return position.get(owner) > position.get(referenced);
  });
  check(
    violations.length === 0,
    `the rollback deletes every restricting row before the row it points at${violations.length ? `: ${violations.map((v) => v.join("->")).join(", ")}` : ""}`,
  );
  check(
    position.get("person_private") === position.size - 1 &&
      position.get("person_external_identifier") === position.size - 2,
    "and the shared identity — person and identifier together — is handled last of all",
  );
  check(
    /delete from public\.person_external_identifier stored[\s\S]*?not exists \(select 1 from public\.study_participant sp where sp\.person_id = stored\.person_id\)/.test(
      rollback,
    ),
    "a retained person keeps its external identifier, so the reuse path can still find it",
  );
  check(/_retainedExternalIdentifiers/.test(rollback), "and the identifiers kept are reported too");
  check(
    /delete from public\.source_lineage where import_job_id = job\.id/.test(rollback),
    "lineage for this package is removed with it",
  );
}

// ---- [17] Migration 0024 has an exact reverse ------------------------------
console.log("\n[17] STRUCTURAL — every object 0024 creates has a reverse counterpart");
{
  for (const [name, signature] of FUNCTIONS) {
    check(
      new RegExp(`drop function public\\.${name}\\(${signature}\\);`).test(REVERSE),
      `the reverse drops ${name}`,
    );
  }
  const createdTables = [...FORWARD.matchAll(/create table public\.([a-z_]+)/g)].map((m) => m[1]);
  const droppedTables = [...REVERSE.matchAll(/drop table public\.([a-z_]+);/g)].map((m) => m[1]);
  check(
    createdTables.length === 2 && createdTables.every((table) => droppedTables.includes(table)),
    `both new tables are dropped (${createdTables.join(", ")})`,
  );
  const createdIndexes = [...FORWARD.matchAll(/create index ([a-z_]+)/g)].map((m) => m[1]);
  const droppedIndexes = [...REVERSE.matchAll(/drop index public\.([a-z_]+);/g)].map((m) => m[1]);
  check(
    createdIndexes.every((index) => droppedIndexes.includes(index)),
    `all ${createdIndexes.length} new indexes are dropped`,
  );
  const addedColumns = [...FORWARD.matchAll(/add column ([a-z_]+)/g)].map((m) => m[1]);
  const droppedColumns = [...REVERSE.matchAll(/drop column ([a-z_]+)/g)].map((m) => m[1]);
  check(
    addedColumns.every((column) => droppedColumns.includes(column)),
    `all ${addedColumns.length} added columns are dropped (${[...new Set(addedColumns)].join(", ")})`,
  );
  const addedConstraints = [...FORWARD.matchAll(/add constraint ([a-z_]+)/g)].map((m) => m[1]);
  const droppedConstraints = [...REVERSE.matchAll(/drop constraint ([a-z_]+)/g)].map((m) => m[1]);
  const missing = addedConstraints.filter((name) => !droppedConstraints.includes(name));
  check(missing.length === 0, `all ${addedConstraints.length} added constraints are dropped${missing.length ? `: ${missing.join(", ")}` : ""}`);

  const vocabularyOf = (sql) =>
    (sql.match(/add constraint source_lineage_target_table_check check \(target_table in \(([\s\S]*?)\)\)/)?.[1] ?? "")
      .split(",")
      .map((entry) => entry.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .sort()
      .join(",");
  check(
    vocabularyOf(REVERSE) === vocabularyOf(ANALYSIS),
    "and the reverse restores migration 0023's lineage vocabulary exactly",
  );
  check(!/drop table/i.test(FORWARD), "the forward migration drops no table");
  check(
    !/\b(update|delete\s+from|truncate)\s+public\.(respondent|quant_response|qual_observation|import_batch|study|tenant)\b/i.test(
      FORWARD,
    ),
    "and rewrites no legacy row",
  );
  check(/^begin;/m.test(FORWARD) && /^commit;/m.test(FORWARD), "both scripts are transactional");
  check(/^begin;/m.test(REVERSE) && /^commit;/m.test(REVERSE), "including the reverse");
}

// ---- [18] The module boundary and the rest of the product ------------------
console.log("\n[18] The write path is server-only, and nothing else changed");
{
  const walk = (dir) => {
    const out = [];
    for (const name of readdirSync(join(root, dir))) {
      const relative = join(dir, name);
      if (statSync(join(root, relative)).isDirectory()) out.push(...walk(relative));
      else if (/\.(ts|tsx)$/.test(name)) out.push(relative);
    }
    return out;
  };
  const moduleFiles = walk(join("src", "lib", "ingestion", "canonical-commit"));
  check(moduleFiles.length >= 9, `the unit has ${moduleFiles.length} source files`);
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const sources = moduleFiles.map((path) => ({ path, code: stripComments(read(path)) }));

  const withClient = sources.filter(({ code }) => /@supabase\/supabase-js/.test(code));
  check(
    withClient.length === 1 && withClient[0].path.endsWith("adapter.ts"),
    `exactly one module knows about Supabase, and it is the adapter (${withClient.map((s) => s.path).join(", ")})`,
  );
  const serverOnly = sources.filter(({ code }) => /import ["']server-only["']/.test(code));
  check(
    serverOnly.length === 2 &&
      serverOnly.every(({ path }) => path.endsWith("adapter.ts") || path.endsWith("server.ts")),
    `the server-only marker guards the adapter and its entry point (${serverOnly.map((s) => s.path).join(", ")})`,
  );
  check(
    !/from ["']\.\/adapter["']|from ["']\.\/server["']/.test(read(join("src", "lib", "ingestion", "canonical-commit", "index.ts"))),
    "the public barrel does not re-export the server-only path, so importing a type cannot drag it in",
  );
  const nodeOnly = sources.filter(({ code }) => /from\s+["']node:|require\(/.test(code));
  check(nodeOnly.length === 0, "no module imports a Node-only builtin, so the unit evaluates on workerd");
  check(
    !sources.some(({ code }) => /["']exceljs/.test(code)),
    "and none of them resolves ExcelJS",
  );

  // Unit 2 writes nothing, and must keep writing nothing.
  const unit2 = walk(join("src", "lib", "ingestion", "canonical-package")).map((path) => ({
    path,
    code: stripComments(read(path)),
  }));
  const unit2Writers = unit2.filter(({ code }) => /@supabase|\.rpc\(|\.insert\(|\.upsert\(/.test(code));
  check(unit2Writers.length === 0, "Unit 2 still reaches no database");

  // The legacy import path is untouched.
  const persist = read(join("src", "lib", "ingestion", "persist.ts"));
  check(
    /commit_import_batch_with_private/.test(persist) && /rollback_import_batch/.test(persist),
    "the legacy atomic importer still calls its own RPCs",
  );
  check(
    !/canonical-commit/.test(persist),
    "and knows nothing about the canonical package",
  );
  const reader = read(join("src", "lib", "ingestion", "xlsx-reader.ts"));
  check(
    /export async function readXlsx\(/.test(reader) && /export async function readXlsxWorkbook\(/.test(reader),
    "both readers still exist with their separate contracts",
  );

  // No UI, no route and no client publication reaches this unit.
  const app = walk(join("src", "app"));
  const uiImporters = app.filter((path) => /canonical-commit/.test(read(path)));
  check(uiImporters.length === 0, `no route or component imports the unit${uiImporters.length ? `: ${uiImporters.join(", ")}` : ""}`);
  const components = walk(join("src", "components")).filter((path) => /canonical-commit/.test(read(path)));
  check(components.length === 0, "and no component does either");

  const pkg = JSON.parse(read("package.json"));
  check(
    (pkg.scripts?.test ?? "").includes("test:canonical-commit"),
    "this gate is registered in the offline test chain",
  );
  check(
    typeof pkg.scripts?.["test:canonical-commit-live"] === "string",
    "and the database-executed gate has its own script, kept out of the offline chain",
  );
  check(
    !(pkg.scripts?.test ?? "").includes("test:canonical-commit-live"),
    "so an unexecuted database test can never be counted as passed here",
  );
  check(
    (pkg.scripts?.test ?? "").includes("test:canonical-package") &&
      (pkg.scripts?.test ?? "").includes("test:canonical-study-model"),
    "and Units 1 and 2 remain in the same chain",
  );
}

// ---- [19] The database gate's own refusals, executed here -----------------
// The database gate can only be trusted if its refusals are themselves tested,
// and a rule that is only exercised by a run somebody might never do is not
// tested at all. Every guard below therefore runs in `npm test`.
console.log("\n[19] The database gate refuses every target that is not disposable");
{
  const base = { CANONICAL_COMMIT_TEST_PGHOST: "127.0.0.1", CANONICAL_COMMIT_TEST_PGUSER: "tester" };
  const refused = (env) => {
    try {
      resolveDisposableTarget(env);
      return null;
    } catch (thrown) {
      return thrown instanceof DisposableTargetError ? thrown.message : `WRONG ERROR: ${thrown.message}`;
    }
  };

  check(refused(base) === null, "a loopback host with a user is accepted");
  check(
    refused({ ...base, CANONICAL_COMMIT_TEST_PGHOST: "/var/run/postgresql" }) === null,
    "and so is a unix socket directory",
  );
  for (const host of ["db.example.com", "10.0.0.5", "::2", "db.abcdefg.supabase.co", "0.0.0.0"]) {
    check(refused({ ...base, CANONICAL_COMMIT_TEST_PGHOST: host }) !== null, `a host that is not loopback is refused`);
  }
  // Assembled rather than written out: a literal `scheme://user:pass@host` in a
  // source file is exactly the shape a secret scanner exists to flag, and a
  // synthetic one teaches it to ignore the real thing.
  const urlWithPassword = ["postgres://tester", ":", "not-a-real-password", "@localhost/postgres"].join("");
  check(
    refused({ ...base, CANONICAL_COMMIT_TEST_DATABASE_URL: urlWithPassword }) !== null,
    "a connection string carrying a password is refused",
  );
  check(
    refused({ ...base, CANONICAL_COMMIT_TEST_DATABASE_URL: "postgres://u@db.abc.supabase.co/postgres" }) !== null,
    "a connection string naming Supabase is refused",
  );
  check(
    refused({ ...base, CANONICAL_COMMIT_TEST_DATABASE_URL: "mysql://u@localhost/x" }) !== null,
    "and one that is not PostgreSQL at all",
  );
  for (const name of FORBIDDEN_ENVIRONMENT) {
    check(refused({ ...base, [name]: "anything" }) !== null, `the gate refuses to run while ${name} is set`);
  }
  for (const database of ["supabase", "becommunity", "production", "template1"]) {
    check(
      refused({ ...base, CANONICAL_COMMIT_TEST_ADMIN_DB: database }) !== null,
      `'${database}' is refused as the admin database`,
    );
  }
  check(
    refused({ ...base, CANONICAL_COMMIT_TEST_ADMIN_DB: "postgres" }) === null,
    "only 'postgres' is allowed as the admin connection",
  );

  const workRefused = (name) => {
    try {
      assertDisposableWorkDatabase(name);
      return false;
    } catch {
      return true;
    }
  };
  for (const name of ["postgres", "template0", "template1", "supabase", "becommunity", "app", "main", "staging"]) {
    check(workRefused(name), `'${name}' can never be a work database`);
  }
  check(!workRefused("becommunity_canonical_test_core_1_ab12"), "a properly prefixed name is accepted");
  check(workRefused("becommunity_canonical_tests_x"), "a near-miss prefix is refused");
  let generatedOk = true;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!DISPOSABLE_DATABASE_PATTERN.test(disposableDatabaseName("core"))) generatedOk = false;
  }
  check(generatedOk, "every generated name matches the disposable pattern");

  // The SQLSTATE reader must not answer "ERROR" — five uppercase letters that
  // would make every state assertion in the database gate vacuously true.
  check(
    sqlstateOf("psql:x.sql:5: ERROR:  42501: permission denied for function f") === "42501",
    "the SQLSTATE reader finds the state psql reports",
  );
  check(sqlstateOf("psql:x.sql:5: ERROR:  permission denied") !== "ERROR", "and never mistakes the word ERROR for one");
  check(sqlstateOf("55000") === "55000", "a bare state is returned as itself");

  const live = read("scripts/canonical-commit-live-test.mjs");
  check(live.length > 5000, `the database gate is a real harness (${live.length} bytes)`);
  check(
    /runCanonicalCommit/.test(live) && /runCanonicalRollback/.test(live) && /withDisposableDatabase/.test(live),
    "that drives the product's own workflow against a database it creates",
  );
  check(/create database/i.test(read("scripts/lib/disposable-postgres.mjs")), "and really creates one");
  check(/drop database if exists/i.test(read("scripts/lib/disposable-postgres.mjs")), "and drops it on both paths");
  check(
    /L16\.2/.test(live) && /diffCatalogue/.test(live),
    "and compares the catalogue before and after the rollback",
  );
  const declared = [...live.matchAll(/check\(\s*"(L\d+)[.\d]*"/g)].map((m) => m[1]);
  const covered = new Set(declared);
  const missing = Array.from({ length: 16 }, (_, i) => `L${i + 1}`).filter((id) => !covered.has(id));
  check(missing.length === 0, `it asserts all sixteen required behaviours${missing.length ? ` (missing ${missing.join(", ")})` : ""}`);
}

console.log("\n" + "=".repeat(70));
console.log(
  "NOTE: sections [14] to [17] read migration 0024's SQL. They are STRUCTURAL proof,\n" +
    "      and this gate reports no database-executed result of its own.\n" +
    "      Execution lives in scripts/canonical-commit-live-test.mjs, which needs a\n" +
    "      disposable PostgreSQL server:\n" +
    "        bash scripts/lib/disposable-postgres-provision.sh\n" +
    "        npm run test:canonical-commit-live",
);
console.log("=".repeat(70));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s). GATE BLOCKED.`);
  process.exit(1);
}
console.log(
  "RESULT: the package projects completely, keeps every source distinction, keeps private values out of\n" +
    "        every safe surface, and the commit/rollback contract is structurally complete. GATE PASSED.",
);
