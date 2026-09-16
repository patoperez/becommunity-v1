// =============================================================================
// BOUNDED CONDITION WAITING — offline gate
//   npm run test:harness-condition          (part of `npm test`)
// =============================================================================
// It runs everywhere and needs nothing: no browser, no database, no network, no
// credential. The browser-facing half of the harness is proved by the suites
// that drive a real Chrome; what is proved HERE is the part that decided those
// suites' verdicts wrongly, and it is proved by EXECUTING it rather than by
// reading it.
//
// WHY THIS GATE EXISTS
//
// A release QA run against the real edge failed eight assertions twice and then
// passed all of them, on the same Worker version, with the same page content.
// The cause was not the product: the script ticked a filter, slept a fixed five
// seconds, and asserted. A click that costs a server round trip sometimes takes
// longer than five seconds, and a fixed sleep cannot tell a slow answer from a
// wrong one — so a healthy server was reported as a broken screen. Lengthening
// the sleep would have hidden the opposite mistake just as well.
//
// The replacement waits for a NAMED STATE, under an explicit maximum, and says
// which of four things happened. That is what this gate proves.
//
// WHAT IT PROVES
//   1. WHAT IS INJECTED IS WHAT IS CLAIMED. The in-page source carries the
//      caller's own bound, a sampler interval and a MutationObserver, and it
//      issues no application request of any kind.
//   2. THE SAMPLER IS NOT DECORATION. A condition that becomes true WITHOUT a
//      DOM mutation is observed — that is the case a MutationObserver alone
//      never sees, and the reason a bounded interval is in the page at all.
//   3. FOUR OUTCOMES, TOLD APART. Ready, the page's own failure state, the
//      bound exhausted, and the wait never performed. Each is executed.
//   4. A SLOW ANSWER IS NOT HIDDEN. Every outcome reports elapsed time, and a
//      timeout reports the bound it exhausted rather than a bare failure.
//   5. A THROWING PROBE NEVER READS AS READY. The thrown message is carried out
//      beside the outcome, and the outcome is still the bound exhausted.
//   6. NOTHING IS LEFT RUNNING. Observer and interval are released on every
//      path, including the one nobody waits for.
// =============================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { classifyUiWait, uiStateSource } from "./lib/harness-browser.mjs";

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

console.log("Be Community — la espera acotada por condición (offline)");
console.log("=".repeat(78));

// -----------------------------------------------------------------------------
// A scripted page. It is deliberately the smallest thing the injected source
// needs: a document to observe, an observer that fires when the test says the
// DOM changed, and a state object the predicates read. Nothing here simulates a
// browser — it drives the branches the injected source actually has.
// -----------------------------------------------------------------------------
function scriptedPage({ timeoutMs = 200, sampleMs = 10 } = {}) {
  let observers = [];
  let intervals = 0;
  const state = { ready: false, failed: false, explode: false };
  const sandbox = {
    state,
    document: { documentElement: { tag: "html" } },
    performance,
    Promise,
    clearTimeout,
    setTimeout,
    clearInterval: (handle) => { intervals -= 1; clearInterval(handle); },
    setInterval: (fn, ms) => { intervals += 1; return setInterval(fn, ms); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.push(this); }
      disconnect() { observers = observers.filter((entry) => entry !== this); }
    },
  };
  return {
    state,
    timeoutMs,
    sampleMs,
    /** The page changed in a way an observer would see. */
    mutate() { for (const observer of [...observers]) observer.callback(); },
    liveObservers: () => observers.length,
    liveIntervals: () => intervals,
    run(readySource, failedSource) {
      return runInNewContext(uiStateSource(readySource, failedSource, timeoutMs, sampleMs), sandbox);
    },
  };
}

const READY = "() => state.ready";
const FAILED = "() => state.failed";
const THROWS = "() => { if (state.explode) throw new Error('el sondeo no encontró el nodo'); return false; }";

/* --------------------------------------------------------------------------- */
console.log("\n[1] Lo que se inyecta es lo que se afirma");

const sample = uiStateSource(READY, FAILED, 12345, 250);

