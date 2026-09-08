// =============================================================================
// The SERVER-SIDE SHADOW BOUNDARY — offline gate
//   npm run test:shadow-boundary            (part of `npm test`)
// =============================================================================
// It runs everywhere and needs nothing: no database, no network, no workbook,
// no credential. It proves the three properties Unit 5 Phase 3 exists to give:
//
//   1. THE LEGACY RESPONSE NEVER CHANGES. Whatever the shadow does — refuse,
//      time out, fail at the transport, come back malformed, or disagree — the
//      payload the page renders is deep-equal to the payload the same inputs
//      produced before the shadow existed.
//   2. THE CANONICAL ADAPTER IS NEVER CALLED UNLESS BOTH GATES OPEN. The flag
//      and the exact tenant/study allowlist are counted, not argued about: the
//      fake reader records its invocations.
//   3. NOTHING CROSSES THE CLIENT BOUNDARY. The diagnostic contract has no
//      field for a respondent, a name, an answer or a message; no page,
//      component or route names the diagnostics; and no client component can
//      reach the canonical layer through ANY chain of imports.
//
// THE CANONICAL DOCUMENT USED HERE IS HAND-WRITTEN, on purpose — a comparator
// test that built its input with the results builder would agree with itself.
// One check anchors the stub to reality by running the REAL builder over an
// empty source and asserting the same shape passes the same validator.
// =============================================================================

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

import { buildStudyDashboard } from "../src/lib/dashboard/view.ts";
import {
  COMPARISON_RULES,
  COMPATIBILITY_CLASSIFICATIONS,
  MISMATCH_KINDS,
  NOTE_CODES,
  SHADOW_FINDING_KEYS,
  SHADOW_SECTIONS,
  SHADOW_STATUSES,
  compareLegacyWithCanonical,
  decimalsRule,
  describeFilterScope,
  parseLegacyBase,
  parseLegacyNumber,
  parseShadowBudget,
  parseShadowScopes,
  resolveShadowPolicy,
  runShadowComparison,
  runtimeShadowRecord,
  safeDimensionKeys,
  DEFAULT_SHADOW_BUDGET_MS,
  MAX_SHADOW_BUDGET_MS,
  SHADOW_ENABLED_LITERAL,
  ENV_SHADOW_MODE,
  ENV_SHADOW_SCOPES,
  ENV_SHADOW_BUDGET_MS,
} from "../src/lib/shadow/index.ts";
import { buildCanonicalStudyResults, emptyResultSource, CUICUILCO_RESULTS_V1 } from "../src/lib/results/index.ts";

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
const OTHER_STUDY = "44444444-4444-4444-8444-444444444444";
const SCOPE = { tenantId: TENANT, studyId: STUDY };
const ENABLED = {
  [ENV_SHADOW_MODE]: SHADOW_ENABLED_LITERAL,
  [ENV_SHADOW_SCOPES]: `${TENANT}:${STUDY}`,
};

console.log("Be Community — frontera de la comparación en sombra (offline)");
console.log("=".repeat(78));

// ---------------------------------------------------------------------------
// The legacy payload, built by the REAL builder from synthetic rows whose
// identifiers are sentinels: if one ever reaches a diagnostic, the privacy
// check below names it.
// ---------------------------------------------------------------------------
const legacyRows = [
  ...Array.from({ length: 20 }, (_, index) => ({
    respondent_id: `secret-person-${index + 1}`,
    metric_key: "nps",
    value: index < 12 ? 10 : index < 16 ? 8 : 3,
    esfera: index % 2 === 0 ? "Norte" : "Sur",
  })),
  ...Array.from({ length: 20 }, (_, index) => ({
    respondent_id: `secret-person-${index + 1}`,
    metric_key: "cri",
    value: index < 10 ? 25 : 50,
    esfera: index % 2 === 0 ? "Norte" : "Sur",
  })),
  ...Array.from({ length: 20 }, (_, index) => ({
    respondent_id: `secret-person-${index + 1}`,
    metric_key: "csat_atencion",
    value: 4,
    esfera: index % 2 === 0 ? "Norte" : "Sur",
  })),
  ...Array.from({ length: 20 }, (_, index) => ({
    respondent_id: `secret-person-${index + 1}`,
    metric_key: "tdp_atencion",
    value: index === 0 ? 100 : 0,
    esfera: index % 2 === 0 ? "Norte" : "Sur",
  })),
];
const legacyQualitative = Array.from({ length: 3 }, (_, index) => ({
  id: `secret-observation-${index + 1}`,
  respondent_id: `secret-person-${index + 1}`,
  theme: "acompanamiento",
  stage_key: "inicio",
  quote: index === 0 ? "Una cita aprobada que nadie debe copiar a un diagnostico" : null,
  source: "encuesta",
  category: null,
  esfera: "Norte",
}));
const legacyStages = [{ id: "inicio", label: "Inicio", metric: "nps" }];
const buildLegacy = (filters = {}) =>
  buildStudyDashboard(legacyRows, legacyQualitative, legacyStages, filters, {});

const LEGACY = buildLegacy();
const LEGACY_SERIALIZED = JSON.stringify(LEGACY);

// ---------------------------------------------------------------------------
// A hand-written canonical document. The numbers agree with the legacy rows
// above by construction, so any disagreement a test produces is the one the
// test introduced.
// ---------------------------------------------------------------------------
const npsScope = (key, value, valid) => ({
  key,
  label: key,
  score: {
    key: `nps_${key}`,
    label: "NPS",
    base: { eligible: valid, responded: valid, valid, accounting: {} },
    provenance: { calculationVersion: "catalogo-2026-08-19" },
    status: "available",
    value: { value, unit: "score", band: null },
  },
  distribution: { promoters: 12, passives: 4, detractors: 4 },
  distributionShare: { promoters: null, passives: null, detractors: null },
  scale: { min: 1, max: 10 },
});

function canonicalDocument(overrides = {}) {
  const base = {
    contractVersion: "2.0.0",
    study: {
      specId: "cuicuilco",
      mappingVersion: 1,
      calculationVersion: "catalogo-2026-08-19",
      tenantId: TENANT,
      studyId: STUDY,
      packageIdempotencyKey: `sha256:${"b".repeat(64)}`,
      planFingerprint: `sha256:${"a".repeat(64)}`,
    },
    period: { label: null, dataCutoff: null },
    population: { total: 20, measured: 20, cohorts: [], instruments: [], provenance: {} },
    filters: {
      dimensions: [
        { key: "perfil_cliente_h", label: "Esfera", dataType: "category", values: [], absent: [],
          forbiddenSections: [{ section: "renewal", authorityId: "methodology-5-2-esfera-cri" }] },
      ],
      applied: [],
      participants: 20,
    },
    recommendation: { scopes: [npsScope("combinado", 40, 20), npsScope("activos", 40, 20)] },
    renewal: {
      index: {
        key: "cri",
        label: "CRI",
        base: { eligible: 20, responded: 20, valid: 20, accounting: {} },
        provenance: {},
        status: "available",
        value: { value: 37.5, unit: "index", band: null },
      },
      distribution: null,
      base: { eligible: 20, responded: 20, valid: 20, accounting: {} },
    },
    retention: { periods: [] },
    journey: { touchpoints: [], groups: [], excluded: [], stageEvidence: { status: "requires_explicit_configuration", links: [] } },
    performance: { dimensions: [] },
    qualitative: { groups: [], curatedFindingCounts: [] },
    unresolved: [],
    configurationRequired: [{ key: "curated_journey_pain_cloud", section: "qualitative", kind: "editorial_review" }],
  };
  return { ...base, ...overrides };
}

const CANONICAL = canonicalDocument();

// ===========================================================================
console.log("\n[1] La bandera y la lista blanca");
check("una bandera ausente deja la sombra apagada", () => {
  assert.deepEqual(resolveShadowPolicy({}, SCOPE), {
    allowed: false,
    reason: "disabled_by_flag",
    budgetMs: DEFAULT_SHADOW_BUDGET_MS,
  });
});
check("y ningún valor «verdadero» la enciende salvo el literal exacto", () => {
  for (const value of ["true", "1", "yes", "on", "ENABLED", "enabled ", "sí"]) {
    const policy = resolveShadowPolicy({ [ENV_SHADOW_MODE]: value, [ENV_SHADOW_SCOPES]: `${TENANT}:${STUDY}` }, SCOPE);
    assert.equal(policy.allowed, false, value);
    assert.equal(policy.reason, "disabled_by_flag", value);
  }
});
check("con la bandera encendida pero sin lista blanca, se rechaza", () => {
  const policy = resolveShadowPolicy({ [ENV_SHADOW_MODE]: SHADOW_ENABLED_LITERAL }, SCOPE);
  assert.equal(policy.allowed, false);
  assert.equal(policy.reason, "scope_not_allowlisted");
});
check("el alcance exacto autorizado se permite", () => {
  assert.equal(resolveShadowPolicy(ENABLED, SCOPE).allowed, true);
});
check("un cliente distinto se rechaza", () => {
  const policy = resolveShadowPolicy(ENABLED, { tenantId: OTHER_TENANT, studyId: STUDY });
  assert.equal(policy.allowed, false);
  assert.equal(policy.reason, "scope_not_allowlisted");
});
check("un estudio distinto se rechaza", () => {
  const policy = resolveShadowPolicy(ENABLED, { tenantId: TENANT, studyId: OTHER_STUDY });
  assert.equal(policy.allowed, false);
  assert.equal(policy.reason, "scope_not_allowlisted");
});
check("un prefijo no es una identidad", () => {
  const policy = resolveShadowPolicy(
    { ...ENABLED, [ENV_SHADOW_SCOPES]: `${TENANT.slice(0, 8)}:${STUDY.slice(0, 8)}` },
    SCOPE,
  );
  assert.equal(policy.allowed, false);
});
check("una entrada malformada de la lista se descarta, no se repara", () => {
  assert.deepEqual(parseShadowScopes(`${TENANT}`), []);
  assert.deepEqual(parseShadowScopes(`${TENANT}:${STUDY}:extra`), []);
  assert.deepEqual(parseShadowScopes(`no-es-uuid:${STUDY}`), []);
  assert.deepEqual(parseShadowScopes(`${TENANT}:${STUDY}, ${TENANT}:${STUDY}`), [{ tenantId: TENANT, studyId: STUDY }]);
});
check("el presupuesto tiene valor por omisión y techo", () => {
  assert.equal(parseShadowBudget(undefined), DEFAULT_SHADOW_BUDGET_MS);
  assert.equal(parseShadowBudget("0"), DEFAULT_SHADOW_BUDGET_MS);
  assert.equal(parseShadowBudget("-5"), DEFAULT_SHADOW_BUDGET_MS);
  assert.equal(parseShadowBudget("abc"), DEFAULT_SHADOW_BUDGET_MS);
  assert.equal(parseShadowBudget("250"), 250);
  assert.equal(parseShadowBudget(String(MAX_SHADOW_BUDGET_MS * 10)), MAX_SHADOW_BUDGET_MS);
});

