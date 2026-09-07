// =============================================================================
// The DATABASE-BACKED READ ADAPTER — offline gate
//   npm run test:canonical-database-source        (part of `npm test`)
// =============================================================================
// It runs everywhere and needs nothing: no database, no network, no workbook,
// no credential. What it proves is everything about the adapter that does NOT
// require a server — which is most of it, because the adapter was deliberately
// split so that only one small module needs one.
//
//   `rows.ts`       the columns that are selected, and the four that never are
//   `read.ts`       paging, ordering, ceilings, scope, and every refusal
//   `postgrest.ts`  the query shape and the composite keyset filter string
//   `assemble.ts`   the redaction rules and the number resolution
//   `normalize.ts`  the shared comparison order
//   `adapter.ts`    server-only, and the ONLY module that names a client
//
// The one thing it cannot prove is the round trip through a real
// `commit_canonical_package`. That is what
// `scripts/canonical-import-rehearsal.mjs` does, against a disposable
// PostgreSQL and a real PostgREST, and it is reported separately rather than
// implied here.
//
// THE ROWS BELOW ARE HAND-WRITTEN ON PURPOSE. Deriving them from a projected
// plan would encode the same assumption twice: the test would agree with the
// adapter because both read the same source of truth, and a wrong mapping
// would pass. Hand-written rows state independently what the tables hold.
// =============================================================================

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  CANONICAL_READS,
  CANONICAL_READ_CONCURRENCY,
  CANONICAL_READ_PAGE_SIZE,
  CanonicalReadError,
  canonicalResultSourceFromRows,
  keysetFilter,
  loadCanonicalRowSet,
  mapBounded,
  normalizeCanonicalResultSource,
  postgrestReadTransport,
  readCanonicalTable,
} from "../src/lib/canonical-source/index.ts";
import { CUICUILCO_RESULTS_V1 } from "../src/lib/results/index.ts";
import { CANONICAL_FAMILY_TABLES, STUDY_SCOPED_CANONICAL_TABLES } from "./lib/canonical-tables.mjs";

let passed = 0;
let failed = 0;
const check = (label, fn) => {
  try {
    fn();
    passed += 1;
    console.log("  ✓", label);
  } catch (thrown) {
    failed += 1;
    console.error("  ✗ FAIL:", label);
    console.error("      ", thrown instanceof Error ? thrown.message.split("\n")[0] : String(thrown));
  }
};
const checkAsync = async (label, fn) => {
  try {
    await fn();
    passed += 1;
    console.log("  ✓", label);
  } catch (thrown) {
    failed += 1;
    console.error("  ✗ FAIL:", label);
    console.error("      ", thrown instanceof Error ? thrown.message.split("\n")[0] : String(thrown));
  }
};

const TENANT = "11111111-1111-4111-8111-111111111111";
const STUDY = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

console.log("Be Community — adaptador canónico de lectura desde la base de datos (offline)");
console.log("=".repeat(78));

// ---------------------------------------------------------------------------
// A fake transport: it serves rows from an in-memory table map and RECORDS
// every request, so the scope, the order and the window can be asserted.
//
// It also records a TIMELINE of starts and ends and the peak number in flight.
// Counting requests cannot prove the read is bounded — twenty-seven requests
// arrive whether they were issued six at a time or all at once — and it cannot
// prove the committed-package gate ran alone either. The timeline can.
// ---------------------------------------------------------------------------
function fakeTransport(tables, options = {}) {
  const requests = [];
  const timeline = [];
  const inFlight = { now: 0, peak: 0 };
  return {
    requests,
    timeline,
    inFlight,
    transport: {
      readPage: async (request) => {
        requests.push(request);
        inFlight.now += 1;
        inFlight.peak = Math.max(inFlight.peak, inFlight.now);
        timeline.push(`start:${request.table}`);
        try {
          return await serve(request);
        } finally {
          inFlight.now -= 1;
          timeline.push(`end:${request.table}`);
        }
      },
    },
  };

  async function serve(request) {
        // A real yield, so concurrent readers genuinely overlap and `peak`
        // measures something. Without it every page would resolve before the
        // next was issued and a serial pool would look identical to a bounded
        // one.
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (options.failWith) return { rows: null, error: options.failWith };
        const all = (tables[request.table] ?? []).filter((row) => {
          for (const [column, value] of Object.entries(request.equals ?? {})) {
            if (row[column] !== value) return false;
          }
          return row.__tenant === request.scope.tenantId && row.__study === request.scope.studyId;
        });
        const compare = (a, b) => {
          for (const column of request.keyColumns) {
            if (a[column] < b[column]) return -1;
            if (a[column] > b[column]) return 1;
          }
          return 0;
        };
        let ordered = all.slice().sort(compare);
        if (options.unordered) ordered = ordered.slice().reverse();
        if (request.cursor) {
          ordered = ordered.filter((row) => compare(row, request.cursor) > 0);
        }
        const page = ordered.slice(0, request.limit).map((row) => {
          const copy = { ...row };
          delete copy.__tenant;
          delete copy.__study;
          return copy;
        });
        return { rows: page, error: null };
  }
}

const scoped = (rows) => rows.map((row) => ({ ...row, __tenant: TENANT, __study: STUDY }));