check("the caller's own maximum is written into the page, not a default", () => {
  assert.match(sample, /setTimeout\(\s*\(\)\s*=>\s*settle\("timeout"\),\s*12345\s*\)/);
});
check("the sampler runs at the caller's own interval", () => {
  assert.match(sample, /setInterval\(.*,\s*250\s*\)/s);
});
check("a MutationObserver watches the whole document", () => {
  assert.match(sample, /new MutationObserver\(/);
  assert.match(sample, /observer\.observe\(document\.documentElement, \{ subtree: true/);
});
check("both predicates are the caller's, verbatim", () => {
  assert.ok(sample.includes(READY), "the ready predicate is not in the injected source");
  assert.ok(sample.includes(FAILED), "the failure predicate is not in the injected source");
});
check("with no failure predicate the page is given one that is never true", () => {
  assert.match(uiStateSource(READY, null, 10, 1), /const failed = \(\) => false;/);
});
check("the injected source issues NO application request", () => {
  for (const forbidden of [/\bfetch\s*\(/, /XMLHttpRequest/, /navigator\.sendBeacon/, /new WebSocket/, /EventSource/]) {
    assert.doesNotMatch(sample, forbidden, `the wait may not contain ${forbidden}`);
  }
});
check("and it contains no loop of its own — the two timers ARE the loop", () => {
  assert.doesNotMatch(sample, /\bwhile\s*\(/);
  assert.doesNotMatch(sample, /\bfor\s*\(/);
});
check("it never rejects, so a caller cannot lose the outcome to an exception", () => {
  assert.doesNotMatch(sample, /\breject\b/);
});

/* --------------------------------------------------------------------------- */
console.log("\n[2] Cuatro desenlaces, ejecutados y distinguidos");

await checkAsync("a condition already true settles READY without waiting for anything", async () => {
  const page = scriptedPage();
  page.state.ready = true;
  const raw = await page.run(READY, FAILED);
  assert.equal(raw.outcome, "ready");
  assert.equal(raw.ticks, 0, "it should not have needed a sampler tick");
  assert.equal(raw.mutations, 0, "it should not have needed a mutation");
  assert.ok(raw.inPageMs < page.timeoutMs, `settled in ${raw.inPageMs}ms, under the ${page.timeoutMs}ms bound`);
});

await checkAsync("a condition that becomes true on a DOM change settles READY on the mutation", async () => {
  const page = scriptedPage({ timeoutMs: 500, sampleMs: 400 });
  const pending = page.run(READY, FAILED);
  page.state.ready = true;
  page.mutate();
  const raw = await pending;
  assert.equal(raw.outcome, "ready");
  assert.equal(raw.mutations, 1);
  assert.equal(raw.ticks, 0, "the sampler must not have been what noticed it");
});

await checkAsync("⭐ a condition that becomes true with NO DOM change is still observed", async () => {
  // THIS IS THE CASE A MutationObserver ALONE NEVER SEES, and the whole reason
  // a bounded sampler is in the page. Nothing mutates; the state simply turns
  // true, exactly as a framework flipping a property on a node already observed
  // would leave it.
  const page = scriptedPage({ timeoutMs: 400, sampleMs: 10 });
  const pending = page.run(READY, FAILED);
  setTimeout(() => { page.state.ready = true; }, 40);
  const raw = await pending;
  assert.equal(raw.outcome, "ready");
  assert.equal(raw.mutations, 0, "no mutation was produced, so none may be reported");
  assert.ok(raw.ticks >= 1, `the sampler must have been what noticed it (ticks=${raw.ticks})`);
});

await checkAsync("the page's OWN failure state settles FAILED, not a timeout", async () => {
  const page = scriptedPage({ timeoutMs: 400, sampleMs: 10 });
  const pending = page.run(READY, FAILED);
  setTimeout(() => { page.state.failed = true; }, 30);
  const raw = await pending;
  assert.equal(raw.outcome, "failed");
  assert.ok(raw.inPageMs < 400, "a named failure must be reported when it appears, not at the bound");
});

await checkAsync("a condition that never holds settles TIMEOUT at the bound, and says so", async () => {
  const page = scriptedPage({ timeoutMs: 120, sampleMs: 10 });
  const raw = await page.run(READY, FAILED);
  assert.equal(raw.outcome, "timeout");
  assert.ok(raw.inPageMs >= 100, `it must have waited the bound out, not returned early (${raw.inPageMs}ms)`);
  assert.ok(raw.ticks >= 1, "and it must have kept looking while it waited");
});

await checkAsync("ready wins over failed when both hold, so a transitional error state cannot steal a pass", async () => {
  const page = scriptedPage();
  page.state.ready = true;
  page.state.failed = true;
  const raw = await page.run(READY, FAILED);
  assert.equal(raw.outcome, "ready");
});

/* --------------------------------------------------------------------------- */
console.log("\n[3] Un sondeo que falla nunca se lee como éxito");

await checkAsync("a predicate that throws is carried out by name, and the outcome is still the bound", async () => {
  const page = scriptedPage({ timeoutMs: 120, sampleMs: 10 });
  page.state.explode = true;
  const raw = await page.run(THROWS, FAILED);
  assert.equal(raw.outcome, "timeout", "a throwing probe must never resolve READY");
  assert.match(String(raw.predicateError), /el sondeo no encontró el nodo/);
});

await checkAsync("a predicate that throws and then recovers still settles READY", async () => {
  const page = scriptedPage({ timeoutMs: 400, sampleMs: 10 });
  page.state.explode = true;
  const pending = page.run("() => { if (state.explode) throw new Error('todavía no'); return state.ready; }", FAILED);
  setTimeout(() => { page.state.explode = false; page.state.ready = true; }, 30);
  const raw = await pending;
  assert.equal(raw.outcome, "ready");
  assert.match(String(raw.predicateError), /todavía no/, "the earlier throw is still reported");
});

/* --------------------------------------------------------------------------- */
console.log("\n[4] Nada queda corriendo");

for (const [label, prepare] of [
  ["ready", (page) => { page.state.ready = true; }],
  ["failed", (page) => { page.state.failed = true; }],
  ["timeout", () => {}],
]) {
  await checkAsync(`after a ${label} outcome the observer is disconnected and the interval cleared`, async () => {
    const page = scriptedPage({ timeoutMs: 120, sampleMs: 10 });
    prepare(page);
    await page.run(READY, FAILED);
    assert.equal(page.liveObservers(), 0, "an observer is still attached");
    assert.equal(page.liveIntervals(), 0, "an interval is still running");
  });
}

/* --------------------------------------------------------------------------- */
console.log("\n[5] El clasificador: cinco lecturas, y el tiempo en todas");

const RAW_READY = { outcome: "ready", inPageMs: 40, ticks: 2, mutations: 1, predicateError: null };

check("a ready outcome is ok, and keeps both clocks", () => {
  const verdict = classifyUiWait({ raw: RAW_READY, elapsedMs: 55, what: "el panel" });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.kind, "ready");
  assert.equal(verdict.elapsedMs, 55);
  assert.equal(verdict.inPageMs, 40);
  assert.equal(verdict.what, "el panel");
});
check("a named failure reads APPLICATION, and is not ok", () => {
  const verdict = classifyUiWait({ raw: { ...RAW_READY, outcome: "failed" }, elapsedMs: 55, what: "el panel" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.kind, "application");
});
check("an exhausted bound reads TIMEOUT", () => {
  const verdict = classifyUiWait({ raw: { ...RAW_READY, outcome: "timeout" }, elapsedMs: 5000, what: "el panel" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.kind, "timeout");
  assert.equal(verdict.elapsedMs, 5000);
});
check("a lost page or session reads BROWSER, and carries what the runtime said", () => {
  const verdict = classifyUiWait({
    error: new Error("Inspected target navigated or closed"),
    elapsedMs: 12,
    what: "el panel",
  });
  assert.equal(verdict.kind, "browser");
  assert.match(verdict.detail, /navigated or closed/);
});
check("a CDP session that no longer exists also reads BROWSER", () => {
  assert.equal(classifyUiWait({ error: new Error("CDP Session with given id not found"), elapsedMs: 1 }).kind, "browser");
});
check("a malformed probe reads PROBE, because it is fixed in a different file", () => {
  assert.equal(classifyUiWait({ error: new SyntaxError("Unexpected token ')'"), elapsedMs: 1 }).kind, "probe");
  assert.equal(classifyUiWait({ error: new Error("test is not a function"), elapsedMs: 1 }).kind, "probe");
});
check("an outcome that is not an object reads PROBE rather than being trusted", () => {
  const verdict = classifyUiWait({ raw: true, elapsedMs: 1 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.kind, "probe");
});
check("a predicate error travels beside every outcome that had one, and is absent otherwise", () => {
  assert.equal("predicateError" in classifyUiWait({ raw: RAW_READY, elapsedMs: 1 }), false);
  assert.equal(
    classifyUiWait({ raw: { ...RAW_READY, outcome: "timeout", predicateError: "sin nodo" }, elapsedMs: 1 }).predicateError,
    "sin nodo",
  );
});
check("EVERY reading reports elapsed time — a slow answer can never be printed as a bare failure", () => {
  const readings = [
    classifyUiWait({ raw: RAW_READY, elapsedMs: 1 }),
    classifyUiWait({ raw: { ...RAW_READY, outcome: "failed" }, elapsedMs: 2 }),
    classifyUiWait({ raw: { ...RAW_READY, outcome: "timeout" }, elapsedMs: 3 }),
    classifyUiWait({ error: new Error("x"), elapsedMs: 4 }),
    classifyUiWait({ raw: null, elapsedMs: 5 }),
  ];
  for (const reading of readings) assert.equal(typeof reading.elapsedMs, "number");
  assert.deepEqual(readings.map((reading) => reading.elapsedMs), [1, 2, 3, 4, 5]);
});

/* --------------------------------------------------------------------------- */
console.log("\n[6] El cableado del método sobre la página");

const harness = readFileSync(new URL("./lib/harness-browser.mjs", import.meta.url), "utf8");

check("the page object exposes the wait", () => {
  assert.match(harness, /async awaitUiState\(readySource, \{/);
});
check("its bound defaults to the harness's own DOM deadline rather than to nothing", () => {
  assert.match(harness, /awaitUiState\([^)]*timeoutMs = DOM_MS/s);
});
check("both the resolved and the thrown path go through the ONE classifier", () => {
  const body = harness.slice(harness.indexOf("async awaitUiState"), harness.indexOf("async awaitUiState") + 1400);
  assert.equal((body.match(/classifyUiWait\(/g) ?? []).length, 2, "both paths must classify");
  assert.match(body, /catch \(error\) \{\s*return classifyUiWait\(\{ error/);
});
check("elapsed time is taken from the monotonic clock, not from the wall clock", () => {
  const body = harness.slice(harness.indexOf("async awaitUiState"), harness.indexOf("async awaitUiState") + 1400);
  assert.match(body, /process\.hrtime\.bigint\(\)/);
  assert.doesNotMatch(body, /Date\.now\(\)/);
});
check("`waitForDom` is untouched, so nothing that already depended on it moved", () => {
  assert.match(harness, /waitForDom\(predicateSource, timeoutMs = DOM_MS\) \{\s*return context\.evaluate\(WAIT_FOR_DOM\(predicateSource, timeoutMs\), \{ awaitPromise: true \}\);/);
});

console.log("\n" + "=".repeat(78));
console.log(`RESUMEN: ${passed + failed} comprobaciones, ${passed} aprobadas, ${failed} falladas.`);
if (failed > 0) {
  console.error("RESULTADO: la espera acotada NO cumple su contrato. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: la espera observa el estado de la interfaz bajo un máximo explícito, distingue listo, " +
    "fallo de la aplicación, tiempo agotado y navegador perdido, informa el tiempo transcurrido en " +
    "todos los casos, nunca lee un sondeo roto como éxito y no deja nada corriendo.",
);