// ===========================================================================
console.log("\n[2] Con la sombra apagada o fuera de alcance, el adaptador NO se llama");
function countingReader(result) {
  let calls = 0;
  return {
    calls: () => calls,
    reader: async () => {
      calls += 1;
      return typeof result === "function" ? result() : result;
    },
  };
}

await checkAsync("bandera apagada: cero llamadas y estado nombrado", async () => {
  const { reader, calls } = countingReader(CANONICAL);
  const shadow = await runShadowComparison({ scope: SCOPE, legacy: LEGACY, filters: {}, env: {}, loadCanonical: reader });
  assert.equal(calls(), 0);
  assert.equal(shadow.status, "disabled_by_flag");
  assert.deepEqual(shadow.findings, []);
  assert.equal(shadow.elapsedMs, 0);
});
await checkAsync("fuera de la lista blanca: cero llamadas y estado nombrado", async () => {
  const { reader, calls } = countingReader(CANONICAL);
  const shadow = await runShadowComparison({
    scope: { tenantId: OTHER_TENANT, studyId: OTHER_STUDY },
    legacy: LEGACY,
    filters: {},
    env: ENABLED,
    loadCanonical: reader,
  });
  assert.equal(calls(), 0);
  assert.equal(shadow.status, "scope_not_allowlisted");
});
await checkAsync("alcance autorizado: exactamente UNA llamada", async () => {
  const { reader, calls } = countingReader(CANONICAL);
  const shadow = await runShadowComparison({ scope: SCOPE, legacy: LEGACY, filters: {}, env: ENABLED, loadCanonical: reader });
  assert.equal(calls(), 1);
  assert.equal(shadow.status, "compared");
});

// ===========================================================================
console.log("\n[3] Ningún fallo canónico cambia la respuesta heredada");
const failureCases = [
  ["un tiempo agotado", () => new Promise(() => {}), "canonical_timeout", { [ENV_SHADOW_BUDGET_MS]: "40" }],
  ["un fallo de transporte", () => Promise.reject(new Error('duplicate key "Juan Pérez"')), "canonical_transport_error", {}],
  ["un documento malformado", () => Promise.resolve({ nope: true }), "canonical_malformed", {}],
  ["un documento nulo", () => Promise.resolve(null), "canonical_malformed", {}],
  ["un documento sin población", () => Promise.resolve({ ...CANONICAL, population: null }), "canonical_malformed", {}],
];
for (const [label, produce, expected, extraEnv] of failureCases) {
  await checkAsync(`${label} se reporta como '${expected}' y no toca el legado`, async () => {
    const shadow = await runShadowComparison({
      scope: SCOPE,
      legacy: LEGACY,
      filters: {},
      env: { ...ENABLED, ...extraEnv },
      loadCanonical: produce,
    });
    assert.equal(shadow.status, expected);
    assert.deepEqual(shadow.findings, []);
    assert.equal(JSON.stringify(LEGACY), LEGACY_SERIALIZED, "the legacy payload moved");
  });
}
await checkAsync("un mensaje de la base de datos NUNCA aparece en el diagnóstico", async () => {
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: {},
    env: ENABLED,
    loadCanonical: () => Promise.reject(new Error('violates unique constraint: "Juan Pérez" / secret-person-1')),
  });
  const serialized = JSON.stringify(shadow);
  assert.doesNotMatch(serialized, /Juan|secret-person|unique constraint/);
});
await checkAsync("un documento que LANZA al leerlo no escapa a la página", async () => {
  // The getter is installed after construction: a spread would have invoked it
  // and thrown inside the test's own fixture instead of inside the shadow.
  const hostile = canonicalDocument();
  Object.defineProperty(hostile, "recommendation", {
    get() {
      throw new Error("hostile getter reading secret-person-1");
    },
    configurable: true,
  });
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: {},
    env: ENABLED,
    loadCanonical: () => Promise.resolve(hostile),
  });
  assert.ok(["canonical_malformed", "comparator_error"].includes(shadow.status), shadow.status);
  assert.doesNotMatch(JSON.stringify(shadow), /hostile getter|secret-person/);
  assert.equal(JSON.stringify(LEGACY), LEGACY_SERIALIZED);
});
await checkAsync("y un comparador que lanza se reporta como 'comparator_error'", async () => {
  const hostile = canonicalDocument();
  // Survives the shape check (`filters.dimensions` is an array) and throws only
  // when the comparator walks it.
  hostile.filters.dimensions = [
    new Proxy({}, {
      get(_target, property) {
        if (property === "forbiddenSections") throw new Error("hostile dimension");
        return undefined;
      },
    }),
  ];
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: {},
    env: ENABLED,
    loadCanonical: () => Promise.resolve(hostile),
  });
  assert.equal(shadow.status, "comparator_error");
  assert.deepEqual(shadow.findings, []);
  assert.doesNotMatch(JSON.stringify(shadow), /hostile dimension/);
  assert.equal(JSON.stringify(LEGACY), LEGACY_SERIALIZED);
});
await checkAsync("el presupuesto acota de verdad el tiempo de pared", async () => {
  const started = Date.now();
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: {},
    env: { ...ENABLED, [ENV_SHADOW_BUDGET_MS]: "60" },
    loadCanonical: () => new Promise((resolveLate) => setTimeout(() => resolveLate(CANONICAL), 5000).unref?.()),
  });
  const elapsed = Date.now() - started;
  assert.equal(shadow.status, "canonical_timeout");
  assert.ok(elapsed < 2000, `the shadow took ${elapsed} ms for a 60 ms budget`);
  assert.equal(shadow.budgetMs, 60);
});

// ===========================================================================
console.log("\n[4] El pago heredado es idéntico, pase lo que pase");
await checkAsync("una comparación exitosa deja el legado intacto", async () => {
  const shadow = await runShadowComparison({ scope: SCOPE, legacy: LEGACY, filters: {}, env: ENABLED, loadCanonical: async () => CANONICAL });
  assert.equal(shadow.status, "compared");
  assert.equal(JSON.stringify(LEGACY), LEGACY_SERIALIZED);
});
await checkAsync("una discrepancia deja el legado intacto", async () => {
  const wrong = canonicalDocument({ recommendation: { scopes: [npsScope("combinado", 99, 20)] } });
  const shadow = await runShadowComparison({ scope: SCOPE, legacy: LEGACY, filters: {}, env: ENABLED, loadCanonical: async () => wrong });
  assert.equal(shadow.counts.disagreed > 0, true);
  assert.equal(JSON.stringify(LEGACY), LEGACY_SERIALIZED);
});
check("y el legado con y sin sombra es el MISMO objeto de siempre", () => {
  assert.equal(JSON.stringify(buildLegacy()), LEGACY_SERIALIZED);
});

// ===========================================================================
console.log("\n[5] El comparador es semántico");
const findingsOf = (document, filters = {}) =>
  compareLegacyWithCanonical(LEGACY, document, { filtered: Object.keys(filters).length > 0 });

check("compara el NPS por su nombre, no por su posición", () => {
  const findings = findingsOf(CANONICAL);
  const nps = findings.find((entry) => entry.key === "recommendation.nps.combinado.value");
  assert.equal(nps.agrees, true, JSON.stringify(nps));
  assert.equal(nps.legacyValue, 40);
  assert.equal(nps.canonicalValue, 40);
  assert.equal(nps.rule, "decimals:1");
});
check("una diferencia de VALOR se nombra como valor", () => {
  const findings = findingsOf(canonicalDocument({ recommendation: { scopes: [npsScope("combinado", 41.2, 20)] } }));
  const nps = findings.find((entry) => entry.key === "recommendation.nps.combinado.value");
  assert.equal(nps.agrees, false);
  assert.equal(nps.mismatch, "value");
});
check("una diferencia de DENOMINADOR se nombra como base", () => {
  const findings = findingsOf(canonicalDocument({ recommendation: { scopes: [npsScope("combinado", 40, 19)] } }));
  const base = findings.find((entry) => entry.key === "recommendation.nps.combinado.base");
  assert.equal(base.agrees, false);
  assert.equal(base.mismatch, "base");
  assert.equal(base.legacyValue, 20);
  assert.equal(base.canonicalValue, 19);
});
check("un cero medido y una ausencia no se confunden", () => {
  const unavailable = canonicalDocument({
    recommendation: {
      scopes: [{
        ...npsScope("combinado", 0, 0),
        score: {
          key: "nps_combinado", label: "NPS",
          base: { eligible: 0, responded: 0, valid: 0, accounting: {} },
          provenance: {}, status: "unavailable", reason: "empty_population", detail: "",
        },
      }],
    },
  });
  const absent = findingsOf(unavailable).find((entry) => entry.key === "recommendation.nps.combinado.value");
  assert.equal(absent.mismatch, "availability");
  assert.equal(absent.canonicalValue, null);

  const measuredZero = findingsOf(canonicalDocument({ recommendation: { scopes: [npsScope("combinado", 0, 20)] } }));
  const zero = measuredZero.find((entry) => entry.key === "recommendation.nps.combinado.value");
  assert.equal(zero.canonicalValue, 0);
  assert.notEqual(zero.mismatch, "availability");
});
check("el CRI compara el valor y la base a la precisión más gruesa", () => {
  const findings = findingsOf(CANONICAL);
  const value = findings.find((entry) => entry.key === "renewal.cri.value");
  assert.equal(value.agrees, true, JSON.stringify(value));
  assert.equal(value.rule, "decimals:1");
  const base = findings.find((entry) => entry.key === "renewal.cri.base");
  assert.equal(base.agrees, true);
  assert.equal(base.legacyValue, 20);
});
check("el cruce prohibido se reporta como hecho del contrato, no como fallo", () => {
  const forbidden = findingsOf(CANONICAL).find((entry) => entry.key === "renewal.forbidden_cross");
  assert.equal(forbidden.classification, "canonical_only");
  assert.equal(forbidden.mismatch, "forbidden_cross");
  assert.equal(forbidden.agrees, null);
});
check("un contexto FILTRADO no compara la población seleccionada", () => {
  const filtered = compareLegacyWithCanonical(LEGACY, CANONICAL, { filtered: true });
  const selected = filtered.find((entry) => entry.key === "population.selected");
  assert.equal(selected.classification, "presentation_configuration_required");
  assert.equal(selected.mismatch, "filter_scope");
  assert.equal(selected.agrees, null);
  // The study-wide measured count does NOT depend on the filter and is still
  // compared: it is the source total, not the selection.
  const measured = filtered.find((entry) => entry.key === "population.measured");
  assert.equal(measured.agrees, true);
});
check("un contexto SIN filtro sí la compara", () => {
  const selected = findingsOf(CANONICAL).find((entry) => entry.key === "population.selected");
  assert.equal(selected.agrees, true);
  assert.equal(selected.legacyValue, 20);
});
check("la población del estudio es una capacidad SÓLO canónica, no una discrepancia", () => {
  const total = findingsOf(CANONICAL).find((entry) => entry.key === "population.total");
  assert.equal(total.classification, "canonical_only");
  assert.equal(total.agrees, null);
  assert.equal(total.legacyValue, null);
  assert.equal(total.canonicalValue, 20);
});
check("los espacios de claves que necesitan configuración se agrupan y se nombran", () => {
  const findings = findingsOf(CANONICAL);
  const csat = findings.find((entry) => entry.key === "legacy.metric_keys.csat");
  const tdp = findings.find((entry) => entry.key === "legacy.metric_keys.tdp");
  assert.equal(csat.classification, "presentation_configuration_required");
  assert.equal(tdp.classification, "presentation_configuration_required");
  // The WARNING is a code now, not a sentence. `tdp_` averages to the canonical
  // unawareness share, NOT to `touchpoints[].tdp`; the code says so and
  // `docs/LEGACY_CANONICAL_COMPATIBILITY.md` §7 explains why in prose a person
  // can read. A field that could hold a sentence could hold a database message.
  assert.equal(tdp.noteCode, "canonical_counterpart_is_unaware_share_not_tdp");
  assert.equal(csat.noteCode, "canonical_counterpart_is_top_box_share");
  assert.equal(tdp.note, undefined, "the free-text note came back");
});
check("los cuatro cubos de claves se reportan SIEMPRE, incluso los vacíos", () => {
  // A bucket that appeared only when the data contained it would make the
  // finding SET depend on the data, and "24 findings" would stop being a
  // property anything could check.
  const keys = findingsOf(CANONICAL).map((entry) => entry.key);
  for (const bucket of ["csat", "tdp", "desempeno", "other"]) {
    assert.ok(keys.includes(`legacy.metric_keys.${bucket}`), bucket);
  }
  const desempeno = findingsOf(CANONICAL).find((entry) => entry.key === "legacy.metric_keys.desempeno");
  assert.equal(desempeno.legacyValue, 0, "the fixture publishes no desempeno average");
});
check("la supresión heredada se reporta como reemplazo canónico", () => {
  const suppression = findingsOf(CANONICAL).find((entry) => entry.key === "disclosure.small_sample_suppression");
  assert.equal(suppression.classification, "canonical_replacement");
  assert.equal(suppression.canonicalValue, 0);
});
check("cada hallazgo usa una clasificación y un tipo de discrepancia del contrato", () => {
  for (const item of findingsOf(CANONICAL)) {
    assert.ok(COMPATIBILITY_CLASSIFICATIONS.includes(item.classification), item.key);
    if (item.mismatch !== null) assert.ok(MISMATCH_KINDS.includes(item.mismatch), item.key);
  }
});
check("el orden de los hallazgos es determinista", () => {
  const a = findingsOf(CANONICAL).map((entry) => entry.key);
  const b = findingsOf(CANONICAL).map((entry) => entry.key);
  assert.deepEqual(a, b);
  assert.deepEqual(a, [...a].sort());
  assert.equal(new Set(a).size, a.length, "two findings share a key");
});
check("un valor heredado ilegible se reporta, nunca se adivina", () => {
  assert.equal(parseLegacyNumber("—"), null);
  assert.equal(parseLegacyNumber(null), null);
  assert.equal(parseLegacyNumber("1,5"), null);
  assert.equal(parseLegacyNumber("37.5"), 37.5);
  assert.equal(parseLegacyNumber("40%"), 40);
  assert.equal(parseLegacyBase("Base cuantitativa"), null);
  assert.equal(parseLegacyBase("n=28"), 28);
});

