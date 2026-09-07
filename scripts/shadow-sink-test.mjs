// =============================================================================
// The SERVER-ONLY DIAGNOSTIC SINK — offline gate
//   npm run test:shadow-sink                (part of `npm test`)
// =============================================================================
// It runs everywhere and needs nothing: no database, no network, no credential.
//
// WHY IT IS A SEPARATE SCRIPT FROM `shadow-boundary-test.mjs`. `sink.ts` opens
// with `import "server-only"`, which throws under plain Node by design — that
// marker is the guard that fails the BUILD if the module is ever pulled into a
// client bundle, and no gate may weaken it. The marker resolves to an empty
// module under the `react-server` export condition, the same condition the
// React Server Component runtime supplies, so this script runs with
// `--conditions=react-server` and exercises the REAL module without patching,
// stubbing or copying it. The boundary gate keeps running without that
// condition, so it still proves the marker is where it should be.
//
// WHAT IT PROVES
//   1. THE SHIPPED STATE IS A NO-OP. With no sink installed nothing is
//      recorded, nothing is projected, and `recordShadowRun` returns. There is
//      no environment variable that could turn it on: only a call from code
//      running in this process can.
//   2. IT CANNOT ALTER OR FAIL A REQUEST. A sink that throws, a sink that is
//      not a function, a diagnostics object that is malformed — none of them
//      escapes, and `recordShadowRun` returns `undefined` on every path.
//   3. ONLY CODES AND TOTALS CROSS. A respondent value, a segment value, a
//      database message, a qualitative phrase and a small-sample aggregate are
//      each fed in and each fails to appear.
//   4. IT ADDS NO ENDPOINT. The module builds no server, no handler and no
//      response; the way in is a function call in the same process.
// =============================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

console.log("Be Community — el sumidero de diagnóstico de la sombra (offline)");
console.log("=".repeat(78));

let sink;
try {
  sink = await import("../src/lib/shadow/sink.ts");
} catch (thrown) {
  console.error(
    "REFUSED: `server-only` refused to load. Run this through `npm run test:shadow-sink`, " +
      "which supplies --conditions=react-server.",
  );
  console.error("      ", thrown instanceof Error ? thrown.message.split("\n")[0] : String(thrown));
  process.exit(2);
}
const {
  MAX_SHADOW_RECORD_BUFFER,
  clearShadowDiagnosticSink,
  hasShadowDiagnosticSink,
  installShadowDiagnosticBuffer,
  recordShadowRun,
  setShadowDiagnosticSink,
} = sink;

const TENANT = "11111111-1111-4111-8111-111111111111";
const STUDY = "22222222-2222-4222-8222-222222222222";

/**
 * A diagnostics object carrying, in every field that could hold one, exactly
 * the kind of value this contract exists to keep out.
 */
const hostileDiagnostics = () => ({
  status: "compared",
  tenantId: TENANT,
  studyId: STUDY,
  filterScope: { filtered: true, dimensionKeys: ["esfera", "correo_socio"], dimensionCount: 2 },
  contractVersion: "2.0.0",
  planFingerprint: `sha256:${"a".repeat(64)}`,
  packageIdempotencyKey: `sha256:${"b".repeat(64)}`,
  budgetMs: 1500,
  elapsedMs: 9,
  counts: { compared: 6, agreed: 6, disagreed: 0, classified: 18 },
  findings: [
    {
      key: "renewal.cri.value",
      section: "renewal",
      classification: "equivalent_after_named_transformation",
      agrees: true,
      mismatch: null,
      // A three-person base is exactly the case the disclosure rule exists for.
      legacyValue: 41.2,
      canonicalValue: 41.2,
      legacyBase: 3,
      canonicalBase: 3,
      rule: "decimals:1",
      noteCode: "cri_precision_differs",
    },
    {
      key: "recommendation.nps.combinado.value",
      section: "recommendation",
      classification: "equivalent_after_named_transformation",
      agrees: false,
      mismatch: "value",
      legacyValue: 30.8,
      canonicalValue: 12.5,
      legacyBase: 39,
      canonicalBase: 39,
      rule: "decimals:1",
      // A database message, in the field that used to accept any string.
      noteCode: 'duplicate key value violates unique constraint on "Juan Pérez"',
    },
  ],
});

const FORBIDDEN = [
  "Juan",
  "unique constraint",
  "esfera",
  "correo_socio",
  "41.2",
  "30.8",
  "12.5",
  "legacyValue",
  "canonicalValue",
  "legacyBase",
  "canonicalBase",
  "dimensionKeys",
];

