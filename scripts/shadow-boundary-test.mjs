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
  COMPATIBILITY_CLASSIFICATIONS,
  MISMATCH_KINDS,
  SHADOW_STATUSES,
  compareLegacyWithCanonical,
  filterFingerprint,
  parseLegacyBase,
  parseLegacyNumber,
  parseShadowBudget,
  parseShadowScopes,
  resolveShadowPolicy,
  runShadowComparison,
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
  assert.match(tdp.note, /unawareShareOfResponses/);
  assert.match(tdp.note, /NOT touchpoints\[\]\.tdp/);
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
  assert.match(shadow.filterFingerprint, /^sha256:[0-9a-f]{64}$/);
});
check("una selección vacía tiene una huella estable y sin valores", () => {
  assert.equal(filterFingerprint({}), "sha256:unfiltered");
  assert.equal(filterFingerprint({ esfera: "Norte" }), filterFingerprint({ esfera: "Norte" }));
  assert.notEqual(filterFingerprint({ esfera: "Norte" }), filterFingerprint({ esfera: "Sur" }));
  assert.doesNotMatch(filterFingerprint({ esfera: "Norte" }), /Norte/);
});
check("el contrato del hallazgo no tiene un lugar donde poner a una persona", () => {
  // The FIELD NAMES, not the prose around them: the comments deliberately say
  // the word "message" while explaining that no field may carry one, and a scan
  // that could not tell the two apart would either fail here or be loosened
  // until it proved nothing.
  const source = readFileSync(join("src", "lib", "shadow", "contract.ts"), "utf8");
  const block = source.slice(source.indexOf("export type ShadowFinding"), source.indexOf("/** The complete, safe result"));
  const withoutComments = block.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const fieldNames = [...withoutComments.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((match) => match[1]);
  assert.deepEqual(
    [...fieldNames].sort(),
    [
      "agrees", "canonicalBase", "canonicalValue", "classification", "key",
      "legacyBase", "legacyValue", "mismatch", "note", "rule", "section",
    ],
    "the finding's field list changed; every field must be provably non-personal",
  );
  for (const forbidden of ["respondent", "quote", "person", "email", "message", "segment", "text", "label"]) {
    assert.ok(
      !fieldNames.some((name) => name.toLowerCase().includes(forbidden)),
      `ShadowFinding has a field named for '${forbidden}'`,
    );
  }
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
  const APPROVED_LOADER = "src/lib/studies/study-dashboard.ts";
  const APPROVED_PAGE = "src/app/insights/e/[studyId]/page.tsx";

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

  check("exactamente UNA página alcanza la capa canónica, y por la puerta aprobada", () => {
    const pages = appFiles.filter((path) => /page\.tsx$/.test(path));
    const reaching = [];
    for (const page of pages) {
      const paths = reachable(page);
      const leak = [...paths.keys()].find(isCanonical);
      if (leak) reaching.push({ page: page.replace(/\\/g, "/"), path: paths.get(leak) });
    }
    assert.equal(reaching.length, 1, `pages reaching the canonical layer: ${reaching.map((r) => r.page).join(", ")}`);
    assert.equal(reaching[0].page, APPROVED_PAGE);
    const chain = reaching[0].path;
    assert.ok(chain.includes(APPROVED_LOADER), `the chain skips the approved loader: ${JSON.stringify(chain)}`);
    assert.ok(chain.includes("src/lib/shadow/server.ts"), `the chain skips the orchestrator: ${JSON.stringify(chain)}`);
  });

  check("sólo el orquestador server-only nombra la lectura canónica", () => {
    const shadowFiles = readdirSync(join("src", "lib", "shadow")).map((name) => join("src", "lib", "shadow", name));
    const naming = shadowFiles.filter((path) => /canonical-source/.test(stripComments(readFileSync(path, "utf8"))));
    assert.deepEqual(naming.map((p) => p.replace(/\\/g, "/")), ["src/lib/shadow/server.ts"]);
  });

  check("sólo `server.ts` de la sombra es server-only y sólo él toca el entorno", () => {
    const shadowFiles = readdirSync(join("src", "lib", "shadow"));
    const serverOnly = shadowFiles.filter((name) =>
      /^\s*import\s+["']server-only["']/m.test(readFileSync(join("src", "lib", "shadow", name), "utf8")),
    );
    assert.deepEqual(serverOnly, ["server.ts"]);
    const pure = shadowFiles.filter((name) => name !== "server.ts");
    for (const name of pure) {
      const code = stripComments(readFileSync(join("src", "lib", "shadow", name), "utf8"));
      assert.ok(!/process\.env|@supabase|createClient\(|createAdminClient|\bfetch\(|node:/.test(code), name);
    }
  });

  check("el barril seguro de la sombra no reexporta el punto de entrada", () => {
    const barrel = stripComments(readFileSync(join("src", "lib", "shadow", "index.ts"), "utf8"));
    assert.ok(!/from\s+["']\.\/server["']/.test(barrel));
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
    const WRITE_PATH = /canonical-commit\/(adapter|server|flow|projector)\.ts$/;
    const READ_ONLY_BUILDER_METHODS = new Set(["from", "select", "eq", "or", "order", "limit", "returns", "gt"]);
    const paths = reachable("src/lib/shadow/server.ts");
    const mutators = [];
    for (const file of paths.keys()) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (WRITE_PATH.test(file)) mutators.push(`${file} (write path)`);
      const holdsClient = /@supabase\/supabase-js|createAdminClient|createClient\(|\.from\(/.test(code);
      if (!holdsClient) continue;
      for (const match of code.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) {
        const method = match[1];
        if (/^(insert|update|upsert|delete|rpc)$/.test(method) && !READ_ONLY_BUILDER_METHODS.has(method)) {
          mutators.push(`${file} (.${method}())`);
        }
      }
    }
    assert.deepEqual(mutators, []);
    assert.ok(paths.size > 10, `only ${paths.size} modules reachable from the shadow entry point`);
    assert.ok([...paths.keys()].some((file) => /canonical-source\/adapter\.ts$/.test(file)), "the read adapter is unreachable");
  });

  check("el modelo de resultados sigue sin transporte y sin server-only", () => {
    for (const path of walk(join("src", "lib", "results"))) {
      const code = stripComments(readFileSync(path, "utf8"));
      assert.ok(!/@supabase|createClient\(|\.rpc\(|\bfetch\(|node:|process\.env/.test(code), path);
      assert.ok(!/^\s*import\s+["']server-only["']/m.test(code), path);
    }
  });
}

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