// ===========================================================================
console.log("\n[6] El documento de prueba tiene la forma del real");
await checkAsync("el constructor REAL produce un documento que el validador acepta", async () => {
  const identity = {
    specId: "cuicuilco",
    mappingVersion: 1,
    calculationVersion: CUICUILCO_RESULTS_V1.calculationVersion,
    tenantId: TENANT,
    studyId: STUDY,
    packageIdempotencyKey: `sha256:${"c".repeat(64)}`,
    planFingerprint: `sha256:${"d".repeat(64)}`,
  };
  const real = buildCanonicalStudyResults(emptyResultSource(identity), { spec: CUICUILCO_RESULTS_V1 });
  const { reader, calls } = countingReader(real);
  const shadow = await runShadowComparison({ scope: SCOPE, legacy: LEGACY, filters: {}, env: ENABLED, loadCanonical: reader });
  assert.equal(calls(), 1);
  assert.equal(shadow.status, "compared", "the real document must pass the same validator the stub does");
  assert.equal(shadow.contractVersion, real.contractVersion);
  assert.equal(shadow.planFingerprint, identity.planFingerprint);
  assert.equal(JSON.stringify(LEGACY), LEGACY_SERIALIZED);
});

// ===========================================================================
console.log("\n[7] Nada privado entra en un diagnóstico");
await checkAsync("ningún identificador, cita ni valor de segmento aparece", async () => {
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: { esfera: "Norte" },
    env: ENABLED,
    loadCanonical: async () => CANONICAL,
  });
  const serialized = JSON.stringify(shadow);
  for (const forbidden of ["secret-person", "secret-observation", "Una cita aprobada", "Norte", "Sur", "acompanamiento"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden), forbidden);
  }
});
check("el alcance del filtro describe la selección SIN describirla", () => {
  // Phase 3 hashed the [key, value] pairs with an unsalted SHA-256 and called
  // that a fingerprint. The values come from a catalogue the same payload
  // publishes to the browser, so the whole space of realistic selections is a
  // few thousand strings and a dictionary reverses the digest immediately. The
  // old gate asserted the digest LOOKED like a hash, which is not the safety
  // property. These assertions are the property: no value, hashed or otherwise.
  assert.deepEqual(describeFilterScope({}), { filtered: false, dimensionKeys: [], dimensionCount: 0 });
  assert.deepEqual(describeFilterScope({ esfera: "Norte" }), {
    filtered: true,
    dimensionKeys: ["esfera"],
    dimensionCount: 1,
  });
  // The SAME description for two different values. That is the point: a
  // description that could tell "Norte" from "Sur" is a description of the value.
  assert.deepEqual(describeFilterScope({ esfera: "Norte" }), describeFilterScope({ esfera: "Sur" }));
  const described = JSON.stringify(describeFilterScope({ esfera: "Norte", generacion: "Boomer" }));
  assert.doesNotMatch(described, /Norte|Sur|Boomer/);
  assert.doesNotMatch(described, /sha256|[0-9a-f]{32}/);
  // An empty value is not a filter — `calc/filters.ts` treats it as inactive and
  // the legacy builder therefore does not filter on it. The two definitions must
  // not diverge, or a `?f.esfera=` link would suppress a comparison the legacy
  // side actually performed unfiltered.
  assert.equal(describeFilterScope({ esfera: "" }).filtered, false);
  assert.equal(describeFilterScope({ esfera: "" }).dimensionCount, 0);
});
check("una clave de dimensión que no es un identificador no se publica", () => {
  // A segment key is whatever column the workbook carried. A shape check keeps
  // out a sentence, a name, an address and an e-mail; the COUNT stays exact so
  // nothing is silently under-reported.
  assert.deepEqual(safeDimensionKeys(["esfera", "Juan Pérez", "correo@ejemplo.mx", "estado_membresia"]), [
    "esfera",
    "estado_membresia",
  ]);
  assert.deepEqual(safeDimensionKeys(["A", "  ", "x".repeat(80), 7, null]), []);
  const scope = describeFilterScope({ esfera: "Norte", "Juan Pérez": "x" });
  assert.deepEqual(scope.dimensionKeys, ["esfera"]);
  assert.equal(scope.dimensionCount, 2, "the count must stay exact even when a key is withheld");
});
// The FIELD NAMES, not the prose around them: the comments deliberately say the
// word "message" while explaining that no field may carry one, and a scan that
// could not tell the two apart would either fail here or be loosened until it
// proved nothing.
//
// The `= {` in the start marker matters. `export type ShadowFinding` alone now
// matches `export type ShadowFindingKey`, which is declared earlier, and the
// scan would silently read the wrong block.
//
// And the identifier pattern accepts an optional `?`. Without it a field
// declared `noteCode?:` is invisible to BOTH the list comparison and the
// forbidden-name loop, which is a bypass for the exact edit this check exists
// to catch.
const PERSONAL_NAMES = ["respondent", "quote", "person", "email", "message", "segment", "text", "label"];
const blockOf = (file, startMarker) => {
  const source = readFileSync(file, "utf8");
  const from = source.indexOf(startMarker);
  assert.notEqual(from, -1, `${startMarker} not found in ${file}`);
  const to = source.indexOf("\n};", from);
  assert.notEqual(to, -1, `the block opened by ${startMarker} never closes in ${file}`);
  return source.slice(from, to).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
};

/**
 * The declared field names of one type, and ALL of them.
 *
 * A `^`-anchored scan had four bypasses, each of which would have hidden a new
 * field from both the list comparison and the forbidden-name loop: a member
 * declared `readonly`, a member whose name is quoted, a second member on the
 * same line as the first, and an index signature — which does not name a field
 * at all and would let anything in under any name. So: nested object types are
 * collapsed first (their members belong to their own assertion, not this one),
 * members are split on `;` rather than on line starts, `readonly` and quotes
 * are stripped, and an index signature is refused outright.
 */