// ===========================================================================
console.log("\n[1] La declaración de lecturas");
check("las 32 familias del plan tienen una tabla declarada", () => {
  assert.equal(CANONICAL_FAMILY_TABLES.length, 32);
  assert.equal(new Set(CANONICAL_FAMILY_TABLES.map((e) => e.table)).size, 32);
});
check("todas las lecturas de datos tienen techo por encima de una página", () => {
  for (const [name, read] of Object.entries(CANONICAL_READS)) {
    if (name === "importJob") continue;
    assert.ok(read.maxRows > CANONICAL_READ_PAGE_SIZE, name);
  }
});
check("treinta tablas se pueden contar por estudio", () => {
  assert.equal(STUDY_SCOPED_CANONICAL_TABLES.length, 30);
});
check("cada lectura declara columnas, clave y techo", () => {
  // `importJob` is the one read whose ceiling is BELOW the page size on purpose:
  // two hundred import jobs for one study is already pathological, and a
  // refusal there is the right answer rather than a longer read.
  for (const [name, read] of Object.entries(CANONICAL_READS)) {
    assert.ok(read.table.length > 0, name);
    assert.ok(read.columns.length > 0, name);
    assert.ok(read.keyColumns.length >= 1 && read.keyColumns.length <= 2, name);
    assert.ok(Number.isInteger(read.maxRows) && read.maxRows > 0, name);
  }
});
check("ninguna lectura pide una columna que la privacidad prohíbe", () => {
  const forbidden = [
    "display_name_private",
    "normalized_name_private",
    "original_value",
    "normalized_value",
    "raw_text",
    "normalized_text",
    "source_raw_value",
    "prompt",
  ];
  for (const [name, read] of Object.entries(CANONICAL_READS)) {
    for (const column of read.columns) {
      assert.ok(!forbidden.includes(column), `${name} pide ${column}`);
    }
  }
});
check("las tablas de identidad y de linaje no se leen en absoluto", () => {
  const tables = new Set(Object.values(CANONICAL_READS).map((read) => read.table));
  for (const table of ["person_private", "person_external_identifier", "source_lineage"]) {
    assert.ok(!tables.has(table), table);
  }
});

// ===========================================================================
console.log("\n[2] Paginación por keyset");
await checkAsync("un conjunto mayor que la página se lee completo y en orden", async () => {
  const rows = scoped(Array.from({ length: 2350 }, (_, index) => ({ id: uuid(index + 1) })));
  const { transport, requests } = fakeTransport({ study_participant: rows });
  const read = { ...CANONICAL_READS.participants, columns: ["id"] };
  const answer = await readCanonicalTable(transport, read, { tenantId: TENANT, studyId: STUDY });
  assert.equal(answer.length, 2350);
  assert.equal(new Set(answer.map((row) => row.id)).size, 2350);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].cursor, null);
  assert.equal(requests[1].cursor.id, uuid(1000));
  assert.equal(requests[2].cursor.id, uuid(2000));
});
await checkAsync("una página exactamente llena pide otra, y una corta termina la lectura", async () => {
  const rows = scoped(Array.from({ length: CANONICAL_READ_PAGE_SIZE }, (_, i) => ({ id: uuid(i + 1) })));
  const { transport, requests } = fakeTransport({ study_participant: rows });
  const answer = await readCanonicalTable(transport, { ...CANONICAL_READS.participants, columns: ["id"] }, {
    tenantId: TENANT,
    studyId: STUDY,
  });
  assert.equal(answer.length, CANONICAL_READ_PAGE_SIZE);
  assert.equal(requests.length, 2);
});
await checkAsync("una página desordenada es un rechazo, no una lectura con huecos", async () => {
  const rows = scoped(Array.from({ length: 5 }, (_, i) => ({ id: uuid(i + 1) })));
  const { transport } = fakeTransport({ study_participant: rows }, { unordered: true });
  await assert.rejects(
    () => readCanonicalTable(transport, { ...CANONICAL_READS.participants, columns: ["id"] }, { tenantId: TENANT, studyId: STUDY }),
    (error) => error instanceof CanonicalReadError && error.code === "READ_NOT_ORDERED",
  );
});
await checkAsync("un conjunto mayor que su techo es un rechazo, no un truncamiento", async () => {
  const rows = scoped(Array.from({ length: 40 }, (_, i) => ({ id: uuid(i + 1) })));
  const { transport } = fakeTransport({ study_participant: rows });
  await assert.rejects(
    () =>
      readCanonicalTable(
        transport,
        { ...CANONICAL_READS.participants, columns: ["id"], maxRows: 20 },
        { tenantId: TENANT, studyId: STUDY },
      ),
    (error) => error instanceof CanonicalReadError && error.code === "READ_EXCEEDS_CEILING",
  );
});
await checkAsync("una clave que no es uuid detiene la lectura", async () => {
  const { transport } = fakeTransport({ study_participant: scoped([{ id: "no-soy-un-uuid" }]) });
  await assert.rejects(
    () => readCanonicalTable(transport, { ...CANONICAL_READS.participants, columns: ["id"] }, { tenantId: TENANT, studyId: STUDY }),
    (error) => error instanceof CanonicalReadError && error.code === "READ_KEY_NOT_UUID",
  );
});
await checkAsync("un error del transporte llega como CÓDIGO, nunca como mensaje", async () => {
  const { transport } = fakeTransport(
    {},
    { failWith: { message: 'duplicate key value violates unique constraint: "Juan Pérez"' } },
  );
  await assert.rejects(
    () => readCanonicalTable(transport, { ...CANONICAL_READS.participants, columns: ["id"] }, { tenantId: TENANT, studyId: STUDY }),
    (error) => error instanceof CanonicalReadError && !/Juan/.test(error.message),
  );
});
await checkAsync("una clave compuesta pagina por la tupla completa", async () => {
  const rows = scoped(
    Array.from({ length: 1500 }, (_, index) => ({
      pain_point_id: uuid(Math.floor(index / 3) + 1),
      journey_stage_id: uuid(9000 + (index % 3)),
      display_order: index % 3,
    })),
  );
  const { transport, requests } = fakeTransport({ pain_point_journey_stage: rows });
  const answer = await readCanonicalTable(transport, CANONICAL_READS.painPointJourneyStages, {
    tenantId: TENANT,
    studyId: STUDY,
  });
  assert.equal(answer.length, 1500);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].cursor.pain_point_id, uuid(334));
  assert.equal(requests[1].cursor.journey_stage_id, uuid(9000));
});

