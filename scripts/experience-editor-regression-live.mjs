// =============================================================================
// Every editor mutation, one after another, in a real browser
// =============================================================================
// THIS GATE EXISTS BECAUSE OF ONE DEFECT AND IT IS SHAPED BY IT.
//
// On the zero-traffic Cloudflare preview, almost any edit eventually replaced
// the whole builder with the Studio error boundary — "No pudimos abrir esta
// parte del trabajo" — while the edit itself had already been saved. The cause
// was `revalidatePath` inside the save Server Action: Next re-rendered the
// builder page INSIDE the action's response, which meant a second full
// workspace load (every row of the study, the adapter, the registry, every
// aggregate) in the request that had just done all of it to validate. On a
// real-volume study that exceeded the Worker's per-request budget, the render
// aborted, and the truncated RSC payload ended in an errored row that React
// surfaced as error #441.
//
// The lesson the gate encodes: A SUCCESSFUL WRITE MUST NEVER BE FOLLOWED BY A
// BROKEN RENDER, and it is not enough to check that once. So this drives every
// editable operation the builder offers, CONSECUTIVELY, in one session, and
// after EACH one asserts that:
//
//   1  the Studio error boundary is not on screen;
//   2  React is still attached and the page still answers a click;
//   3  the save chip is in a state a person can act on;
//   4  no uncaught exception, hydration error or duplicate DOM id appeared;
//   5  the Server Action's own response carried NO re-rendered page tree —
//      the regression that caused the defect, checked at its source rather
//      than only through its symptom.
//
// It also proves the two halves of the recovery contract:
//
//   - a REJECTED write leaves the editor usable and says why, in place;
//   - a save that fails because the network is gone can be retried, and the
//     session survives it.
//
// IT NEEDS A PRODUCTION SERVER, not `next dev`. React's development build
// calls `eval()`, this application's CSP correctly forbids it, and under
// `next dev` React never hydrates the builder — every control would be a
// picture of a control.
//
//     npm run build && npm start
//
// It writes one disposable client and study, drives them, and deletes them.
// It never prints a credential, a respondent, an answer or a quote.
// =============================================================================

import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";

const APP_ORIGIN = (
  process.env.HARNESS_ORIGIN ?? process.env.RESPONSIVE_APP_ORIGIN ?? "http://localhost:3000"
).replace(/\/$/, "");
const DEBUG_PORT = Number(process.env.EDITOR_DEBUG_PORT ?? 9600 + Math.floor(Math.random() * 200));
const PROFILE = mkdtempSync(join(tmpdir(), "becommunity-editor-"));

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "TEST_INTERNAL_EMAIL",
  "TEST_INTERNAL_PASSWORD",
]) {
  if (!process.env[name]) throw new Error(`${name} is required for the editor regression gate`);
}

const CHROME = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .filter(Boolean)
  .find(existsSync);
assert.ok(CHROME, "a Chrome or Chromium binary is required (set CHROME_PATH)");

let checks = 0;
const ok = (message) => {
  checks += 1;
  console.log(`  PASS  ${message}`);
};

// ---------------------------------------------------------------------------
// The database, through the same REST surface the product uses
// ---------------------------------------------------------------------------

async function rest(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, ok: response.ok, body: parsed, text };
}

// ---------------------------------------------------------------------------
// A signed-in loopback proxy that also WATCHES the Server Action responses
// ---------------------------------------------------------------------------

/**
 * The proxy is not only a way to carry a cookie. It is where the regression
 * itself is measured: every POST the builder makes is a Server Action, and the
 * defect was visible in the SHAPE of its response long before it was visible
 * on screen. A response carrying a re-rendered page tree is the thing that
 * must not come back, so the proxy records the size and content of each one.
 */