// ===========================================================================
console.log("\n[1] Lo que se entrega es inerte");
check("no hay sumidero instalado al cargar el módulo", () => {
  assert.equal(hasShadowDiagnosticSink(), false);
});
check("registrar sin sumidero no hace nada y no devuelve nada", () => {
  assert.equal(recordShadowRun(hostileDiagnostics()), undefined);
  assert.equal(hasShadowDiagnosticSink(), false);
});
check("y no falla con un diagnóstico deforme, nulo o ausente", () => {
  for (const value of [null, undefined, {}, 7, "compared", []]) {
    assert.equal(recordShadowRun(value), undefined, String(value));
  }
});
check("el módulo no lee NINGUNA variable de entorno", () => {
  // A flag could be set on a deployment by somebody who never read the file.
  // A function call cannot, which is why there is no flag.
  const code = readFileSync(join("src", "lib", "shadow", "sink.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  assert.ok(!/process\.env/.test(code), "the sink reads an environment variable");
  assert.ok(!/@supabase|createClient\(|\bfetch\(|node:/.test(code), "the sink has a transport");
});
check("el módulo no construye ningún endpoint", () => {
  const code = readFileSync(join("src", "lib", "shadow", "sink.ts"), "utf8");
  assert.ok(!/createServer|new Response\(|express|Router\(|NextResponse/.test(code));
});
check("y el punto de entrada de la sombra sí lo llama", () => {
  // A sink nothing calls is a contract nothing keeps.
  const server = readFileSync(join("src", "lib", "shadow", "server.ts"), "utf8");
  assert.match(server, /import \{ recordShadowRun \} from "\.\/sink";/);
  assert.match(server, /recordShadowRun\(diagnostics\);/);
  // AFTER the diagnostics are complete, and the diagnostics are what is
  // returned — the sink is not in the value's path.
  assert.ok(
    server.indexOf("recordShadowRun(diagnostics);") < server.indexOf("return diagnostics;"),
    "the sink runs after the value is returned",
  );
});

// ===========================================================================
console.log("\n[2] Un sumidero instalado recibe códigos y totales, nada más");
check("una corrida llega como registro, y sin una sola cifra de negocio", () => {
  const seen = [];
  const previous = setShadowDiagnosticSink((record) => seen.push(record));
  try {
    recordShadowRun(hostileDiagnostics());
  } finally {
    setShadowDiagnosticSink(previous);
  }
  assert.equal(seen.length, 1);
  const serialized = JSON.stringify(seen[0]);
  for (const forbidden of FORBIDDEN) {
    assert.ok(!serialized.includes(forbidden), `the record carried '${forbidden}'`);
  }
  assert.equal(seen[0].status, "compared");
  assert.equal(seen[0].filtered, true);
  assert.equal(seen[0].filterDimensionCount, 2);
  assert.deepEqual(seen[0].counts, { compared: 6, agreed: 6, disagreed: 0, classified: 18 });
});
check("un código de nota arbitrario se descarta; el válido sobrevive", () => {
  const seen = [];
  const previous = setShadowDiagnosticSink((record) => seen.push(record));
  try {
    recordShadowRun(hostileDiagnostics());
  } finally {
    setShadowDiagnosticSink(previous);
  }
  const [good, bad] = seen[0].findings;
  assert.equal(good.noteCode, "cri_precision_differs");
  assert.equal(bad.noteCode, null, "a database message survived as a note code");
  assert.equal(bad.agrees, false, "the verdict itself must still be recorded");
  assert.equal(bad.mismatch, "value");
});
check("un sumidero que LANZA no se propaga", () => {
  const previous = setShadowDiagnosticSink(() => {
    throw new Error("the sink exploded while reading secret-person-1");
  });
  try {
    assert.equal(recordShadowRun(hostileDiagnostics()), undefined);
  } finally {
    setShadowDiagnosticSink(previous);
  }
});
await checkAsync("y un sumidero ASÍNCRONO que rechaza tampoco", async () => {
  // A `try/catch` alone does NOT cover this, which is the whole point.
  // `ShadowDiagnosticSink` returns `void`, and TypeScript's void-return
  // assignability accepts an `async` function against that signature with no
  // error at all — so its rejection would sail past the `catch` and land in a
  // request as an unhandled rejection. Nothing in a `.mjs` gate is typechecked,
  // so the only way to know is to install one and watch.
  const orphans = [];
  const onUnhandled = (reason) => orphans.push(reason);
  process.on("unhandledRejection", onUnhandled);
  const previous = setShadowDiagnosticSink(async () => {
    throw new Error("the async sink exploded while reading secret-person-1");
  });
  try {
    assert.equal(recordShadowRun(hostileDiagnostics()), undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(orphans, [], "an async sink's rejection escaped into the process");
  } finally {
    setShadowDiagnosticSink(previous);
    process.off("unhandledRejection", onUnhandled);
  }
});
await checkAsync("y un `thenable` escrito a mano tampoco", async () => {
  const orphans = [];
  const onUnhandled = (reason) => orphans.push(reason);
  process.on("unhandledRejection", onUnhandled);
  const previous = setShadowDiagnosticSink(() => ({
    then: (_resolve, reject) => reject(new Error("a hand-rolled thenable exploded")),
  }));
  try {
    assert.equal(recordShadowRun(hostileDiagnostics()), undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(orphans, []);
  } finally {
    setShadowDiagnosticSink(previous);
    process.off("unhandledRejection", onUnhandled);
  }
});
check("algo que no es una función no se instala", () => {
  for (const value of ["sink", 7, {}, [], true]) {
    setShadowDiagnosticSink(value);
    assert.equal(hasShadowDiagnosticSink(), false, String(value));
  }
  clearShadowDiagnosticSink();
});

// ===========================================================================
console.log("\n[3] El operador interno mira por una función, no por una ruta");
check("el búfer recoge lo que se registra y devuelve copias", () => {
  const buffer = installShadowDiagnosticBuffer({ capacity: 4 });
  try {
    assert.equal(hasShadowDiagnosticSink(), true);
    recordShadowRun(hostileDiagnostics());
    recordShadowRun(hostileDiagnostics());
    const first = buffer.records();
    assert.equal(first.length, 2);
    // EVERY level, not just the top one. `counts` is a nested object, and a
    // shallow spread hands out the buffer's own reference — so a caller could
    // rewrite the totals of a run that has already been recorded.
    first[0].status = "mangled";
    first[0].counts.compared = 9999;
    first[0].findings[0].key = "mangled";
    const second = buffer.records();
    assert.equal(second[0].status, "compared", "the buffer handed out a live reference");
    assert.equal(second[0].counts.compared, 6, "the buffer handed out its own `counts` object");
    assert.equal(second[0].findings[0].key, "renewal.cri.value");
  } finally {
    buffer.dispose();
  }
});
check("el búfer está acotado y descarta lo más viejo", () => {
  const buffer = installShadowDiagnosticBuffer({ capacity: 3 });
  try {
    for (let index = 0; index < 10; index += 1) recordShadowRun(hostileDiagnostics());
    assert.equal(buffer.records().length, 3);
  } finally {
    buffer.dispose();
  }
});
check("una capacidad absurda se recorta al techo del módulo", () => {
  for (const requested of [0, -1, Number.NaN, 1.5, "muchos", 10_000]) {
    const buffer = installShadowDiagnosticBuffer({ capacity: requested });
    try {
      for (let index = 0; index < MAX_SHADOW_RECORD_BUFFER + 5; index += 1) recordShadowRun(hostileDiagnostics());
      assert.ok(buffer.records().length <= MAX_SHADOW_RECORD_BUFFER, String(requested));
    } finally {
      buffer.dispose();
    }
  }
});
check("descartar el búfer devuelve el módulo a su estado inerte", () => {
  const buffer = installShadowDiagnosticBuffer();
  buffer.dispose();
  assert.equal(hasShadowDiagnosticSink(), false);
  recordShadowRun(hostileDiagnostics());
  assert.equal(buffer.records().length, 0);
});
check("dos búferes anidados se restauran en orden", () => {
  const outer = installShadowDiagnosticBuffer();
  const inner = installShadowDiagnosticBuffer();
  recordShadowRun(hostileDiagnostics());
  inner.dispose();
  recordShadowRun(hostileDiagnostics());
  outer.dispose();
  assert.equal(inner.records().length, 1);
  assert.equal(outer.records().length, 1);
  assert.equal(hasShadowDiagnosticSink(), false);
});

console.log("\n" + "=".repeat(78));
console.log(`RESUMEN: ${passed + failed} comprobaciones, ${passed} aprobadas, ${failed} falladas.`);
if (failed > 0) {
  console.error("RESULTADO: el sumidero de diagnóstico NO cumple su contrato. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: el sumidero es inerte por omisión, no lee el entorno, no puede alterar ni fallar una " +
    "respuesta, registra sólo códigos cerrados y totales, y se inspecciona por una llamada en el " +
    "mismo proceso y no por una ruta.",
);