// ===========================================================================
console.log("\n[3] El alcance por cliente y estudio no es opcional");
await checkAsync("cada petición lleva el cliente Y el estudio", async () => {
  const { transport, requests } = fakeTransport({ study_participant: scoped([{ id: uuid(1) }]) });
  await readCanonicalTable(transport, { ...CANONICAL_READS.participants, columns: ["id"] }, { tenantId: TENANT, studyId: STUDY });
  assert.ok(requests.every((request) => request.scope.tenantId === TENANT && request.scope.studyId === STUDY));
});
await checkAsync("una fila de otro cliente no entra en el conjunto", async () => {
  const mine = scoped([{ id: uuid(1) }]);
  const theirs = [{ id: uuid(2), __tenant: OTHER_TENANT, __study: STUDY }];
  const { transport } = fakeTransport({ study_participant: [...mine, ...theirs] });
  const answer = await readCanonicalTable(transport, { ...CANONICAL_READS.participants, columns: ["id"] }, {
    tenantId: TENANT,
    studyId: STUDY,
  });
  assert.deepEqual(answer.map((row) => row.id), [uuid(1)]);
});
await checkAsync("un cliente que no es uuid es un rechazo antes de cualquier lectura", async () => {
  const { transport, requests } = fakeTransport({});
  await assert.rejects(
    () => loadCanonicalRowSet(transport, { tenantId: "no", studyId: STUDY }),
    (error) => error instanceof CanonicalReadError && error.code === "SCOPE_TENANT_INVALID",
  );
  assert.equal(requests.length, 0);
});
await checkAsync("un estudio que no es uuid es un rechazo antes de cualquier lectura", async () => {
  const { transport, requests } = fakeTransport({});
  await assert.rejects(
    () => loadCanonicalRowSet(transport, { tenantId: TENANT, studyId: "no" }),
    (error) => error instanceof CanonicalReadError && error.code === "SCOPE_STUDY_INVALID",
  );
  assert.equal(requests.length, 0);
});

// ===========================================================================
console.log("\n[4] El filtro de ventana de PostgREST");
check("una clave simple produce un `gt`", () => {
  assert.equal(keysetFilter(["id"], { id: uuid(7) }), `id.gt.${uuid(7)}`);
});
check("una clave compuesta produce la expansión lexicográfica", () => {
  const filter = keysetFilter(["a", "b"], { a: uuid(1), b: uuid(2) });
  assert.equal(filter, `a.gt.${uuid(1)},and(a.eq.${uuid(1)},b.gt.${uuid(2)})`);
});
check("un valor que no es uuid nunca llega a formar parte del filtro", () => {
  assert.throws(
    () => keysetFilter(["id"], { id: "1,or(tenant_id.neq.x)" }),
    (error) => error instanceof CanonicalReadError && error.code === "READ_KEY_NOT_UUID",
  );
});
check("tres columnas de clave se rechazan en vez de aproximarse", () => {
  assert.throws(
    () => keysetFilter(["a", "b", "c"], { a: uuid(1), b: uuid(2), c: uuid(3) }),
    (error) => error instanceof CanonicalReadError && error.code === "READ_KEY_ARITY_UNSUPPORTED",
  );
});
/**
 * A builder that RECORDS the chain it was asked for.
 *
 * `abortSignal` is recorded by IDENTITY — `signal === expected` — because the
 * only thing that matters about it is that the CALLER'S OWN signal reached the
 * query. A recorder that merely accepted the call would pass against a
 * transport that fabricated a signal of its own.
 */