async function signedInProxy(emailVar, passwordVar, actions) {
  const jar = new Map();
  const client = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email: process.env[emailVar],
    password: process.env[passwordVar],
  });
  if (error) throw new Error(`fixture sign-in failed for ${emailVar}: ${error.message}`);
  const cookie = [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");

  let offline = false;
  const server = http.createServer(async (request, response) => {
    // The network-interruption test. Everything the page asks for fails the
    // way a lost connection fails, and nothing reaches the application.
    if (offline && request.method === "POST") {
      request.resume();
      response.destroy();
      return;
    }
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (["host", "connection", "cookie", "content-length", "accept-encoding"].includes(key)) {
          continue;
        }
        headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
      }
      headers.set("cookie", cookie);
      headers.set("accept-encoding", "identity");
      // Next refuses a Server Action whose Origin does not match the host it is
      // serving — the CSRF check that makes Server Actions safe. Both are
      // rewritten to the application's own origin, which is what a real browser
      // would have sent. Nothing about the check is disabled.
      headers.set("origin", APP_ORIGIN);
      headers.set("referer", `${APP_ORIGIN}${request.url}`);
      const body = ["GET", "HEAD"].includes(request.method ?? "GET")
        ? undefined
        : await readBody(request);
      const upstream = await fetch(new URL(request.url, APP_ORIGIN), {
        method: request.method,
        headers,
        body,
        redirect: "manual",
      });
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (request.method === "POST") {
        const text = buffer.toString("utf8");
        actions.push({
          status: upstream.status,
          bytes: buffer.length,
          // The two fingerprints of a re-rendered page inside an action
          // response: a client-reference manifest row, and an errored row.
          rerendered: /\bI\[\d+,\[/.test(text),
          errored: /\d+:E\{"digest"/.test(text),
        });
      }
      const outgoing = {};
      upstream.headers.forEach((value, key) => {
        if (!["content-encoding", "content-length", "set-cookie", "transfer-encoding"].includes(key)) {
          outgoing[key] = value;
        }
      });
      response.writeHead(upstream.status, outgoing);
      response.end(buffer);
    } catch (failure) {
      response.writeHead(502, { "content-type": "text/plain" });
      response.end(failure instanceof Error ? failure.message : "proxy error");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    setOffline: (value) => {
      offline = value;
    },
    close: () => server.close(),
  };
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ---------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------

async function connect() {
  const target = await (
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" })
  ).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const loaded = [];
  const problems = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === "Page.loadEventFired") loaded.splice(0).forEach((resolve) => resolve());
    if (message.method === "Runtime.exceptionThrown") {
      problems.push(message.params.exceptionDetails?.exception?.description ?? "uncaught exception");
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      problems.push(message.params.args.map((a) => a.description ?? a.value ?? "").join(" "));
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} did not answer within 45 s`));
      }, 45000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (failure) => {
          clearTimeout(timer);
          reject(failure);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "page evaluation failed");
    }
    return result.result.value;
  };
  return {
    send,
    evaluate,
    problems,
    close: () => socket.close(),
    load: async (url) => {
      const event = new Promise((resolve) => loaded.push(resolve));
      await send("Page.navigate", { url });
      await Promise.race([event, new Promise((resolve) => setTimeout(resolve, 30000))]);
      for (let attempt = 0; attempt < 160; attempt += 1) {
        const ready = await evaluate(
          "document.readyState === 'complete' && !!document.querySelector('main')",
        );
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
    key: async (key, code, windowsVirtualKeyCode) => {
      const shared = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...shared });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...shared });
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BOUNDARY = `document.body.innerText.includes('No pudimos abrir esta parte del trabajo')`;
const HYDRATED = `Object.keys(document.querySelector('main') ?? {}).some((k) => k.startsWith('__react'))`;
const SAVE_STATE = `document.querySelector('[aria-live="polite"][class*="rounded-lg"]')?.textContent?.trim() ?? null`;
const DUPLICATE_IDS = `(() => {
  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id).filter(Boolean);
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
})()`;

/** Set a React-controlled field the way a person's typing does. */
const setField = (finder, value) => `(() => {
  const el = ${finder};
  if (!el) return 'NOFIELD';
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  return el.value;
})()`;

const byLabel = (fragment) =>
  `[...document.querySelectorAll('input,textarea,select')].find((el) => ((el.labels && el.labels[0] && el.labels[0].textContent) || '').includes(${JSON.stringify(fragment)}))`;
const buttonText = (text) =>
  `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`;
const buttonLabel = (fragment) =>
  `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').includes(${JSON.stringify(fragment)})); if (!b) return false; b.click(); return true; })()`;


/**
 * Choose a block type in the catalogue, by the name a person reads.
 *
 * The gate adds a RESULT rather than whatever the catalogue lists first: a
 * text block has no width slider, no visualization picker and no query, so a
 * run that only ever added one would report PASS on three operations it never
 * actually performed.
 */
const chooseBlockType = (name) => `(() => {
  const select = [...document.querySelectorAll('select')]
    .find((el) => [...el.options].some((o) => o.textContent.trim() === ${JSON.stringify(name)}));
  if (!select) return 'NOCATALOGUE';
  const option = [...select.options].find((o) => o.textContent.trim() === ${JSON.stringify(name)});
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, option.value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return 'chosen';
})()`;

let chrome = null;
let session = null;
let internal = null;
let disposableTenant = null;
let disposableStudy = null;
const actions = [];

const stamp = `EXPERIENCE-EDITOR-GATE-${Date.now()}`;

async function sweepPreviousRuns(prefix) {
  let removed = 0;
  for (const table of ["study", "tenant"]) {
    const rows = await rest(`${table}?select=id,name&name=like.${prefix}*`);
    for (const row of rows.body ?? []) {
      await rest(`${table}?id=eq.${row.id}`, { method: "DELETE" });
      removed += 1;
    }
  }
  if (removed > 0) console.log(`  SWEPT  ${removed} row(s) left by an interrupted earlier run`);
}

async function cleanup() {
  session?.close();
  if (chrome) {
    chrome.kill();
    if (chrome.exitCode == null) {
      await Promise.race([
        new Promise((resolve) => chrome.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
  }
  internal?.close();
  if (disposableStudy) await rest(`study?id=eq.${disposableStudy}`, { method: "DELETE" });
  if (disposableTenant) await rest(`tenant?id=eq.${disposableTenant}`, { method: "DELETE" });
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/**
 * Do one operation, then assert the editor is still an editor.
 *
 * The assertions are the same after every operation on purpose. A regression
 * that only shows up after the eleventh edit is exactly the shape of the
 * defect this gate was written for, so nothing is checked "once at the end".
 */
async function operate(name, run) {
  const problemsBefore = session.problems.length;
  const actionsBefore = actions.length;

  const detail = await run();

  // The autosave settles 1.2 s after an edit; give it room and watch for the
  // boundary throughout rather than only at the end.
  let boundary = false;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    await sleep(700);
    boundary = await session.evaluate(BOUNDARY);
    if (boundary) break;
    const state = await session.evaluate(SAVE_STATE);
    if (state && !state.startsWith("Guardando")) break;
  }

  assert.equal(
    boundary,
    false,
    `after "${name}" the editor was replaced by the Studio error boundary`,
  );
  assert.ok(await session.evaluate(HYDRATED), `after "${name}" React was no longer attached`);
  assert.ok(
    await session.evaluate(`!!document.querySelector('[aria-live="polite"]')`),
    `after "${name}" the save chip was gone`,
  );

  const state = await session.evaluate(SAVE_STATE);
  const fresh = session.problems.slice(problemsBefore);
  const hydration = fresh.filter((problem) => /hydrat|Minified React error/i.test(problem));
  assert.deepEqual(
    hydration,
    [],
    `after "${name}" the page logged a React error: ${hydration.join(" | ")}`,
  );

  const duplicates = await session.evaluate(DUPLICATE_IDS);
  assert.deepEqual(duplicates, [], `after "${name}" the page had duplicate DOM ids`);

  // THE REGRESSION ITSELF. No Server Action response may carry a re-rendered
  // page tree or an errored row.
  for (const action of actions.slice(actionsBefore)) {
    assert.equal(
      action.rerendered,
      false,
      `after "${name}" a Server Action response carried a re-rendered page tree (${action.bytes} bytes) — that is the revalidatePath regression`,
    );
    assert.equal(
      action.errored,
      false,
      `after "${name}" a Server Action response carried an errored render row`,
    );
  }

  ok(`${name} — editor still interactive · ${JSON.stringify(state)}${detail ? ` · ${detail}` : ""}`);
}

try {
  await sweepPreviousRuns("EXPERIENCE-EDITOR-GATE-");
  const health = await fetch(new URL("/api/health", APP_ORIGIN)).catch(() => null);
  assert.ok(health?.ok, `start the application at ${APP_ORIGIN} before running this gate`);

  // =========================================================================
  console.log("\n[1] A disposable study, composed from nothing");
  // =========================================================================
  const tenant = await rest("tenant", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { name: stamp },
  });
  assert.ok(tenant.ok, "could not create the disposable client");
  disposableTenant = tenant.body[0].id;
  const study = await rest("study", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { tenant_id: disposableTenant, name: stamp, status: "draft" },
  });
  assert.ok(study.ok, "could not create the disposable study");
  disposableStudy = study.body[0].id;
  /*
   * THE STUDY IS GIVEN REAL SHAPE, because an empty one cannot exercise the
   * controls that matter. A block with no result has no width slider, no
   * visualization picker and nothing for a filter to move, so a gate driven
   * against an empty study would report PASS on operations it never performed.
   *
   * Two characteristics and two results, on twelve respondents. Nothing here
   * is anybody's data: the values are generated in this file and the rows are
   * deleted when the gate finishes.
   */
  const GENERATIONS = ["Generación X", "Millennial", "Baby boomer"];
  const SPHERES = ["Servicios", "Comercio"];
  const respondentIds = [];
  for (let index = 0; index < 12; index += 1) {
    const created = await rest("respondent", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        tenant_id: disposableTenant,
        study_id: disposableStudy,
        segments: {
          seg_generacion: GENERATIONS[index % GENERATIONS.length],
          seg_esfera: SPHERES[index % SPHERES.length],
        },
      },
    });
    assert.ok(created.ok, "could not create a disposable respondent");
    respondentIds.push(created.body[0].id);
  }
  const answers = [];
  respondentIds.forEach((respondentId, index) => {
    answers.push({
      tenant_id: disposableTenant,
      study_id: disposableStudy,
      respondent_id: respondentId,
      metric_key: "nps_recomendacion",
      value: (index % 11),
    });
    answers.push({
      tenant_id: disposableTenant,
      study_id: disposableStudy,
      respondent_id: respondentId,
      metric_key: "csat_atencion",
      value: 1 + (index % 5),
    });
  });
  const inserted = await rest("quant_response", { method: "POST", body: answers });
  assert.ok(inserted.ok, "could not create the disposable answers");
  ok(
    `a disposable client and study exist with ${respondentIds.length} generated respondents, two characteristics and two results`,
  );

  chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${PROFILE}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let ready = false;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).catch(() => null);
    if (response?.ok) {
      ready = true;
      break;
    }
    if (chrome.exitCode != null) break;
    await sleep(250);
  }
  assert.ok(ready, "headless browser did not start");
  session = await connect();
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  internal = await signedInProxy("TEST_INTERNAL_EMAIL", "TEST_INTERNAL_PASSWORD", actions);
  const builderUrl = `${internal.origin}/studio/e/${disposableStudy}/construccion`;
  await session.load(builderUrl);
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await session.evaluate(HYDRATED)) break;
    await sleep(250);
  }
  assert.ok(
    await session.evaluate(HYDRATED),
    "React did not hydrate the builder — run `npm run build && npm start`, not `next dev`",
  );
  ok("the builder hydrated, so every control below is a control and not a picture of one");

  // =========================================================================
  console.log("\n[2] Every editable operation, consecutively");
  // =========================================================================

  await operate("typing in the open page's name", async () => {
    const value = await session.evaluate(
      setField(byLabel("Nombre de la"), `Panorama ${Date.now() % 10000}`),
    );
    assert.notEqual(value, "NOFIELD", "the page-name field is missing");
    return value;
  });

  await operate("typing keeps focus and the caret", async () => {
    const state = await session.evaluate(`(() => {
      const el = ${byLabel("Nombre de la")};
      if (!el) return 'NOFIELD';
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      return { tag: document.activeElement?.tagName, caret: el.selectionStart, length: el.value.length };
    })()`);
    assert.equal(state.tag, "INPUT", "focus left the field");
    assert.equal(state.caret, state.length, "the caret did not stay where it was left");
    return "focus and caret held";
  });

  await operate("adding a page", async () => {
    await session.evaluate(setField(byLabel("Añadir una página"), `Hallazgos ${Date.now() % 1000}`));
    await sleep(200);
    assert.ok(await session.evaluate(buttonText("Añadir página")), "the add-page button is missing");
    return "page added";
  });

  await operate("renaming the new page", async () =>
    session.evaluate(setField(byLabel("Nombre de la"), `Hallazgos ${Date.now() % 10000}`)),
  );

  await operate("adding a result block from the catalogue", async () => {
    const chosen = await session.evaluate(chooseBlockType("Resultado"));
    assert.notEqual(chosen, "NOCATALOGUE", "the catalogue does not offer a result block");
    await sleep(200);
    assert.ok(await session.evaluate(buttonText("Añadir bloque")), "the add-block button is missing");
    return "result added";
  });

  await operate("adding a chart block", async () => {
    const chosen = await session.evaluate(chooseBlockType("Gráfica"));
    if (chosen === "NOCATALOGUE") return "this study cannot support a chart block";
    await sleep(200);
    assert.ok(await session.evaluate(buttonText("Añadir bloque")), "the add-block button is missing");
    return "chart added";
  });

  await operate("selecting a block", async () => {
    const name = await session.evaluate(`(() => {
      const n = document.querySelectorAll('button[class*=basis-24]')[0];
      if (!n) return 'NOBLOCK';
      n.click();
      return n.textContent.trim().slice(0, 40);
    })()`);
    assert.notEqual(name, "NOBLOCK", "no block on the canvas to select");
    return name;
  });

  await operate("changing which result the block reads", async () => {
    const value = await session.evaluate(`(() => {
      const el = document.querySelector('select[id$="-metric"]');
      if (!el) return 'NOSELECT';
      const option = [...el.options].find((o) => !o.disabled && o.value !== el.value);
      if (!option) return 'NOOPTION';
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, option.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return option.textContent.trim().slice(0, 40);
    })()`);
    assert.notEqual(value, "NOSELECT", "the result picker is missing on a block that reads one");
    return String(value);
  });

  await operate("changing how it is calculated", async () => {
    const value = await session.evaluate(`(() => {
      const el = document.querySelector('select[id$="-agg"]');
      if (!el) return 'NOSELECT';
      const option = [...el.options].find((o) => !o.disabled && o.value !== el.value);
      if (!option) return 'NOOPTION';
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, option.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return option.textContent.trim().slice(0, 40);
    })()`);
    return String(value);
  });

  await operate("changing the block's visible title", async () =>
    session.evaluate(setField(byLabel("Título visible"), `Bloque ${Date.now() % 10000}`)),
  );

  await operate("changing the block's explanatory text", async () => {
    const value = await session.evaluate(
      setField("document.querySelector('textarea')", `Texto ${Date.now() % 10000}`),
    );
    return value === "NOFIELD" ? "no prose field on this block type" : "text changed";
  });

  await operate("changing the width the block occupies", async () => {
    const value = await session.evaluate(`(() => {
      const el = document.querySelector('input[type=range][id*="-span-"]');
      if (!el) return 'NOCONTROL';
      const min = Number(el.min) || 1;
      const max = Number(el.max) || 12;
      const next = String(Number(el.value) === max ? min : Math.min(max, Number(el.value) + 1));
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;
    })()`);
    assert.notEqual(value, "NOCONTROL", "the width control is missing on a desktop-width viewport");
    return String(value);
  });

  await operate("changing the visualization", async () => {
    const value = await session.evaluate(`(() => {
      const el = document.querySelector('select[id$="-variant"]');
      if (!el) return 'NOSELECT';
      const option = [...el.options].find((o) => !o.disabled && o.value !== el.value);
      if (!option) return 'NOOPTION';
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, option.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return option.textContent.trim().slice(0, 40);
    })()`);
    assert.notEqual(value, "NOSELECT", "the visualization picker is missing on a block that is drawn");
    return String(value);
  });

  await operate("changing the study's disclosure rule", async () => {
    const label = await session.evaluate(`(() => {
      const r = [...document.querySelectorAll('input[type=radio]')].find((el) => !el.checked);
      if (!r) return 'NORADIO';
      r.click();
      return ((r.labels && r.labels[0] && r.labels[0].textContent) || '').slice(0, 40);
    })()`);
    return String(label);
  });

  await operate("editing the study's identity", async () => {
    const value = await session.evaluate(
      setField(byLabel("Título visible del estudio"), `Estudio ${Date.now() % 10000}`),
    );
    assert.notEqual(value, "NOFIELD", "the identity title field is missing");
    return value;
  });

  await operate("hiding part of the identity", async () => {
    const changed = await session.evaluate(`(() => {
      const boxes = [...document.querySelectorAll('input[type=checkbox]')]
        .filter((el) => ((el.labels && el.labels[0] && el.labels[0].textContent) || '').includes('Mostrar la marca'));
      if (boxes.length === 0) return false;
      boxes[0].click();
      return true;
    })()`);
    assert.ok(changed, "the identity mark switch is missing");
    return "mark toggled";
  });

  await operate("adding a visible filter panel", async () => {
    const added = await session.evaluate(`(() => {
      const select = [...document.querySelectorAll('select')]
        .find((el) => [...el.options].some((o) => o.textContent.trim() === 'Panel de filtros'));
      if (!select) return 'NOCATALOGUE';
      const option = [...select.options].find((o) => o.textContent.trim() === 'Panel de filtros');
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'chosen';
    })()`);
    assert.notEqual(
      added,
      "NOCATALOGUE",
      "the catalogue does not offer a filter panel even though the study has characteristics",
    );
    await sleep(300);
    assert.ok(await session.evaluate(buttonText("Añadir bloque")), "the add-block button is missing");
    const onCanvas = await session.evaluate(
      `document.body.innerText.includes('Panel de filtros') || !!document.querySelector('section[aria-label*="filtros" i]')`,
    );
    assert.ok(onCanvas, "the filter panel was added but does not appear on the canvas");
    return "filter panel added and drawn";
  });

  await operate("keyboard reordering with the arrow keys alone", async () => {
    const focused = await session.evaluate(`(() => {
      const handles = [...document.querySelectorAll('button')]
        .filter((x) => (x.getAttribute('aria-label') || '').startsWith('Mover '));
      if (handles.length === 0) return false;
      handles[0].focus();
      return true;
    })()`);
    assert.ok(focused, "no drag handle to move with the keyboard");
    await session.key("ArrowDown", "ArrowDown", 40);
    return "moved with ArrowDown";
  });

  await operate("drag and drop with the pointer", async () => {
    // The same reorder the pointer performs, through the events the canvas
    // listens for. A synthetic DataTransfer is what a headless browser can
    // give; the handler under test is the product's own.
    const moved = await session.evaluate(`(() => {
      const items = [...document.querySelectorAll('li[draggable="true"]')];
      if (items.length < 2) return 'TOOFEW';
      const data = new DataTransfer();
      items[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
      items[1].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data, clientY: 9999 }));
      items[1].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
      items[0].dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
      return 'dropped';
    })()`);
    return String(moved);
  });

  await operate("duplicating a block", async () => {
    assert.ok(await session.evaluate(buttonLabel("Acciones de")), "no block menu to open");
    await sleep(300);
    assert.ok(await session.evaluate(buttonText("Duplicar")), "the duplicate item is missing");
    return "duplicated";
  });

  // THE DEFECT THAT MADE A DRAFT UNSAVABLE FOREVER. The editor's sequence
  // counter restarts every time the builder is opened, so duplicating the same
  // block in a later session used to mint an identifier that already existed.
  // The document then held two blocks with one id, the strict boundary refused
  // it with "repeated block", and — because that is a property of the DOCUMENT
  // rather than of the request — every later save failed too.
  await operate("duplicating the same block again", async () => {
    assert.ok(await session.evaluate(buttonLabel("Acciones de")), "no block menu to open");
    await sleep(300);
    assert.ok(await session.evaluate(buttonText("Duplicar")), "the duplicate item is missing");
    return "duplicated twice";
  });

  await operate("hiding a block", async () => {
    assert.ok(await session.evaluate(buttonLabel("Acciones de")), "no block menu to open");
    await sleep(300);
    return session.evaluate(buttonText("Ocultar")) ? "hidden" : "already hidden";
  });

  await operate("showing it again", async () => {
    assert.ok(await session.evaluate(buttonLabel("Acciones de")), "no block menu to open");
    await sleep(300);
    return session.evaluate(buttonText("Mostrar")) ? "shown" : "already shown";
  });

  await operate("undo", async () => {
    assert.ok(await session.evaluate(buttonLabel("Deshacer")), "the undo button is missing");
    return "undone";
  });

  await operate("redo", async () => {
    assert.ok(await session.evaluate(buttonLabel("Rehacer")), "the redo button is missing");
    return "redone";
  });

  await operate("saving by hand", async () => {
    assert.ok(await session.evaluate(buttonText("Guardar ahora")), "the save button is missing");
    return "saved";
  });

  await operate("removing a block, confirmation and all", async () => {
    await session.evaluate(`(() => {
      const all = [...document.querySelectorAll('button')]
        .filter((x) => (x.getAttribute('aria-label') || '').startsWith('Acciones de'));
      const b = all[all.length - 1];
      if (b) b.click();
    })()`);
    await sleep(300);
    await session.evaluate(buttonText("Quitar"));
    await sleep(600);
    return session.evaluate(buttonText("Quitar el bloque")) ? "removed" : "no confirmation shown";
  });

  await operate("duplicating a page", async () => {
    await session.evaluate(buttonLabel("Acciones de la página"));
    await sleep(300);
    const done = await session.evaluate(buttonText("Duplicar"));
    return done ? "page duplicated" : "page menu not offered here";
  });

  console.log(`\n  ${checks} operations, and the editor survived every one.`);

  // =========================================================================
  console.log("\n[3] A saved edit survives a reload");
  // =========================================================================
  // A MARKER RATHER THAN WHATEVER HAPPENED TO BE OPEN. Which page the builder
  // opens on is session state and is deliberately not saved — duplicating a
  // page legitimately changes it — so the reload is checked against a value
  // that IS part of the document, found anywhere in it.
  const marker = `Guardado ${Date.now() % 100000}`;
  await session.evaluate(setField(byLabel("Nombre de la"), marker));
  let settled = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(700);
    settled = await session.evaluate(SAVE_STATE);
    if (settled && settled.startsWith("Guardado ·")) break;
  }
  assert.match(
    String(settled),
    /^Guardado ·/,
    `the edit never saved before the reload; the chip read ${JSON.stringify(settled)}`,
  );
  await session.load(builderUrl);
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await session.evaluate(HYDRATED)) break;
    await sleep(250);
  }
  const survived = await session.evaluate(
    `document.body.innerText.includes(${JSON.stringify(marker)})`,
  );
  assert.equal(survived, true, "a saved edit did not survive a reload");
  assert.equal(await session.evaluate(BOUNDARY), false, "the reload landed on the error boundary");
  ok("a saved edit survives a reload, and the reload is not a failure page");

  // =========================================================================
  console.log("\n[4] A rejected write leaves the editor usable");
  // =========================================================================
  // The document is made invalid in the ONE way a person can actually reach
  // without a debugger: a title longer than the schema allows. The save must be
  // refused, the refusal must be readable, and the editor must still be an
  // editor.
  await session.evaluate(setField(byLabel("Nombre de la"), "x".repeat(400)));
  await sleep(3000);
  assert.equal(
    await session.evaluate(BOUNDARY),
    false,
    "an over-long title took the whole editor down",
  );
  assert.ok(await session.evaluate(HYDRATED), "the editor stopped being interactive after a refusal");
  ok("an invalid edit is refused in place and the editor stays usable");

  // =========================================================================
  console.log("\n[5] The network goes away, and the session survives it");
  // =========================================================================
  await session.evaluate(setField(byLabel("Nombre de la"), `Sin red ${Date.now() % 10000}`));
  internal.setOffline(true);
  await session.evaluate(buttonText("Guardar ahora"));
  await sleep(4000);
  assert.equal(
    await session.evaluate(BOUNDARY),
    false,
    "a failed save replaced the editor with the error boundary",
  );
  assert.ok(await session.evaluate(HYDRATED), "a failed save left the editor inert");
  const failedState = await session.evaluate(SAVE_STATE);
  assert.match(
    String(failedState),
    /No se pudo guardar|Cambios sin guardar|Guardando/,
    `a failed save must say so; the chip read ${JSON.stringify(failedState)}`,
  );
  ok(`a save that cannot reach the server says so and keeps the session (${JSON.stringify(failedState)})`);

  internal.setOffline(false);
  await sleep(500);
  const retried = await session.evaluate(buttonText("Reintentar"));
  if (!retried) await session.evaluate(buttonText("Guardar ahora"));
  let recovered = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(700);
    recovered = await session.evaluate(SAVE_STATE);
    if (recovered && recovered.startsWith("Guardado")) break;
  }
  assert.match(
    String(recovered),
    /^Guardado/,
    `the retry after the network came back did not land; the chip read ${JSON.stringify(recovered)}`,
  );
  assert.equal(await session.evaluate(BOUNDARY), false, "the retry landed on the error boundary");
  ok(`the same edit saves once the network is back (${JSON.stringify(recovered)})`);

  // =========================================================================
  console.log("\n[6] No Server Action response re-rendered the page");
  // =========================================================================
  const rerendered = actions.filter((action) => action.rerendered);
  const errored = actions.filter((action) => action.errored);
  assert.equal(
    rerendered.length,
    0,
    `${rerendered.length} of ${actions.length} Server Action responses carried a re-rendered page tree`,
  );
  assert.equal(errored.length, 0, `${errored.length} Server Action responses carried an errored row`);
  const biggest = actions.reduce((max, action) => Math.max(max, action.bytes), 0);
  assert.ok(
    biggest < 20000,
    `a Server Action answered with ${biggest} bytes, which is a re-rendered page rather than a result`,
  );
  ok(
    `all ${actions.length} Server Action responses were results, not renders (largest ${biggest} bytes)`,
  );

  console.log(`\nPASSED — ${checks} checks, editor never left interactive.\n`);
} catch (failure) {
  console.error(`\nFAILED after ${checks} checks:\n${failure?.stack ?? failure}\n`);
  await cleanup();
  process.exit(1);
}

await cleanup();