const fieldNamesOf = (file, startMarker) => {
  const block = blockOf(file, startMarker);
  const body = block.slice(block.indexOf("{") + 1);
  assert.ok(!/^\s*(readonly\s+)?\[/m.test(body), `${startMarker} declares an index signature`);
  const flat = body.replace(/\{[^{}]*\}/g, "{}");
  return flat
    .split(";")
    .map((member) => member.replace(/\breadonly\s+/g, "").replace(/["']/g, "").trim())
    .map((member) => /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(member))
    .filter((match) => match !== null)
    .map((match) => match[1])
    .sort();
};

/** The members of one nested object member, e.g. `counts`. */
const nestedFieldNamesOf = (file, startMarker, member) => {
  const block = blockOf(file, startMarker);
  const found = new RegExp(`\\b${member}\\s*:\\s*\\{([^{}]*)\\}`).exec(block);
  assert.ok(found, `${startMarker} has no nested member '${member}'`);
  return found[1]
    .split(";")
    .map((entry) => entry.replace(/["']/g, "").trim())
    .map((entry) => /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(entry))
    .filter((match) => match !== null)
    .map((match) => match[1])
    .sort();
};
const CONTRACT_FILE = join("src", "lib", "shadow", "contract.ts");
const DIAGNOSTICS_FILE = join("src", "lib", "shadow", "diagnostics.ts");

check("el contrato del hallazgo no tiene un lugar donde poner a una persona", () => {
  const fieldNames = fieldNamesOf(CONTRACT_FILE, "export type ShadowFinding = {");
  assert.deepEqual(
    fieldNames,
    [
      "agrees", "canonicalBase", "canonicalValue", "classification", "key",
      "legacyBase", "legacyValue", "mismatch", "noteCode", "rule", "section",
    ],
    "the finding's field list changed; every field must be provably non-personal",
  );
  for (const forbidden of PERSONAL_NAMES) {
    assert.ok(
      !fieldNames.some((name) => name.toLowerCase().includes(forbidden)),
      `ShadowFinding has a field named for '${forbidden}'`,
    );
  }
  assert.ok(!fieldNames.includes("note"), "the unrestricted free-text note came back");
});
check("el diagnóstico completo tampoco, y no lleva huella alguna", () => {
  const fieldNames = fieldNamesOf(CONTRACT_FILE, "export type ShadowDiagnostics = {");
  assert.deepEqual(fieldNames, [
    "budgetMs", "contractVersion", "counts", "elapsedMs", "filterScope", "findings",
    "packageIdempotencyKey", "planFingerprint", "status", "studyId", "tenantId",
  ]);
  assert.deepEqual(nestedFieldNamesOf(CONTRACT_FILE, "export type ShadowDiagnostics = {", "counts"), [
    "agreed", "classified", "compared", "disagreed",
  ]);
  for (const name of fieldNames) {
    assert.ok(!PERSONAL_NAMES.some((forbidden) => name.toLowerCase().includes(forbidden)), name);
  }
  assert.ok(!fieldNames.includes("filterFingerprint"), "the reversible fingerprint came back");
  const scopeFields = fieldNamesOf(CONTRACT_FILE, "export type ShadowFilterScope = {");
  assert.deepEqual(scopeFields, ["dimensionCount", "dimensionKeys", "filtered"]);
  assert.ok(!scopeFields.some((name) => /value|fingerprint|hash|digest/i.test(name)));
});
check("el registro de EJECUCIÓN no tiene un lugar donde poner una cifra", () => {
  // The runtime record is what a server may hand to a sink, so it carries codes
  // and totals and no numbers at all. Not "no small numbers" — NO numbers: a
  // rule that needed a base to decide would need re-deciding every time a
  // finding is added, in the one place being wrong is unrecoverable.
  const record = fieldNamesOf(DIAGNOSTICS_FILE, "export type ShadowRuntimeRecord = {");
  assert.deepEqual(record, [
    "budgetMs", "contractVersion", "counts", "elapsedMs", "filterDimensionCount",
    "filtered", "findings", "packageIdempotencyKey", "planFingerprint", "status",
    "studyId", "tenantId",
  ]);
  assert.deepEqual(nestedFieldNamesOf(DIAGNOSTICS_FILE, "export type ShadowRuntimeRecord = {", "counts"), [
    "agreed", "classified", "compared", "disagreed",
  ]);
  for (const name of record) {
    assert.ok(!PERSONAL_NAMES.some((forbidden) => name.toLowerCase().includes(forbidden)), name);
  }
  for (const forbidden of ["legacyValue", "canonicalValue", "legacyBase", "canonicalBase", "dimensionKeys"]) {
    assert.ok(!record.includes(forbidden), `the runtime record carries '${forbidden}'`);
  }
  const finding = fieldNamesOf(DIAGNOSTICS_FILE, "export type ShadowRuntimeFinding = {");
  assert.deepEqual(finding, ["agrees", "classification", "key", "mismatch", "noteCode", "rule", "section"]);
});
check("cada estado posible es uno del contrato", () => {
  assert.deepEqual([...SHADOW_STATUSES].sort(), [
    "canonical_malformed",
    "canonical_timeout",
    "canonical_transport_error",
    "comparator_error",
    "compared",
    "disabled_by_flag",
    "scope_not_allowlisted",
  ]);
});

// ===========================================================================
console.log("\n[8] La frontera de dependencias, recorrida de verdad");
{
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const walk = (dir) => {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  };

  /** Resolve one import specifier to a file inside `src`, or null. */
  const resolveSpecifier = (fromFile, specifier) => {
    let base;
    if (specifier.startsWith("@/")) base = join("src", specifier.slice(2));
    else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
    else return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
      try {
        if (statSync(candidate).isFile()) return candidate.replace(/\\/g, "/");
      } catch {
        /* not this candidate */
      }
    }
    return null;
  };

  const importsOf = (file) => {
    const code = stripComments(readFileSync(file, "utf8"));
    const found = new Set();
    for (const match of code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const resolved = resolveSpecifier(file, match[1]);
      if (resolved) found.add(resolved);
    }
    return [...found];
  };

  /** Every module reachable from `entry`, and the first path that reaches each. */
  const reachable = (entry) => {
    const paths = new Map([[entry.replace(/\\/g, "/"), [entry.replace(/\\/g, "/")]]]);
    const queue = [entry.replace(/\\/g, "/")];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of importsOf(current)) {
        if (paths.has(next)) continue;
        paths.set(next, [...paths.get(current), next]);
        queue.push(next);
      }
    }
    return paths;
  };

  const appFiles = walk(join("src", "app"));
  const componentFiles = walk(join("src", "components"));
  const isCanonical = (path) => /src\/lib\/(canonical-source|ingestion\/canonical-commit|ingestion\/canonical-package)\//.test(path);
  const isShadow = (path) => /src\/lib\/shadow\//.test(path);
  /**
   * THE DOORS TO THE CANONICAL LAYER, and there are exactly two.
   *
   * This was one page and one loader, held in two constants, and the check
   * below asserted the number 1. Unit 6B.1 adds the SECOND and last door: an
   * authenticated Studio composer that reads canonical results to resolve a
   * presentation. Rather than raise a number, the doors are now a TABLE, so
   * every one of them is named beside the loader it is required to go through
   * and a third cannot be added by editing a digit.
   *
   * `via` is an extra module the chain must also pass through. It is set only
   * for the insights door, whose whole design is that the canonical layer is
   * reached through the shadow orchestrator and never directly — a property
   * that must stay attached to that door alone. The composer door has no
   * orchestrator: it is not a comparison, it is a read.
   */
  const APPROVED_DOORS = [
    {
      page: "src/app/insights/e/[studyId]/page.tsx",
      loader: "src/lib/studies/study-dashboard.ts",
      via: "src/lib/shadow/server.ts",
    },
    {
      page: "src/app/studio/e/[studyId]/construccion/page.tsx",
      loader: "src/lib/studio/presentation-workspace.ts",
      via: null,
    },
    /**
     * THE THIRD DOOR, AND IT IS NOT A THIRD LOADER.
     *
     * Unit 6B.4A adds the canonical publication review. It needs canonical data
     * for a reason nothing else supplies: a publication has to be checked
     * against the study's results AS THEY ARE NOW, and the client-visible
     * preview a reviewer approves is the resolution of the stored draft over
     * those results.
     *
     * The standing rule — "if a surface needs canonical data it goes through one
     * of the loaders above, or a new one is argued for in the gate first" — is
     * satisfied by going through one of them. `publication-workspace.ts` holds
     * no canonical reader of its own; it imports everything that touches one
     * from `presentation-workspace.ts`, through a single import statement, so
     * this page's path to the canonical layer runs through that file BY
     * CONSTRUCTION rather than by which import happened to be written first.
     *
     * The `loader` field is what makes that a proof: this row fails the moment
     * the publication module grows its own edge into the canonical graph, which
     * is exactly the change that would make it a third loader.
     */
    {
      page: "src/app/studio/e/[studyId]/revision/page.tsx",
      loader: "src/lib/studio/presentation-workspace.ts",
      via: null,
    },
  ];
  /**
   * THE ONE SERVER ACTION THAT MAY REACH IT, and why the class stays closed.
   *
   * Every other `"use server"` module in the product is refused the canonical
   * layer outright, and that rule is kept: what changes is that ONE named file
   * is exempted, not the class.
   *
   * The exemption is forced by the design of the composer and not by
   * convenience. The explicit preview refresh has to take a document the
   * browser edited, validate it, read canonical results and resolve it — on the
   * server, because resolving needs the registry's address map. The only two
   * ways to be called from a browser are a Server Action and an HTTP route
   * handler, and route handlers are refused by the check above for stronger
   * reasons: a route is a public URL surface, an action is not.
   *
   * The exempted action re-authorizes with `getUser()`, reads the role from the
   * database, validates the study id as a UUID, reads the tenant back from the
   * row rather than taking it from the request, treats the document as hostile,
   * and writes nothing.
   */
  const APPROVED_ACTIONS = [
    {
      file: "src/app/studio/e/[studyId]/construccion/actions.ts",
      loader: "src/lib/studio/presentation-workspace.ts",
    },
    /**
     * Unit 6B.4A. The publication review's two actions, for the same forced
     * reason: publishing has to re-run the whole preflight over a fresh
     * canonical read on the server, and the only two ways to be called from a
     * browser are a Server Action and an HTTP route handler — and route
     * handlers are refused above, for stronger reasons.
     *
     * It re-authorizes with `getUser()`, reads the role from the database,
     * validates the study id as a UUID, reads the tenant back from the row
     * rather than taking it from the request, and accepts NO document: four
     * numbers and a list of closed codes, so there is nothing for a browser to
     * smuggle in.
     */
    {
      file: "src/app/studio/e/[studyId]/revision/actions.ts",
      loader: "src/lib/studio/presentation-workspace.ts",
    },
  ];
  // The insights door by name, for the two checks further down that are about
  // THAT door specifically — that its page binds only the legacy payload, and
  // that its loader is server-only and mutates nothing. Derived from the table
  // rather than written twice, so the two can never name different files.
  const APPROVED_PAGE = APPROVED_DOORS[0].page;
  const APPROVED_LOADER = APPROVED_DOORS[0].loader;

  /**
   * The entry-point classes that must NEVER reach the canonical layer.
   *
   * Phase 3's walk covered `"use client"` files, HTTP routes and pages. That
   * left three whole classes of server entry point invisible: SERVER ACTIONS
   * (eight `"use server"` modules under `src/app`), the ROOT LAYOUT and the
   * error/loading/not-found boundaries, and `src/middleware.ts` — which is not
   * under `src/app` at all, so no walk rooted there could ever have seen it. An
   * action importing the canonical layer would have passed the entire gate.
   */
  const isDirective = (path, directive) => new RegExp(`^\\s*["']${directive}["']`, "m").test(readFileSync(path, "utf8"));
  const serverActionFiles = [...appFiles, ...componentFiles].filter((path) => isDirective(path, "use server"));
  const middlewareFiles = ["src/middleware.ts", "src/middleware.tsx"].filter((path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });

  check("ningún COMPONENTE DE CLIENTE alcanza la capa canónica, por ningún camino", () => {
    const clientFiles = [...appFiles, ...componentFiles].filter((path) =>
      /^\s*["']use client["']/m.test(readFileSync(path, "utf8")),
    );
    assert.ok(clientFiles.length >= 10, `only ${clientFiles.length} client components found`);
    for (const file of clientFiles) {
      const paths = reachable(file);
      const leak = [...paths.keys()].find(isCanonical);
      assert.ok(!leak, `${file} reaches ${leak}\n  via ${JSON.stringify(paths.get(leak))}`);
    }
  });

  check("ninguna RUTA HTTP alcanza la capa canónica, por ningún camino", () => {
    const routes = appFiles.filter((path) => /route\.tsx?$/.test(path));
    assert.ok(routes.length >= 2, `only ${routes.length} routes found`);
    for (const route of routes) {
      const paths = reachable(route);
      const leak = [...paths.keys()].find(isCanonical);
      assert.ok(!leak, `${route} reaches ${leak}`);
    }
  });

  check("SÓLO las páginas aprobadas alcanzan la capa canónica, y cada una por su puerta", () => {
    const pages = appFiles.filter((path) => /page\.tsx$/.test(path));
    const reaching = [];
    for (const page of pages) {
      const paths = reachable(page);
      const leak = [...paths.keys()].find(isCanonical);
      if (leak) reaching.push({ page: page.replace(/\\/g, "/"), path: paths.get(leak) });
    }
    assert.equal(
      reaching.length,
      APPROVED_DOORS.length,
      `pages reaching the canonical layer: ${reaching.map((r) => r.page).join(", ")}`,
    );
    for (const door of APPROVED_DOORS) {
      const found = reaching.find((entry) => entry.page === door.page);
      assert.ok(found, `the approved door ${door.page} no longer reaches the canonical layer`);
      assert.ok(
        found.path.includes(door.loader),
        `${door.page} skips its declared loader ${door.loader}: ${JSON.stringify(found.path)}`,
      );
      if (door.via) {
        assert.ok(
          found.path.includes(door.via),
          `${door.page} skips ${door.via}: ${JSON.stringify(found.path)}`,
        );
      }
    }
    // A door that is not in the table is a door nobody approved.
    for (const entry of reaching) {
      assert.ok(
        APPROVED_DOORS.some((door) => door.page === entry.page),
        `unapproved page reaches the canonical layer: ${entry.page}\n  via ${JSON.stringify(entry.path)}`,
      );
    }
    // The composer door must NOT travel through the shadow orchestrator. Its
    // read is a read, and borrowing the comparison path would put a diagnostic
    // in the way of a product surface.
    // NEITHER STUDIO DOOR TRAVELS THROUGH THE SHADOW ORCHESTRATOR. Their reads
    // are reads, and borrowing the comparison path would put a diagnostic in the
    // way of a product surface. Written as a loop over the doors that declare no
    // `via` rather than as `APPROVED_DOORS[1]`, because an index silently means
    // a different door the moment a row is added — which is exactly what Unit
    // 6B.4A did.
    for (const door of APPROVED_DOORS.filter((entry) => entry.via === null)) {
      const found = reaching.find((entry) => entry.page === door.page);
      assert.ok(
        found && !found.path.some((step) => isShadow(step)),
        `${door.page} goes through the shadow layer: ${JSON.stringify(found?.path)}`,
      );
    }
  });

  check("SÓLO la acción aprobada alcanza la capa canónica; la clase sigue cerrada", () => {
    assert.ok(serverActionFiles.length >= 5, `only ${serverActionFiles.length} server actions found`);
    const reaching = [];
    for (const file of serverActionFiles) {
      const paths = reachable(file);
      const leak = [...paths.keys()].find(isCanonical);
      if (leak) reaching.push({ file: file.replace(/\\/g, "/"), path: paths.get(leak) });
    }
    assert.equal(
      reaching.length,
      APPROVED_ACTIONS.length,
      `server actions reaching the canonical layer: ${reaching.map((r) => r.file).join(", ")}`,
    );
    for (const approved of APPROVED_ACTIONS) {
      const found = reaching.find((entry) => entry.file === approved.file);
      assert.ok(found, `the approved action ${approved.file} no longer reaches the canonical layer`);
      assert.ok(
        found.path.includes(approved.loader),
        `${approved.file} skips its declared loader ${approved.loader}: ${JSON.stringify(found.path)}`,
      );
    }
    // An action that is not in the table is an action nobody approved.
    for (const entry of reaching) {
      assert.ok(
        APPROVED_ACTIONS.some((approved) => approved.file === entry.file),
        `unapproved action reaches the canonical layer: ${entry.file}\n  via ${JSON.stringify(entry.path)}`,
      );
    }
    // And it writes nothing. An action that may read the canonical layer and
    // could also write one is a different door from the one that was argued for.
    //
    // Comments are stripped first. The action's own header LISTS the writes it
    // does not perform — that is the clearest way to say so to the next reader —
    // and a scan that could not tell a promise from a call would forbid the
    // promise. This gate has made that mistake before and records it here.
    // WHAT THIS STILL GUARANTEES, AFTER UNIT 6B.3A — narrower than it was, and
    // said out loud rather than left to be inferred.
    //
    // Until 6B.3A the approved action wrote nothing at all, anywhere. It now
    // has a save, so the guarantee is no longer "no write happens because of
    // this file". What it IS, and what this asserts, is that the action itself
    // performs NO write DIRECTLY: no table call, no RPC, no revalidation. Every
    // write it causes goes through the one server-only loader, which
    // `canonical-composer-test.mjs` §[22] holds to a stricter rule than this
    // one — the only RPC it may name is the canonical draft save, and it may
    // not name a legacy experience table at all.
    //
    // A gate that kept certifying the wider claim would be certifying something
    // nobody checks any more, which is worse than checking less on purpose.
    for (const approved of APPROVED_ACTIONS) {
      const source = stripComments(readFileSync(approved.file, "utf8"));
      for (const writer of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "revalidatePath"]) {
        assert.ok(!source.includes(writer), `${approved.file} performs ${writer} directly`);
      }
    }
  });

  check("el MIDDLEWARE tampoco, y existe para poder comprobarlo", () => {
    // `src/middleware.ts` sits outside `src/app`, so the Phase 3 walk could not
    // see it at all. Asserting it EXISTS is half the check: a walk that found
    // nothing would pass vacuously.
    assert.equal(middlewareFiles.length, 1, "src/middleware.ts is missing; the check would pass vacuously");
    for (const file of middlewareFiles) {
      const paths = reachable(file);
      assert.ok(![...paths.keys()].find(isCanonical), `${file} reaches the canonical layer`);
      assert.ok(![...paths.keys()].find(isShadow), `${file} reaches the shadow layer`);
    }
  });

  check("ningún cliente, ruta o acción alcanza siquiera la CARPETA de la sombra", () => {
    // An INDEPENDENT boundary. Until Phase 3.1 the shadow barrel was caught by
    // the canonical walk only because `orchestrate.ts` happened to import a hash
    // helper from `ingestion/canonical-commit/`. That import is gone, so the
    // accidental edge is gone with it — and this check is what replaces it.
    const clientFiles = [...appFiles, ...componentFiles].filter((path) => isDirective(path, "use client"));
    const routes = appFiles.filter((path) => /route\.tsx?$/.test(path));
    for (const file of [...clientFiles, ...routes, ...serverActionFiles]) {
      const paths = reachable(file);
      const leak = [...paths.keys()].find(isShadow);
      assert.ok(!leak, `${file} reaches ${leak}\n  via ${JSON.stringify(paths.get(leak))}`);
    }
  });

  check("sólo el orquestador server-only nombra la lectura canónica", () => {
    const shadowFiles = readdirSync(join("src", "lib", "shadow")).map((name) => join("src", "lib", "shadow", name));
    const naming = shadowFiles.filter((path) => /canonical-source/.test(stripComments(readFileSync(path, "utf8"))));
    assert.deepEqual(naming.map((p) => p.replace(/\\/g, "/")), ["src/lib/shadow/server.ts"]);
  });

  check("sólo `server.ts` y `sink.ts` son server-only, y sólo uno toca el entorno", () => {
    const shadowFiles = readdirSync(join("src", "lib", "shadow"));
    const serverOnly = shadowFiles.filter((name) =>
      /^\s*import\s+["']server-only["']/m.test(readFileSync(join("src", "lib", "shadow", name), "utf8")),
    );
    // `sink.ts` is the second, and the ONLY second: it is where a run may be
    // recorded, so it must be as unreachable from a browser as the entry point.
    assert.deepEqual(serverOnly, ["server.ts", "sink.ts"]);
    const pure = shadowFiles.filter((name) => !serverOnly.includes(name));
    // `diagnostics.ts` is in this list, which is the point: the whitelist that
    // decides what may be recorded is pure, so the gate can execute it.
    assert.ok(pure.includes("diagnostics.ts"), "the runtime projection must stay pure");
    for (const name of pure) {
      const code = stripComments(readFileSync(join("src", "lib", "shadow", name), "utf8"));
      assert.ok(!/process\.env|@supabase|createClient\(|createAdminClient|\bfetch\(|node:/.test(code), name);
    }
    // And the sink reads NO environment. A flag could be set on a deployment by
    // somebody who never read the file; a function call cannot.
    const sink = stripComments(readFileSync(join("src", "lib", "shadow", "sink.ts"), "utf8"));
    assert.ok(!/process\.env/.test(sink), "the sink reads an environment variable");
    assert.ok(!/@supabase|createClient\(|\bfetch\(|node:/.test(sink), "the sink has a transport");
    assert.match(sink, /let installed: ShadowDiagnosticSink \| null = null;/, "the sink is not off by default");
  });

  check("la señal del presupuesto se reenvía en CADA salto", () => {
    // Two of these hops are single optional parameters. Deleting either
    // compiles clean and leaves every behavioural cancellation test green,
    // because those tests drive fakes that sit BELOW the deletion. Nothing but
    // reading the source catches it.
    const shadowServer = stripComments(readFileSync(join("src", "lib", "shadow", "server.ts"), "utf8"));
    assert.match(shadowServer, /loadCanonical: async \(scope, options\) =>/, "the reader ignores its options");
    assert.match(shadowServer, /signal: options\.signal,/, "shadow/server.ts drops the signal");

    const adapter = stripComments(readFileSync(join("src", "lib", "canonical-source", "adapter.ts"), "utf8"));
    assert.match(adapter, /signal: params\.signal,/, "canonical-source/adapter.ts drops the signal");

    const read = stripComments(readFileSync(join("src", "lib", "canonical-source", "read.ts"), "utf8"));
    assert.match(read, /signal\?\.aborted/, "the paging loop never checks the signal");
    assert.match(read, /READ_ABORTED/, "there is no cancellation refusal code");

    const transport = stripComments(readFileSync(join("src", "lib", "canonical-source", "postgrest.ts"), "utf8"));
    assert.match(
      transport,
      /if \(request\.signal\) query = query\.abortSignal\(request\.signal\);/,
      "the transport never puts the signal on the query",
    );
  });

  check("el barril seguro de la sombra no reexporta ningún punto de entrada", () => {
    const barrel = stripComments(readFileSync(join("src", "lib", "shadow", "index.ts"), "utf8"));
    assert.ok(!/from\s+["']\.\/server["']/.test(barrel));
    assert.ok(!/from\s+["']\.\/sink["']/.test(barrel), "the barrel re-exports the sink");
  });

  check("ninguna configuración de este repositorio enciende la sombra", () => {
    // The one property with no automated guard until Phase 3.1: every proof that
    // the shadow is off was a proof about the CODE's defaults. This one is about
    // the repository's own configuration.
    const workflows = (() => {
      try {
        return readdirSync(join(".github", "workflows")).map((name) => join(".github", "workflows", name));
      } catch {
        return [];
      }
    })();
    const candidates = [
      // `.env*` is gitignored, so this half scans the DEVELOPER'S tree: an
      // untracked `.env.local` that turned the shadow on locally is caught here
      // even though it could never be committed.
      ...readdirSync(".").filter((name) => /^\.env(\..*)?$/.test(name)),
      ".dev.vars",
      "wrangler.toml",
      "wrangler.json",
      "wrangler.jsonc",
      "next.config.ts",
      "open-next.config.ts",
      "package.json",
      "Dockerfile",
      ...workflows,
    ];
    for (const file of candidates) {
      let code;
      try {
        code = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const setting = code
        .split("\n")
        .filter((line) => /BECOMMUNITY_SHADOW_MODE\s*[=:]/.test(line))
        .filter((line) => !/^\s*(#|\/\/)/.test(line));
      assert.deepEqual(setting, [], `${file} sets the shadow flag`);
    }
  });

  check("ninguna página, componente o ruta nombra el diagnóstico de la sombra", () => {
    // `shadow` as an IDENTIFIER, which means string literals go first: Tailwind
    // writes `shadow-sm` and `hover:shadow` on half the components and those
    // only ever live inside a className string. Once the strings are gone, any
    // remaining `shadow` is a binding — a destructured field, a prop, a
    // variable — and that is exactly what must not exist here.
    const stripLiterals = (code) =>
      code
        .replace(/`(?:[^`\\]|\\.)*`/g, '""')
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, '""');
    const identifiers = /\bshadow\b|\bShadow[A-Z]/;
    const offenders = [...appFiles, ...componentFiles].filter((path) =>
      identifiers.test(stripLiterals(stripComments(readFileSync(path, "utf8")))),
    );
    assert.deepEqual(offenders.map((p) => p.replace(/\\/g, "/")), []);
  });

  check("la página aprobada vincula SÓLO el pago heredado", () => {
    const code = readFileSync(APPROVED_PAGE, "utf8");
    assert.match(code, /const \{ legacy: dashboard \} = await loadStudyDashboard\(/);
    assert.ok(!/\.shadow\b/.test(code), "the page reads the diagnostics");
    // Bracket notation was the blind spot in BOTH diagnostics checks: the
    // identifier scan strips string literals before testing, so `x["shadow"]`
    // became `x[""]` and matched nothing, and `/\.shadow\b/` never saw it
    // either. Tested here on the RAW source, before any stripping.
    for (const file of [...appFiles, ...componentFiles]) {
      const raw = readFileSync(file, "utf8");
      assert.ok(
        !/\[\s*["'`]shadow["'`]\s*\]/.test(raw),
        `${file} reaches the diagnostics through bracket notation`,
      );
    }
  });

  check("el cargador aprobado es server-only y no muta nada", () => {
    const code = stripComments(readFileSync(APPROVED_LOADER, "utf8"));
    assert.match(code, /^import "server-only";/m);
    assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(code));
  });

  check("nada alcanzable desde la sombra puede mutar la base de datos", () => {
    // THE WRITE PATH, precisely. `canonical-commit/result.ts` is the SAFE error
    // vocabulary and `canonical-package/values.ts` the absence states; the read
    // adapter legitimately shares both, and banning the whole folder would ban
    // a type. What must never be reachable is the module that stages, commits
    // or rolls back — and no reachable module may call a mutation at all.
    //
    // A MUTATION IS A METHOD ON A QUERY BUILDER, not any method with the same
    // name. `results/population.ts` calls `Set.delete(id)` on a local set; a
    // pattern that could not tell that from `from("x").delete()` would fail on
    // honest code and be deleted. So only the modules that could hold a
    // database client at all are examined — the ones that name a Supabase
    // import, a client factory or `.from(` — and in those, the builder methods
    // used must be a subset of the read-only vocabulary.
    //
    // ⚠️ Phase 3 wrote this as `/^(insert|update|upsert|delete|rpc)$/.test(m) &&
    // !READ_ONLY_BUILDER_METHODS.has(m)` over a set containing none of those
    // five names. The second conjunct was therefore ALWAYS true — dead code
    // dressed as an allowlist, next to a comment claiming the used methods
    // "must be a subset of the read-only vocabulary", which nothing checked. The
    // denylist is the real property and it is kept; the allowlist claim is moved
    // to where it can actually be enforced, in the check below this one.
    const WRITE_PATH = /canonical-commit\/(adapter|server|flow|projector)\.ts$/;
    const paths = reachable("src/lib/shadow/server.ts");
    const mutators = [];
    for (const file of paths.keys()) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (WRITE_PATH.test(file)) mutators.push(`${file} (write path)`);
      const holdsClient = /@supabase\/supabase-js|createAdminClient|createClient\(|\.from\(/.test(code);
      if (!holdsClient) continue;
      for (const match of code.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) {
        if (/^(insert|update|upsert|delete|rpc)$/.test(match[1])) mutators.push(`${file} (.${match[1]}())`);
      }
    }
    assert.deepEqual(mutators, []);
    assert.ok(paths.size > 10, `only ${paths.size} modules reachable from the shadow entry point`);
    assert.ok([...paths.keys()].some((file) => /canonical-source\/adapter\.ts$/.test(file)), "the read adapter is unreachable");
    assert.ok([...paths.keys()].some((file) => /shadow\/sink\.ts$/.test(file)), "the sink is not on the entry point's path");
  });

  check("la superficie del constructor que el transporte declara es sólo de LECTURA", () => {
    // `postgrest.ts` describes the client STRUCTURALLY instead of importing it,
    // which means this type is the complete list of methods the canonical read
    // path is even able to call. Enforcing it here is the allowlist the check
    // above only claimed to have. `abortSignal` is a read modifier — it puts a
    // signal on the request's `fetch` — and is listed for that reason.
    const source = readFileSync(join("src", "lib", "canonical-source", "postgrest.ts"), "utf8");
    const from = source.indexOf("export type PostgrestScopedQuery = {");
    assert.notEqual(from, -1);
    const block = source
      .slice(from, source.indexOf("\n};", from))
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    const methods = [...block.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)].map((match) => match[1]).sort();
    assert.deepEqual(methods, ["abortSignal", "eq", "limit", "or", "order"]);
  });

  check("el modelo de resultados sigue sin transporte y sin server-only", () => {
    for (const path of walk(join("src", "lib", "results"))) {
      const code = stripComments(readFileSync(path, "utf8"));
      assert.ok(!/@supabase|createClient\(|\.rpc\(|\bfetch\(|node:|process\.env/.test(code), path);
      assert.ok(!/^\s*import\s+["']server-only["']/m.test(code), path);
    }
  });
}

// ===========================================================================
// Unit 5 Phase 3.1 — THE FILTERED COMPARISON, adversarially.
//
// `shadow/server.ts` reads the canonical document by tenant and study. It does
// not apply the request's legacy filter, and it cannot: no authority maps a
// legacy segment key onto a canonical attribute key. Phase 3 guarded
// `population.selected` for that reason and then compared the FILTERED legacy
// NPS and CRI against that UNFILTERED document anyway.
//
// These fixtures are chosen so that both failure directions are live at once.
// With `esfera: "Norte"` the fixture's filtered NPS is still 40 and its
// filtered CRI is still 37.5 — identical to the canonical document — while the
// bases fall from 20 to 10. An unguarded comparator therefore reports a FALSE
// AGREEMENT on both values and a FALSE DISAGREEMENT on both bases, from the
// same run. Nothing here relies on a number the comparator itself produced.
// ===========================================================================
console.log("\n[9] Nada que el filtro toque se compara");

const NORTE = { esfera: "Norte" };
const FILTERED_LEGACY = buildLegacy(NORTE);
const filteredFindings = () => compareLegacyWithCanonical(FILTERED_LEGACY, CANONICAL, { filtered: true });
const unfilteredFindings = () => compareLegacyWithCanonical(LEGACY, CANONICAL, { filtered: false });
const findingAt = (findings, key) => {
  const found = findings.find((entry) => entry.key === key);
  assert.ok(found, `no finding for ${key}`);
  return found;
};

check("la trampa existe: filtrado, el legado da el MISMO valor y OTRA base", () => {
  // If this ever stops holding, the four checks below stop proving anything and
  // must be re-derived rather than quietly kept.
  const nps = FILTERED_LEGACY.view.tiles.find((tile) => tile.key === "nps");
  assert.equal(parseLegacyNumber(nps.value), 40, "the filtered NPS is no longer the canonical value");
  assert.equal(parseLegacyBase(nps.detail), 10, "the filtered NPS base is no longer different");
  const cri = FILTERED_LEGACY.view.averages.find((entry) => entry.key === "average:cri");
  assert.equal(parseLegacyNumber(cri.value), 37.5, "the filtered CRI is no longer the canonical value");
  assert.equal(parseLegacyBase(cri.detail), 10, "the filtered CRI base is no longer different");
  assert.equal(FILTERED_LEGACY.view.selectedUnits, 11);
});

check("el NPS filtrado no puede producir un ACUERDO falso", () => {
  const value = findingAt(filteredFindings(), "recommendation.nps.combinado.value");
  assert.equal(value.agrees, null, "a filtered NPS was compared");
  assert.equal(value.classification, "presentation_configuration_required");
  assert.equal(value.mismatch, "filter_scope");
  assert.equal(value.noteCode, "filtered_scope_not_comparable");
  assert.equal(value.legacyValue, null);
  assert.equal(value.canonicalValue, null);
  assert.equal(value.rule, "not-compared");
});
check("y la BASE filtrada del NPS no puede producir un DESACUERDO falso", () => {
  const base = findingAt(filteredFindings(), "recommendation.nps.combinado.base");
  assert.equal(base.agrees, null, "a filtered NPS base was compared");
  assert.equal(base.mismatch, "filter_scope");
  assert.equal(base.legacyValue, null);
  assert.equal(base.canonicalValue, null);
  assert.equal(base.legacyBase, null);
  assert.equal(base.canonicalBase, null);
});
check("el CRI filtrado tampoco, ni su valor ni su base", () => {
  for (const key of ["renewal.cri.value", "renewal.cri.base"]) {
    const item = findingAt(filteredFindings(), key);
    assert.equal(item.agrees, null, key);
    assert.equal(item.classification, "presentation_configuration_required", key);
    assert.equal(item.mismatch, "filter_scope", key);
    assert.equal(item.legacyValue, null, key);
    assert.equal(item.canonicalValue, null, key);
  }
});
check("la población seleccionada tampoco", () => {
  const selected = findingAt(filteredFindings(), "population.selected");
  assert.equal(selected.agrees, null);
  assert.equal(selected.classification, "presentation_configuration_required");
  assert.equal(selected.mismatch, "filter_scope");
  assert.equal(selected.legacyValue, null);
});
check("una corrida filtrada NO reporta acuerdo ni desacuerdo sobre lo que el filtro toca", () => {
  const findings = filteredFindings();
  const compared = findings.filter((entry) => entry.agrees !== null);
  // Exactly ONE comparison survives a filter, and it is the one whose legacy
  // side is provably unfiltered. Naming it here is deliberate: a future edit
  // that added a second would have to change this line and say why.
  assert.deepEqual(compared.map((entry) => entry.key), ["population.measured"]);
  assert.equal(findings.filter((entry) => entry.agrees === false).length, 0, "a filtered run disagreed");
});
check("y ninguna cifra de una corrida filtrada viene de datos filtrados", () => {
  // The allowlist is the proof, not the absence of a number: these three come
  // from `rows`/`qualitative` BEFORE `filterRowsBySegments` (view.ts:182, 183,
  // 186), so their values are the same filtered or not.
  const UNFILTERED_SOURCES = new Set(["population.measured", "legacy.pivot.allowlist", "legacy.filterOptions"]);
  for (const item of filteredFindings()) {
    if (UNFILTERED_SOURCES.has(item.key)) continue;
    assert.equal(item.legacyValue, null, `${item.key} published a filtered legacy value`);
    assert.equal(item.legacyBase, null, `${item.key} published a filtered legacy base`);
  }
});
check("las tres fuentes SIN filtrar son idénticas con y sin filtro", () => {
  // This pins the assumption the check above rests on. The day somebody filters
  // `sourceUnits`, this fails instead of the comment quietly becoming false.
  assert.equal(FILTERED_LEGACY.view.sourceUnits, LEGACY.view.sourceUnits);
  assert.deepEqual(FILTERED_LEGACY.filterOptions, LEGACY.filterOptions);
  assert.deepEqual(FILTERED_LEGACY.pivotAllowlist, LEGACY.pivotAllowlist);
});
check("una selección SUPRIMIDA no se reporta como ausencia del legado", () => {
  // Under five people the legacy builder empties `tiles` and `averages`
  // entirely. Unguarded, the comparator read that as "legacy absent" and set
  // `agrees: canonicalNps === null` — a DISAGREEMENT manufactured out of a
  // disclosure rule.
  const twoPeople = legacyRows.filter((row) => ["secret-person-1", "secret-person-3"].includes(row.respondent_id));
  const suppressed = buildStudyDashboard(twoPeople, [], legacyStages, NORTE, {});
  assert.equal(suppressed.view.selectionVisibility, "suppressed");
  assert.deepEqual(suppressed.view.tiles, []);
  assert.deepEqual(suppressed.view.averages, []);
  const findings = compareLegacyWithCanonical(suppressed, CANONICAL, { filtered: true });
  for (const key of ["recommendation.nps.combinado.value", "renewal.cri.value"]) {
    const item = findingAt(findings, key);
    assert.equal(item.agrees, null, key);
    assert.equal(item.mismatch, "filter_scope", key);
  }
  assert.equal(findings.filter((entry) => entry.agrees === false).length, 0);
  // And the suppression flag itself — which under a filter says "this segment
  // has fewer than five people" — carries no number.
  const disclosure = findingAt(findings, "disclosure.small_sample_suppression");
  assert.equal(disclosure.legacyValue, null);
  assert.equal(disclosure.noteCode, "legacy_value_withheld_under_filter");
});
check("VARIOS filtros se describen por su número, y refutan lo mismo", () => {
  const multiRows = [
    ...Array.from({ length: 12 }, (_, index) => ({
      respondent_id: `secret-person-${index + 1}`,
      metric_key: "nps",
      value: index < 8 ? 10 : 3,
      esfera: index % 2 === 0 ? "Norte" : "Sur",
      generacion: index < 6 ? "Alfa" : "Beta",
    })),
    ...Array.from({ length: 12 }, (_, index) => ({
      respondent_id: `secret-person-${index + 1}`,
      metric_key: "cri",
      value: 25,
      esfera: index % 2 === 0 ? "Norte" : "Sur",
      generacion: index < 6 ? "Alfa" : "Beta",
    })),
  ];
  const filters = { esfera: "Norte", generacion: "Alfa" };
  const legacy = buildStudyDashboard(multiRows, [], legacyStages, filters, {});
  const scope = describeFilterScope(filters);
  assert.deepEqual(scope, { filtered: true, dimensionKeys: ["esfera", "generacion"], dimensionCount: 2 });
  const findings = compareLegacyWithCanonical(legacy, CANONICAL, { filtered: scope.filtered });
  assert.deepEqual(
    findings.filter((entry) => entry.agrees !== null).map((entry) => entry.key),
    ["population.measured"],
  );
  assert.doesNotMatch(JSON.stringify(scope), /Norte|Alfa/);
});
check("SIN filtro, las seis comparables siguen siendo seis y siguen de acuerdo", () => {
  // The compatibility headline. Phase 3.1 corrected the filtered path and had
  // to leave this one untouched.
  const findings = unfilteredFindings();
  const compared = findings.filter((entry) => entry.agrees !== null);
  assert.deepEqual(compared.map((entry) => entry.key).sort(), [
    "population.measured",
    "population.selected",
    "recommendation.nps.combinado.base",
    "recommendation.nps.combinado.value",
    "renewal.cri.base",
    "renewal.cri.value",
  ]);
  assert.equal(compared.filter((entry) => entry.agrees).length, 6);
  assert.equal(compared.filter((entry) => !entry.agrees).length, 0);
});
check("el CONJUNTO de hallazgos no depende del filtro", () => {
  assert.deepEqual(
    filteredFindings().map((entry) => entry.key),
    unfilteredFindings().map((entry) => entry.key),
  );
});
check("cada clave, sección, regla y código pertenece a su lista cerrada", () => {
  for (const findings of [filteredFindings(), unfilteredFindings()]) {
    for (const item of findings) {
      assert.ok(SHADOW_FINDING_KEYS.includes(item.key), `key ${item.key}`);
      assert.ok(SHADOW_SECTIONS.includes(item.section), `section ${item.section}`);
      assert.ok(COMPARISON_RULES.includes(item.rule), `rule ${item.rule}`);
      if (item.noteCode !== null) assert.ok(NOTE_CODES.includes(item.noteCode), `note ${item.noteCode}`);
    }
  }
});
check("una regla de redondeo fuera del contrato es un rechazo, no una cadena nueva", () => {
  assert.equal(decimalsRule(1), "decimals:1");
  assert.equal(decimalsRule(2), "decimals:2");
  for (const bad of [7, -1, 1.5, Number.NaN]) {
    assert.throws(() => decimalsRule(bad), RangeError, `decimals ${bad} was accepted`);
  }
});

// ===========================================================================
console.log("\n[10] El presupuesto CANCELA, no sólo deja de esperar");

await checkAsync("un lector agotado OBSERVA la cancelación", async () => {
  // This reader rejects from INSIDE its abort listener, which fires
  // synchronously. Phase 3.1's first draft classified on the race's winner, and
  // that ordering made a budget expiry report `canonical_transport_error`. A
  // real `fetch` rejects asynchronously, so the defect would have hidden until
  // somebody needed the number.
  let observed = null;
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: {},
    env: { ...ENABLED, [ENV_SHADOW_BUDGET_MS]: "40" },
    loadCanonical: (_scope, options) =>
      new Promise((_resolve, reject) => {
        observed = options.signal;
        options.signal.addEventListener("abort", () => reject(new Error("aborted by the caller")));
      }),
  });
  assert.equal(shadow.status, "canonical_timeout");
  assert.ok(observed, "the reader was never given a signal");
  assert.equal(observed.aborted, true, "the reader was not cancelled");
});

await checkAsync("la cancelación usa el motivo de la PLATAFORMA, no uno propio", async () => {
  // ⚠️ THE EXPENSIVE ONE. `@supabase/postgrest-js` decides whether a rejected
  // `fetch` was cancelled by looking at the rejection's identity:
  //   fetchError?.name === "AbortError" || fetchError?.code === "ABORT_ERR"
  // A CUSTOM abort reason replaces the platform's `AbortError`, is not
  // recognised, and the request is then treated as a network failure — and
  // because a canonical read is a GET, it is RETRIED three times with backoff.
  // The budget would issue three MORE requests after the caller gave up.
  //
  // This is not hypothetical: `npm run canonical-shadow-runtime-rehearsal`
  // measured exactly three extra requests against the hosted project while the
  // controller aborted with a custom reason. Nothing in this codebase reads
  // `signal.reason`, so the platform default costs nothing and is the only one
  // PostgREST honours.
  let reason = "no abort was observed";
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: {},
    env: { ...ENABLED, [ENV_SHADOW_BUDGET_MS]: "40" },
    loadCanonical: (_scope, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reason = options.signal.reason;
          reject(new Error("aborted"));
        });
      }),
  });
  assert.equal(shadow.status, "canonical_timeout");
  assert.equal(reason?.name, "AbortError", `PostgREST would retry: the abort reason was ${reason?.name ?? reason}`);
});

await checkAsync("el lector recibe una señal VIVA mientras corre", async () => {
  let duringRun = null;
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: {},
    env: ENABLED,
    loadCanonical: async (_scope, options) => {
      duringRun = options.signal.aborted;
      return CANONICAL;
    },
  });
  assert.equal(shadow.status, "compared");
  assert.equal(duringRun, false, "the reader was handed an already-aborted signal");
});

await checkAsync("nada sigue leyendo después del vencimiento", async () => {
  let rounds = 0;
  let stopped = 0;
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: {},
    env: { ...ENABLED, [ENV_SHADOW_BUDGET_MS]: "40" },
    loadCanonical: async (_scope, options) => {
      // A reader that keeps paging until it is told to stop. Without a signal
      // it would still be counting long after the page had answered.
      for (;;) {
        if (options.signal.aborted) {
          stopped = rounds;
          throw new Error("aborted");
        }
        rounds += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
  });
  assert.equal(shadow.status, "canonical_timeout");
  const atReturn = rounds;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(stopped > 0, "the reader never observed the abort");
  assert.equal(rounds, atReturn, `the reader ran ${rounds - atReturn} more rounds after the budget expired`);
});

await checkAsync("un rechazo TARDÍO no queda huérfano", async () => {
  const orphans = [];
  const onUnhandled = (reason) => orphans.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    let failLate = null;
    const shadow = await runShadowComparison({
      scope: SCOPE,
      legacy: LEGACY,
      filters: {},
      env: { ...ENABLED, [ENV_SHADOW_BUDGET_MS]: "40" },
      loadCanonical: () =>
        new Promise((_resolve, reject) => {
          failLate = reject;
        }),
    });
    assert.equal(shadow.status, "canonical_timeout");
    failLate(new Error('late failure quoting "Juan Pérez" and secret-person-1'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(orphans, [], "a late rejection escaped as an unhandled rejection");
    assert.equal(JSON.stringify(LEGACY), LEGACY_SERIALIZED);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

await checkAsync("una resolución que llega DENTRO del aborto no se usa", async () => {
  // THE HARD CASE, and the one a race-decided verdict fails. `abort()`
  // dispatches its listeners synchronously, so this reader settles its promise
  // FULFILLED before the timer's `reject` settles the timeout — and
  // `Promise.race` hands back the document. An implementation that read the
  // verdict off the race would report `compared`, using an answer that arrived
  // after the budget: the worse of the two directions, because it is a wrong
  // number rather than a wrong status.
  //
  // The reader returns a RAW promise on purpose. An `async` function's promise
  // cannot settle inside the abort dispatch, so the shipped reader in
  // `shadow/server.ts` is immune — which is exactly why this needs its own
  // fixture rather than relying on the production shape.
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: {},
    env: { ...ENABLED, [ENV_SHADOW_BUDGET_MS]: "40" },
    loadCanonical: (_scope, options) =>
      new Promise((resolve) => {
        options.signal.addEventListener("abort", () => resolve(CANONICAL));
      }),
  });
  assert.equal(shadow.status, "canonical_timeout", "a document that arrived after the budget was used");
  assert.deepEqual(shadow.findings, []);
  assert.equal(shadow.counts.compared, 0);
});
await checkAsync("y un rechazo que llega DENTRO del aborto sigue siendo un vencimiento", async () => {
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: {},
    env: { ...ENABLED, [ENV_SHADOW_BUDGET_MS]: "40" },
    loadCanonical: (_scope, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted, quoting secret-person-1")));
      }),
  });
  assert.equal(shadow.status, "canonical_timeout", "a budget expiry was reported as a transport error");
  assert.doesNotMatch(JSON.stringify(shadow), /secret-person/);
});
await checkAsync("una resolución TARDÍA se descarta, no se usa", async () => {
  let resolveLate = null;
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: {},
    env: { ...ENABLED, [ENV_SHADOW_BUDGET_MS]: "40" },
    loadCanonical: () => new Promise((resolve) => { resolveLate = resolve; }),
  });
  assert.equal(shadow.status, "canonical_timeout");
  assert.deepEqual(shadow.findings, []);
  resolveLate(CANONICAL);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(shadow.status, "canonical_timeout", "the answer arrived late and was used anyway");
});

await checkAsync("un lector que falla al ARRANCAR no deja el temporizador armado", async () => {
  const orphans = [];
  const onUnhandled = (reason) => orphans.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const shadow = await runShadowComparison({
      scope: SCOPE,
      legacy: LEGACY,
      filters: {},
      env: { ...ENABLED, [ENV_SHADOW_BUDGET_MS]: "40" },
      loadCanonical: () => {
        throw new Error("synchronous failure naming secret-person-1");
      },
    });
    assert.equal(shadow.status, "canonical_transport_error");
    assert.doesNotMatch(JSON.stringify(shadow), /secret-person|synchronous failure/);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(orphans, [], "the budget timer rejected with nobody listening");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

await checkAsync("el orquestador deriva `filtered` de los FILTROS, no de un booleano suelto", async () => {
  // Every other filtered check calls the comparator directly and hands it the
  // boolean. That leaves the seam — `describeFilterScope(filters).filtered`
  // reaching `compareLegacyWithCanonical` — unasserted, and hard-coding
  // `{ filtered: false }` in `orchestrate.ts` would leave them all green.
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: FILTERED_LEGACY,
    filters: NORTE,
    env: ENABLED,
    loadCanonical: async () => CANONICAL,
  });
  assert.equal(shadow.status, "compared");
  assert.deepEqual(shadow.filterScope, { filtered: true, dimensionKeys: ["esfera"], dimensionCount: 1 });
  assert.deepEqual(
    shadow.findings.filter((entry) => entry.agrees !== null).map((entry) => entry.key),
    ["population.measured"],
    "the orchestrator compared something the filter touches",
  );
  assert.equal(shadow.counts.disagreed, 0);
  assert.equal(shadow.counts.compared, 1);
});
await checkAsync("y sin filtros el MISMO camino sigue comparando seis", async () => {
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: {},
    env: ENABLED,
    loadCanonical: async () => CANONICAL,
  });
  assert.equal(shadow.counts.compared, 6);
  assert.equal(shadow.counts.agreed, 6);
  assert.equal(shadow.counts.disagreed, 0);
  assert.deepEqual(shadow.filterScope, { filtered: false, dimensionKeys: [], dimensionCount: 0 });
});
await checkAsync("un valor de filtro vacío NO suprime una comparación que el legado sí hizo", async () => {
  // `?f.esfera=` produces `{ esfera: "" }`. `calc/filters.ts` treats it as
  // inactive, so the legacy payload is study-wide; if the shadow called it
  // filtered it would withhold six comparisons the legacy side really did make.
  const shadow = await runShadowComparison({
    scope: SCOPE,
    legacy: LEGACY,
    filters: { esfera: "" },
    env: ENABLED,
    loadCanonical: async () => CANONICAL,
  });
  assert.equal(shadow.filterScope.filtered, false);
  assert.equal(shadow.counts.compared, 6);
  assert.equal(shadow.counts.agreed, 6);
});

// ===========================================================================
console.log("\n[11] El registro de EJECUCIÓN sólo lleva códigos");

const hostileDiagnostics = () => ({
  status: "compared",
  tenantId: TENANT,
  studyId: STUDY,
  filterScope: { filtered: true, dimensionKeys: ["esfera", "Juan Pérez"], dimensionCount: 2 },
  contractVersion: "2.0.0",
  planFingerprint: `sha256:${"a".repeat(64)}`,
  packageIdempotencyKey: `sha256:${"b".repeat(64)}`,
  budgetMs: 1500,
  elapsedMs: 12,
  counts: { compared: 6, agreed: 6, disagreed: 0, classified: 18 },
  findings: [
    {
      key: "renewal.cri.value",
      section: "renewal",
      classification: "equivalent_after_named_transformation",
      agrees: true,
      mismatch: null,
      legacyValue: 33.04,
      canonicalValue: 33,
      legacyBase: 3,
      canonicalBase: 3,
      rule: "decimals:1",
      noteCode: "cri_precision_differs",
    },
  ],
});

check("una cifra no tiene por dónde entrar", () => {
  const record = runtimeShadowRecord(hostileDiagnostics());
  const serialized = JSON.stringify(record);
  for (const forbidden of ["33.04", "legacyValue", "canonicalValue", "legacyBase", "canonicalBase"]) {
    assert.ok(!serialized.includes(forbidden), `the record carried ${forbidden}`);
  }
  assert.equal(record.findings.length, 1);
  assert.deepEqual(Object.keys(record.findings[0]).sort(), [
    "agrees", "classification", "key", "mismatch", "noteCode", "rule", "section",
  ]);
  // A base of three people is exactly the case the disclosure rule exists for,
  // and it is absent because NO base is ever recorded — not because three was
  // judged too small by something that has to be right every time.
  assert.ok(!serialized.includes('"3"') && !/[^0-9]3[^0-9]/.test(serialized.replace(/"[a-zA-Z]+":/g, "")));
});

check("ni una clave de dimensión, ni un valor de segmento", () => {
  const record = runtimeShadowRecord(hostileDiagnostics());
  assert.equal(record.filtered, true);
  assert.equal(record.filterDimensionCount, 2);
  assert.equal(record.filterDimensionKeys, undefined, "the record carries dimension keys");
  assert.doesNotMatch(JSON.stringify(record), /esfera|Juan|Norte/);
});

check("una cadena arbitraria en un campo cerrado se DESCARTA, no se guarda", () => {
  const hostile = hostileDiagnostics();
  hostile.findings = [
    { ...hostile.findings[0], noteCode: 'duplicate key value violates unique constraint "Juan Pérez"' },
    { ...hostile.findings[0], key: "legacy.metric_keys.csat_atencion_al_socio", section: "renewal" },
    { ...hostile.findings[0], rule: "decimals:99" },
    { ...hostile.findings[0], classification: "totally_made_up" },
    { ...hostile.findings[0], mismatch: "secret-person-1" },
  ];
  const record = runtimeShadowRecord(hostile);
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /Juan|unique constraint|csat_atencion|decimals:99|totally_made_up|secret-person/);
  // A finding whose KEY, SECTION, CLASSIFICATION or RULE is not in the contract
  // is dropped WHOLE. A key nobody proved was safe is, by definition, not safe.
  assert.equal(record.findings.length, 2, JSON.stringify(record.findings));
  assert.equal(record.findings[0].noteCode, null, "an arbitrary note code survived");
  assert.equal(record.findings[1].mismatch, null, "an arbitrary mismatch survived");
});

check("un identificador que no es un uuid, ni una huella que no es un sha256, entran", () => {
  const hostile = hostileDiagnostics();
  hostile.tenantId = "BNI Cuicuilco";
  hostile.studyId = "La voz de las y los Nets";
  hostile.planFingerprint = "el plan que aprobó Juan";
  hostile.packageIdempotencyKey = "secret-person-1";
  hostile.contractVersion = "la versión de siempre";
  hostile.status = "everything_is_fine";
  const record = runtimeShadowRecord(hostile);
  assert.doesNotMatch(JSON.stringify(record), /Cuicuilco|Juan|Nets|secret-person|everything_is_fine|la versión/);
  assert.equal(record.tenantId, "");
  assert.equal(record.planFingerprint, null);
  assert.equal(record.contractVersion, null);
  assert.ok(SHADOW_STATUSES.includes(record.status));
});

check("un total que no es un entero no negativo se vuelve cero", () => {
  const hostile = hostileDiagnostics();
  hostile.counts = { compared: -4, agreed: 1.5, disagreed: Number.NaN, classified: "muchos" };
  hostile.elapsedMs = -1;
  const record = runtimeShadowRecord(hostile);
  assert.deepEqual(record.counts, { compared: 0, agreed: 0, disagreed: 0, classified: 0 });
  assert.equal(record.elapsedMs, 0);
});

check("un diagnóstico REAL pasa entero y sigue sin llevar cifras", () => {
  const findings = unfilteredFindings();
  const record = runtimeShadowRecord({
    status: "compared",
    tenantId: TENANT,
    studyId: STUDY,
    filterScope: describeFilterScope({}),
    contractVersion: "2.0.0",
    planFingerprint: `sha256:${"a".repeat(64)}`,
    packageIdempotencyKey: `sha256:${"b".repeat(64)}`,
    budgetMs: 1500,
    elapsedMs: 7,
    findings,
    counts: { compared: 6, agreed: 6, disagreed: 0, classified: findings.length - 6 },
  });
  assert.equal(record.findings.length, findings.length, "a real finding was dropped by the whitelist");
  assert.equal(record.counts.agreed, 6);
  const serialized = JSON.stringify(record);
  for (const forbidden of ["secret-person", "Norte", "Sur", "acompanamiento", "legacyValue", "canonicalValue"]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

console.log("\n" + "=".repeat(78));
console.log(`RESUMEN: ${passed + failed} comprobaciones, ${passed} aprobadas, ${failed} falladas.`);
if (failed > 0) {
  console.error("RESULTADO: la frontera de la sombra NO se sostiene. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: la sombra está apagada por omisión, se niega fuera de su alcance exacto, acota su " +
    "tiempo, reduce todo fallo a un código seguro, devuelve el pago heredado sin tocarlo y no " +
    "alcanza el navegador por ningún camino de importación.",
);