const recordingClient = (calls, expectedSignal) => {
  const query = {
    eq: (column) => (calls.push(`eq:${column}`), query),
    or: (filter) => (calls.push(`or:${filter.slice(0, 3)}`), query),
    order: (column) => (calls.push(`order:${column}`), query),
    limit: (n) => (calls.push(`limit:${n}`), query),
    abortSignal: (signal) => (calls.push(`abortSignal:${signal === expectedSignal}`), query),
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return { from: (table) => (calls.push(`from:${table}`), { select: () => query }) };
};

await checkAsync("la consulta aplica el alcance ANTES de la ventana, el orden y el límite", async () => {
  const calls = [];
  await postgrestReadTransport(recordingClient(calls, null)).readPage({
    table: "survey_response",
    columns: ["id"],
    keyColumns: ["id"],
    scope: { tenantId: TENANT, studyId: STUDY },
    cursor: { id: uuid(5) },
    limit: 1000,
  });
  assert.deepEqual(calls, [
    "from:survey_response",
    "eq:tenant_id",
    "eq:study_id",
    "or:id.",
    "order:id",
    "limit:1000",
  ]);
});
await checkAsync("y la señal del que llama se pone en la consulta, la ÚLTIMA y sin sustituirla", async () => {
  // `query.abortSignal(request.signal)` in `postgrest.ts` is the ONE line that
  // turns a cancelled read into a cancelled socket. Every other cancellation
  // check in this file and in `shadow-boundary-test.mjs` drives a hand-written
  // `readPage`, so deleting that line left all of them green. This is the
  // check that fails when it goes.
  const signal = new AbortController().signal;
  const calls = [];
  await postgrestReadTransport(recordingClient(calls, signal)).readPage({
    table: "survey_response",
    columns: ["id"],
    keyColumns: ["id"],
    scope: { tenantId: TENANT, studyId: STUDY },
    cursor: null,
    limit: 1000,
    signal,
  });
  assert.deepEqual(calls, [
    "from:survey_response",
    "eq:tenant_id",
    "eq:study_id",
    "order:id",
    "limit:1000",
    // LAST, so it applies to the finished query and to nothing else. And
    // `true`, so it is the caller's signal and not one the transport invented.
    "abortSignal:true",
  ]);
});
await checkAsync("y sin señal la consulta no gana un `abortSignal` de la nada", async () => {
  const calls = [];
  await postgrestReadTransport(recordingClient(calls, null)).readPage({
    table: "survey_response",
    columns: ["id"],
    keyColumns: ["id"],
    scope: { tenantId: TENANT, studyId: STUDY },
    cursor: null,
    limit: 1000,
  });
  assert.ok(!calls.some((entry) => entry.startsWith("abortSignal")), calls.join(","));
});

// ===========================================================================
console.log("\n[5] Resolver el paquete confirmado");
const manifestJob = (id, key, status = "committed") => ({
  id,
  idempotency_key: key,
  mapping_version: 1,
  status,
  committed_at: "2026-09-06T00:00:00.000Z",
  plan: { specId: "cuicuilco", planFingerprint: `sha256:${"a".repeat(64)}`, packageIdempotencyKey: key },
  __tenant: TENANT,
  __study: STUDY,
});
const KEY_A = `sha256:${"1".repeat(64)}`;
const KEY_B = `sha256:${"2".repeat(64)}`;

await checkAsync("un estudio sin paquete confirmado es un rechazo con nombre", async () => {
  const { transport } = fakeTransport({ import_job: [] });
  await assert.rejects(
    () => loadCanonicalRowSet(transport, { tenantId: TENANT, studyId: STUDY }),
    (error) => error.code === "NO_COMMITTED_PACKAGE",
  );
});
await checkAsync("dos paquetes confirmados es un rechazo, no «el más reciente»", async () => {
  const { transport } = fakeTransport({ import_job: [manifestJob(uuid(1), KEY_A), manifestJob(uuid(2), KEY_B)] });
  await assert.rejects(
    () => loadCanonicalRowSet(transport, { tenantId: TENANT, studyId: STUDY }),
    (error) => error.code === "MULTIPLE_COMMITTED_PACKAGES",
  );
});
await checkAsync("pedir un paquete por su clave elige exactamente ese", async () => {
  const { transport } = fakeTransport({ import_job: [manifestJob(uuid(1), KEY_A), manifestJob(uuid(2), KEY_B)] });
  const rows = await loadCanonicalRowSet(transport, {
    tenantId: TENANT,
    studyId: STUDY,
    packageIdempotencyKey: KEY_B,
  });
  assert.equal(rows.importJob.id, uuid(2));
  assert.equal(rows.importJob.idempotency_key, KEY_B);
});
await checkAsync("sólo se consideran los trabajos confirmados", async () => {
  const { transport, requests } = fakeTransport({
    import_job: [manifestJob(uuid(1), KEY_A, "staged"), manifestJob(uuid(2), KEY_B)],
  });
  const rows = await loadCanonicalRowSet(transport, { tenantId: TENANT, studyId: STUDY });
  assert.equal(rows.importJob.id, uuid(2));
  assert.equal(requests[0].equals.status, "committed");
});
await checkAsync("un manifiesto sin cabecera de plan es un rechazo", async () => {
  const job = manifestJob(uuid(1), KEY_A);
  delete job.plan;
  const { transport } = fakeTransport({ import_job: [job] });
  await assert.rejects(
    () => loadCanonicalRowSet(transport, { tenantId: TENANT, studyId: STUDY }),
    (error) => error.code === "MANIFEST_PLAN_MISSING",
  );
});
await checkAsync("una huella con formato inválido es un rechazo", async () => {
  const job = manifestJob(uuid(1), KEY_A);
  job.plan = { ...job.plan, planFingerprint: "sha256:corta" };
  const { transport } = fakeTransport({ import_job: [job] });
  await assert.rejects(
    () => loadCanonicalRowSet(transport, { tenantId: TENANT, studyId: STUDY }),
    (error) => error.code === "MANIFEST_PLAN_MISSING",
  );
});
await checkAsync("un paquete incompleto se lee sin inventar filas", async () => {
  const { transport } = fakeTransport({ import_job: [manifestJob(uuid(1), KEY_A)] });
  const rows = await loadCanonicalRowSet(transport, { tenantId: TENANT, studyId: STUDY });
  for (const family of ["participants", "items", "responses", "painPoints"]) {
    assert.deepEqual(rows[family], [], family);
  }
});

// ===========================================================================
console.log("\n[6] Las reglas de redacción del ensamblador");

/** A deliberately small, hand-written package. Nothing derived from a plan. */
function handWrittenRows(overrides = {}) {
  return {
    importJob: { id: uuid(1), idempotency_key: KEY_A, mapping_version: 1, status: "committed", committed_at: null },
    specId: "cuicuilco",
    planFingerprint: `sha256:${"a".repeat(64)}`,
    participants: [
      {
        id: uuid(10),
        cohort_key: "active",
        participation_status: "included",
        survey_participation_status: "responded",
        source_status: "answered",
      },
      {
        id: uuid(11),
        cohort_key: "deserter",
        participation_status: "included",
        survey_participation_status: "not_participated",
        source_status: "not_participated",
      },
    ],
    attributeDefinitions: [
      {
        id: uuid(20),
        key: "perfil_cliente_genero",
        label: "Género",
        data_type: "category",
        sensitivity: "client_eligible",
        filterable: true,
        display_order: 1,
      },
      {
        id: uuid(21),
        key: "perfil_cliente_marca_temporal",
        label: "Marca temporal",
        data_type: "date",
        sensitivity: "private",
        filterable: false,
        display_order: 2,
      },
      {
        id: uuid(22),
        key: "otro_campo_libre",
        label: "Otro",
        data_type: "text",
        sensitivity: "internal",
        filterable: true,
        display_order: 3,
      },
    ],
    attributeValues: [
      {
        id: uuid(30),
        participant_id: uuid(10),
        attribute_definition_id: uuid(20),
        status: "answered",
        value_text: "Femenino",
        value_numeric: null,
      },
      {
        id: uuid(31),
        participant_id: uuid(10),
        attribute_definition_id: uuid(21),
        status: "answered",
        value_text: "2026-01-02 11:04:59",
        value_numeric: null,
      },
      {
        id: uuid(32),
        participant_id: uuid(10),
        attribute_definition_id: uuid(22),
        status: "answered",
        value_text: "UN COMENTARIO PRIVADO LARGO",
        value_numeric: null,
      },
    ],
    responseScales: [{ id: uuid(40), key: "satisfaccion" }],
    responseOptions: [
      {
        id: uuid(41),
        response_scale_id: uuid(40),
        raw_value: "5",
        numeric_value: 5,
        derived_label: "Muy satisfecho",
        display_order: 1,
      },
    ],
    instruments: [
      { id: uuid(50), key: "csat", label: "CSAT", audience: "activos", instrument_type: "survey" },
    ],
    domains: [
      {
        id: uuid(60),
        survey_instrument_id: uuid(50),
        key: "atencion",
        label: "Atención",
        display_order: 1,
        visual_annotation_id: uuid(99),
      },
      {
        id: uuid(61),
        survey_instrument_id: uuid(50),
        key: "otro",
        label: "Otro",
        display_order: 2,
        visual_annotation_id: null,
      },
    ],
    items: [
      {
        id: uuid(70),
        survey_instrument_id: uuid(50),
        study_domain_id: uuid(60),
        response_scale_id: uuid(40),
        key: "csat_a",
        label: "Punto A",
        item_order: 1,
      },
      {
        id: uuid(71),
        survey_instrument_id: uuid(50),
        study_domain_id: null,
        response_scale_id: null,
        key: "cri_d",
        label: "Razón",
        item_order: 2,
      },
    ],
    sessions: [{ id: uuid(80), survey_instrument_id: uuid(50), participant_id: uuid(10), status: "answered" }],
    responses: [
      {
        id: uuid(90),
        survey_session_id: uuid(80),
        survey_item_id: uuid(70),
        response_option_id: uuid(41),
        status: "answered",
        value_numeric: null,
        value_text: null,
        source_derived_label: "Muy satisfecho",
      },
      {
        id: uuid(91),
        survey_session_id: uuid(80),
        survey_item_id: uuid(71),
        response_option_id: null,
        status: "answered",
        value_numeric: null,
        value_text: "Sí, definitivamente",
        source_derived_label: null,
      },
    ],
    retentionPeriods: [],
    performanceDimensions: [{ id: uuid(100), key: "desempeno_mensual", label: "Desempeño", display_order: 1 }],
    performanceObservations: [
      {
        id: uuid(101),
        participant_id: uuid(10),
        performance_dimension_id: uuid(100),
        period_start: "2026-01-01",
        period_label: "Enero",
        status: "answered",
        value: "12.5",
      },
    ],
    bandSchemes: [{ id: uuid(110), key: "csat_banda", label: "CSAT", unit: "percent", description: "" }],
    bandRules: [
      {
        id: uuid(111),
        band_scheme_id: uuid(110),
        lower_bound: "80",
        upper_bound: null,
        lower_inclusive: true,
        upper_inclusive: true,
        label: "Alto",
        semantic_color: "green",
        display_order: 2,
      },
      {
        id: uuid(112),
        band_scheme_id: uuid(110),
        lower_bound: null,
        upper_bound: "79.9",
        lower_inclusive: true,
        upper_inclusive: true,
        label: "Bajo",
        semantic_color: "red",
        display_order: 1,
      },
    ],
    metricDefinitions: [
      {
        id: uuid(120),
        key: "csat_global",
        label: "CSAT",
        family: "csat",
        unit: "percent",
        precision: 1,
        calculation_version: "catalogo-2026-08-19",
        band_scheme_id: uuid(110),
      },
    ],
    journeyModels: [{ id: uuid(130), key: "bni", label: "BNI", audience: "miembros", display_order: 1 }],
    journeyStages: [
      { id: uuid(131), journey_model_id: uuid(130), key: "ingreso", label: "Ingreso", stage_order: 1 },
    ],
    journeyStageEvidenceLinks: [],
    organizationalUnits: [{ id: uuid(140), key: "capitanes", label: "Capitanes", display_order: 1 }],
    cultureDimensions: [{ id: uuid(150), key: "confianza", label: "Confianza", audience: "edl", display_order: 1 }],
    painPoints: [{ id: uuid(160), review_status: "pending", created_at: "2026-09-06T00:00:00Z" }],
    painPointJourneyStages: [{ pain_point_id: uuid(160), journey_stage_id: uuid(131), display_order: 0 }],
    painPointOrganizationalUnits: [{ pain_point_id: uuid(160), organizational_unit_id: uuid(140), display_order: 0 }],
    painPointPerformanceDimensions: [],
    painPointCultureDimensions: [{ pain_point_id: uuid(160), culture_dimension_id: uuid(150), display_order: 0 }],
    ...overrides,
  };
}

const options = { spec: CUICUILCO_RESULTS_V1, tenantId: TENANT, studyId: STUDY };
const assembled = canonicalResultSourceFromRows(handWrittenRows(), options);

check("una definición privada se cae entera, con todos sus valores", () => {
  assert.equal(assembled.attributeDefinitions.length, 2);
  assert.ok(!assembled.attributeDefinitions.some((row) => row.key === "perfil_cliente_marca_temporal"));
  assert.ok(!assembled.attributeValues.some((row) => row.attributeKey === "perfil_cliente_marca_temporal"));
});
check("un atributo de la lista permitida conserva su texto", () => {
  const value = assembled.attributeValues.find((row) => row.attributeKey === "perfil_cliente_genero");
  assert.equal(value.text, "Femenino");
});
check("un atributo fuera de la lista permitida pierde sus palabras", () => {
  const value = assembled.attributeValues.find((row) => row.attributeKey === "otro_campo_libre");
  assert.equal(value.status, "answered");
  assert.equal(value.text, null);
});
check("un ítem codificado conserva su categoría", () => {
  const answer = assembled.answers.find((row) => row.itemKey === "cri_d");
  assert.equal(answer.text, "Sí, definitivamente");
});
check("un ítem no codificado pierde sus palabras y conserva su número", () => {
  const answer = assembled.answers.find((row) => row.itemKey === "csat_a");
  assert.equal(answer.text, null);
  assert.equal(answer.numeric, 5);
  assert.equal(answer.optionRawValue, "5");
  assert.equal(answer.derivedLabel, "Muy satisfecho");
});
check("el número se resuelve desde la opción de escala cuando la respuesta no lo lleva", () => {
  assert.equal(assembled.answers.find((row) => row.itemKey === "csat_a").numeric, 5);
});
check("un numeric que llega como texto se convierte una sola vez", () => {
  assert.equal(assembled.performanceObservations[0].value, 12.5);
  assert.equal(assembled.bandSchemes[0].rules[0].upperBound, 79.9);
});
check("un dominio con anotación visual queda marcado como agrupado por rango combinado", () => {
  assert.equal(assembled.domains.find((row) => row.key === "atencion").groupedByMergedRange, true);
  assert.equal(assembled.domains.find((row) => row.key === "otro").groupedByMergedRange, false);
});
check("las reglas de banda salen en orden de presentación", () => {
  assert.deepEqual(assembled.bandSchemes[0].rules.map((rule) => rule.label), ["Bajo", "Alto"]);
});
check("un hallazgo curado viaja con sus vínculos y sin su prosa", () => {
  assert.equal(assembled.curatedFindings.length, 1);
  assert.deepEqual(assembled.curatedFindings[0], {
    reviewStatus: "pending",
    journeyStageKeys: ["ingreso"],
    organizationalUnitKeys: ["capitanes"],
    performanceDimensionKeys: [],
    cultureDimensionKeys: ["confianza"],
  });
});
check("la identidad cita el paquete, la huella y el alcance", () => {
  assert.equal(assembled.identity.tenantId, TENANT);
  assert.equal(assembled.identity.studyId, STUDY);
  assert.equal(assembled.identity.packageIdempotencyKey, KEY_A);
  assert.equal(assembled.identity.specId, "cuicuilco");
  assert.equal(assembled.identity.calculationVersion, CUICUILCO_RESULTS_V1.calculationVersion);
});
check("una especificación distinta es un rechazo", () => {
  assert.throws(
    () => canonicalResultSourceFromRows(handWrittenRows({ specId: "otro" }), options),
    (error) => error.code === "SPEC_ID_MISMATCH",
  );
});
check("una versión de mapeo distinta es un rechazo", () => {
  const rows = handWrittenRows();
  rows.importJob = { ...rows.importJob, mapping_version: 9 };
  assert.throws(
    () => canonicalResultSourceFromRows(rows, options),
    (error) => error.code === "MAPPING_VERSION_MISMATCH",
  );
});
check("un hallazgo `merged` se nombra en vez de resolverse en silencio", () => {
  assert.throws(
    () =>
      canonicalResultSourceFromRows(
        handWrittenRows({ painPoints: [{ id: uuid(160), review_status: "merged", created_at: "2026-09-06T00:00:00Z" }] }),
        options,
      ),
    (error) => error.code === "CURATED_FINDING_MERGED_UNSUPPORTED",
  );
});
check("ningún valor privado del origen aparece en el modelo de lectura", () => {
  const serialized = JSON.stringify(assembled);
  for (const value of ["2026-01-02 11:04:59", "UN COMENTARIO PRIVADO LARGO"]) {
    assert.ok(!serialized.includes(value), value.slice(0, 12));
  }
});
check("el modelo de lectura no tiene siquiera un lugar donde poner una persona", () => {
  assert.ok(!("persons" in assembled));
  assert.ok(!("personIdentifiers" in assembled));
  assert.ok(!("sourceLineage" in assembled));
});

// ===========================================================================
console.log("\n[7] El orden compartido de comparación");
check("normalizar es idempotente", () => {
  assert.deepEqual(normalizeCanonicalResultSource(assembled), assembled);
});
check("el orden de llegada de las filas no cambia el modelo de lectura", () => {
  const shuffled = handWrittenRows();
  for (const family of ["participants", "attributeValues", "responses", "items", "bandRules"]) {
    shuffled[family] = shuffled[family].slice().reverse();
  }
  assert.deepEqual(canonicalResultSourceFromRows(shuffled, options), assembled);
});
check("y los vínculos de un hallazgo se ordenan, vengan como vengan", () => {
  const rows = handWrittenRows({
    journeyStages: [
      { id: uuid(131), journey_model_id: uuid(130), key: "ingreso", label: "Ingreso", stage_order: 1 },
      { id: uuid(132), journey_model_id: uuid(130), key: "adopcion", label: "Adopción", stage_order: 2 },
    ],
    painPointJourneyStages: [
      { pain_point_id: uuid(160), journey_stage_id: uuid(132), display_order: 1 },
      { pain_point_id: uuid(160), journey_stage_id: uuid(131), display_order: 0 },
    ],
  });
  const built = canonicalResultSourceFromRows(rows, options);
  assert.deepEqual(built.curatedFindings[0].journeyStageKeys, ["adopcion", "ingreso"]);
});

// ===========================================================================
console.log("\n[8] La frontera: qué puede y qué no puede importar cada módulo");
{
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const folder = join("src", "lib", "canonical-source");
  const files = readdirSync(folder).filter((name) => name.endsWith(".ts"));
  const read = (name) => stripComments(readFileSync(join(folder, name), "utf8"));

  check("el adaptador y su punto de entrada son server-only, y sólo ellos", () => {
    const serverOnly = files.filter((name) => /^\s*import\s+["']server-only["']/m.test(read(name)));
    assert.deepEqual(serverOnly.sort(), ["adapter.ts", "server.ts"]);
  });
  check("sólo el adaptador nombra un cliente de Supabase", () => {
    const clients = files.filter((name) => /@supabase\/supabase-js/.test(read(name)));
    assert.deepEqual(clients, ["adapter.ts"]);
  });
  check("ningún módulo puro alcanza la red, el disco o el entorno", () => {
    const pure = files.filter((name) => !["adapter.ts", "server.ts"].includes(name));
    const reaching = pure.filter((name) => /\bfetch\(|node:|process\.env|createClient\(/.test(read(name)));
    assert.deepEqual(reaching, []);
  });
  check("el barril seguro no reexporta el adaptador", () => {
    assert.ok(!/from\s+["']\.\/adapter["']/.test(read("index.ts")));
    assert.ok(/from\s+["']\.\/adapter["']/.test(read("server.ts")));
  });
  check("el modelo de resultados sigue libre de transporte y de server-only", () => {
    const walk = (dir) => {
      const out = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (/\.tsx?$/.test(entry)) out.push(full);
      }
      return out;
    };
    for (const path of walk(join("src", "lib", "results"))) {
      const code = stripComments(readFileSync(path, "utf8"));
      assert.ok(!/@supabase|createClient\(|\.rpc\(|\bfetch\(|node:|process\.env/.test(code), path);
      assert.ok(!/^\s*import\s+["']server-only["']/m.test(code), path);
    }
  });
  check("ningún componente ni ruta importa el adaptador de base de datos", () => {
    const walk = (dir) => {
      const out = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (/\.tsx?$/.test(entry)) out.push(full);
      }
      return out;
    };
    const browser = [...walk(join("src", "components")), ...walk(join("src", "app"))];
    const importers = browser.filter((path) => /canonical-source/.test(readFileSync(path, "utf8")));
    assert.deepEqual(importers, []);
  });
  check("no existe ninguna ruta HTTP que importe el camino de escritura o de lectura canónico", () => {
    const walk = (dir) => {
      const out = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (/\.tsx?$/.test(entry)) out.push(full);
      }
      return out;
    };
    const routes = walk(join("src", "app")).filter((path) => /route\.tsx?$/.test(path));
    const importers = routes.filter((path) =>
      /canonical-source|canonical-commit\/(server|adapter)/.test(readFileSync(path, "utf8")),
    );
    assert.deepEqual(importers, []);
  });
}

// ===========================================================================
console.log("\n[9] El operador no borra filas a mano");
{
  const operator = readFileSync(join("scripts", "canonical-import-operator.mjs"), "utf8");
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const code = stripComments(operator);
  check("no llama a `.delete(` en ninguna tabla", () => {
    assert.ok(!/\.delete\(/.test(code));
  });
  check("no emite SQL de borrado", () => {
    assert.ok(!/\bdelete\s+from\b/i.test(code));
  });
  check("revierte por la RPC del producto", () => {
    assert.ok(/runCanonicalRollback/.test(code));
    assert.ok(/rollback_canonical_package|runCanonicalRollback/.test(code));
  });
  check("por omisión no ejecuta nada", () => {
    assert.ok(/if \(!target\.execute\)/.test(code));
  });
  check("no construye ningún endpoint HTTP", () => {
    assert.ok(!/createServer|express|new Response\(/.test(code));
  });
}

// ===========================================================================
// Unit 5 Phase 3.1 — cancellation and bounded concurrency.
//
// Phase 3's budget was a `Promise.race`: it bounded the CALLER and nothing
// else, so a read that lost the race stayed in flight — socket open, next page
// still to be asked for — long after the request that wanted it had answered.
// These checks are about the other half: the read must actually stop.
// ===========================================================================
console.log("\n[10] La cancelación llega hasta la paginación");

const FULL_READ = { table: "big", columns: ["id"], keyColumns: ["id"], maxRows: 10_000 };
const READ_SCOPE = { tenantId: TENANT, studyId: STUDY };
/** A page that is exactly `limit` long, so the reader always asks for another. */
const fullPage = (offset, limit) =>
  Array.from({ length: limit }, (_, index) => ({ id: uuid(offset + index + 1) }));

await checkAsync("cada página lleva la señal hasta el transporte", async () => {
  const controller = new AbortController();
  const seen = [];
  const transport = {
    readPage: async (request) => {
      seen.push(request.signal);
      return { rows: [{ id: uuid(1) }], error: null };
    },
  };
  await readCanonicalTable(transport, FULL_READ, READ_SCOPE, undefined, controller.signal);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], controller.signal, "the request did not carry the caller's signal");
});

await checkAsync("una lectura ya cancelada no pide ni una página", async () => {
  const controller = new AbortController();
  controller.abort();
  let pages = 0;
  const transport = {
    readPage: async () => {
      pages += 1;
      return { rows: [], error: null };
    },
  };
  await assert.rejects(
    () => readCanonicalTable(transport, FULL_READ, READ_SCOPE, undefined, controller.signal),
    (error) => error instanceof CanonicalReadError && error.code === "READ_ABORTED",
  );
  assert.equal(pages, 0, "a page was requested after the signal had already aborted");
});

await checkAsync("ninguna página NUEVA empieza después de la cancelación", async () => {
  // The loop-head check. Page one completes and would normally be followed by
  // page two; the abort lands in between, and page two must never be asked for.
  const controller = new AbortController();
  let pages = 0;
  const transport = {
    readPage: async (request) => {
      pages += 1;
      const rows = fullPage((pages - 1) * request.limit, request.limit);
      controller.abort();
      return { rows, error: null };
    },
  };
  await assert.rejects(
    () => readCanonicalTable(transport, FULL_READ, READ_SCOPE, undefined, controller.signal),
    (error) => error.code === "READ_ABORTED",
  );
  assert.equal(pages, 1, `${pages} pages were read after the abort`);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(pages, 1, "a page began in the background after the read had already refused");
});

await checkAsync("una página EN VUELO cancelada se reporta como cancelación, no como transporte", async () => {
  // An aborted `fetch` rejects with a message PostgREST wrapped, and this module
  // may not repeat a database message. The signal is the reliable witness, so
  // it decides the code and the thrown value is discarded.
  const controller = new AbortController();
  let pages = 0;
  const transport = {
    readPage: (request) => {
      pages += 1;
      if (pages === 1) return Promise.resolve({ rows: fullPage(0, request.limit), error: null });
      controller.abort();
      return new Promise((_resolve, reject) => {
        const fail = () => reject(new Error('FetchError: aborted while reading "Juan Pérez"'));
        if (request.signal.aborted) fail();
        else request.signal.addEventListener("abort", fail);
      });
    },
  };
  await assert.rejects(
    () => readCanonicalTable(transport, FULL_READ, READ_SCOPE, undefined, controller.signal),
    (error) => error.code === "READ_ABORTED" && !/Juan|FetchError/.test(error.message),
  );
  assert.equal(pages, 2);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(pages, 2, "a third page began after the abort");
});

await checkAsync("la carga completa de un paquete se cancela entera", async () => {
  const controller = new AbortController();
  const { transport, requests } = fakeTransport({ import_job: [manifestJob(uuid(1), KEY_A)] });
  controller.abort();
  await assert.rejects(
    () => loadCanonicalRowSet(transport, { tenantId: TENANT, studyId: STUDY, signal: controller.signal }),
    (error) => error.code === "READ_ABORTED",
  );
  assert.equal(requests.length, 0, "the committed-package gate ran under an aborted signal");
});

// ===========================================================================
console.log("\n[11] La concurrencia acotada, y lo que no le cuesta");

check("el límite es el que la plataforma permite abrir a la vez", () => {
  assert.equal(CANONICAL_READ_CONCURRENCY, 6);
});

await checkAsync("nunca hay más tareas en vuelo que el límite", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 40 }, (_, index) => index);
  const results = await mapBounded(items, 6, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    return item * 2;
  });
  assert.equal(peak, 6, `peak concurrency was ${peak}`);
  assert.equal(results.length, 40);
});

await checkAsync("el ORDEN de salida es el de entrada, no el de llegada", async () => {
  // The reads finish in reverse order on purpose. A pool that pushed results as
  // they arrived would pass every other check in this file and silently
  // reorder every family in the row set.
  const items = Array.from({ length: 12 }, (_, index) => index);
  const results = await mapBounded(items, 4, async (item) => {
    await new Promise((resolve) => setTimeout(resolve, (12 - item) * 2));
    return `row-${item}`;
  });
  assert.deepEqual(results, items.map((item) => `row-${item}`));
});

await checkAsync("un fallo detiene el trabajo nuevo y devuelve el de índice MÁS BAJO", async () => {
  // Two failures in one run must report the same refusal every time, or a gate
  // that asserts on the code becomes a coin toss.
  const started = [];
  await assert.rejects(
    () =>
      mapBounded(Array.from({ length: 20 }, (_, index) => index), 4, async (item) => {
        started.push(item);
        await new Promise((resolve) => setTimeout(resolve, item === 1 ? 6 : 1));
        if (item === 1) throw new CanonicalReadError("READ_EXCEEDS_CEILING", "one");
        if (item === 3) throw new CanonicalReadError("READ_NOT_ORDERED", "three");
        return item;
      }),
    (error) => error.code === "READ_EXCEEDS_CEILING",
  );
  assert.ok(started.length < 20, `every task started despite a refusal (${started.length})`);
});

await checkAsync("un límite que no es un entero positivo es un rechazo, no cero obreros", async () => {
  // `Math.max(1, Math.min(NaN, n))` is NaN, which produces ZERO workers and an
  // array of holes — an empty study that looks like a complete read.
  for (const bad of [0, -1, Number.NaN, 1.5, "6", null]) {
    await assert.rejects(
      () => mapBounded([1, 2, 3], bad, async (item) => item),
      (error) => error.code === "READ_CONCURRENCY_INVALID",
      `limit ${String(bad)} was accepted`,
    );
  }
});

await checkAsync("una señal ya cancelada detiene el conjunto antes de empezar", async () => {
  const controller = new AbortController();
  controller.abort();
  let ran = 0;
  await assert.rejects(
    () =>
      mapBounded(
        [1, 2, 3],
        2,
        async (item) => {
          ran += 1;
          return item;
        },
        controller.signal,
      ),
    (error) => error.code === "READ_ABORTED",
  );
  assert.equal(ran, 0);
});

await checkAsync("la lectura concurrente produce EXACTAMENTE el mismo conjunto de filas", async () => {
  // The families are read through a pool now. If any of the twenty-six ended up
  // in the wrong slot, or if the arrival order leaked into an array, this is
  // where it shows: two runs of the same package must be byte-identical, and
  // the request count must still be one gate plus twenty-six families.
  const tables = {
    import_job: [manifestJob(uuid(1), KEY_A)],
    study_participant: scoped(
      Array.from({ length: 7 }, (_, index) => ({
        id: uuid(100 + index),
        cohort_key: "activos",
        participation_status: "included",
        survey_participation_status: "responded",
        source_status: "present",
      })),
    ),
    metric_definition: scoped(
      Array.from({ length: 5 }, (_, index) => ({
        id: uuid(200 + index),
        key: `m${index}`,
        label: `M${index}`,
        family: "satisfaction",
        unit: "percent",
        precision: 1,
        calculation_version: "catalogo-2026-08-19",
        band_scheme_id: null,
      })),
    ),
  };
  const first = fakeTransport(tables);
  const second = fakeTransport(tables);
  const a = await loadCanonicalRowSet(first.transport, { tenantId: TENANT, studyId: STUDY });
  const b = await loadCanonicalRowSet(second.transport, { tenantId: TENANT, studyId: STUDY });
  assert.equal(JSON.stringify(a), JSON.stringify(b), "two identical reads disagreed");
  assert.deepEqual(
    a.participants.map((row) => row.id),
    Array.from({ length: 7 }, (_, index) => uuid(100 + index)),
    "the keyset order inside a family was not preserved",
  );
  assert.equal(a.metricDefinitions.length, 5);
  assert.equal(first.requests.length, 27, `${first.requests.length} requests for 1 gate + 26 families`);
  // BOUNDED, end to end, and by the MODULE'S constant rather than by a number
  // this test chose: replacing `CANONICAL_READ_CONCURRENCY` with
  // `FAMILIES.length` at the call site fails here.
  assert.ok(
    first.inFlight.peak <= CANONICAL_READ_CONCURRENCY,
    `peak concurrency ${first.inFlight.peak} exceeded ${CANONICAL_READ_CONCURRENCY}`,
  );
  assert.equal(first.inFlight.peak, CANONICAL_READ_CONCURRENCY, "the families were not read concurrently at all");
  assert.equal(first.inFlight.now, 0, "a read was still in flight when the row set was returned");
  // And the committed-package gate ran ALONE. Its manifest names the spec every
  // family is interpreted under, so nothing may overlap it — the first four
  // timeline entries are its start, its end, and only then a family's start.
  assert.deepEqual(first.timeline.slice(0, 2), ["start:import_job", "end:import_job"]);
  // Every request still carries BOTH halves of the scope. The pool decides WHEN
  // a request is issued and never touches WHAT it asks for.
  for (const request of first.requests) {
    assert.equal(request.scope.tenantId, TENANT);
    assert.equal(request.scope.studyId, STUDY);
  }
  // And the committed-package gate is still first and still alone.
  assert.equal(first.requests[0].table, "import_job");
  assert.equal(first.requests[0].equals.status, "committed");
});

console.log("\n" + "=".repeat(78));
console.log(`RESUMEN: ${passed + failed} comprobaciones, ${passed} aprobadas, ${failed} falladas.`);
if (failed > 0) {
  console.error("RESULTADO: el adaptador de base de datos NO cumple su contrato. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: el adaptador lee por páginas probadas, rechaza en vez de truncar, respeta el alcance " +
    "por cliente y estudio, redacta lo que no debe cruzar y mantiene el transporte fuera del cálculo.",
);
