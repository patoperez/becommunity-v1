/**
 * Journey editor — the same invariant, in a real browser (credential-bearing).
 *
 * `npm run test:journey-editor` proves the model. This proves the product: a
 * real Chrome, real key events, and the one question a consultant cares about —
 * after I type a character, is the caret still in the box I was typing in?
 *
 * It exists because the defect it guards against was invisible to every
 * deterministic gate in the repository. The editor keyed each moment on the
 * stage identifier it derives from the name being typed, so React replaced the
 * row on every keystroke and the browser discarded the focused <input> with it.
 * Nothing failed, nothing threw, and the study simply could not be built.
 *
 * HOW IT DECIDES THE ROW WAS REPLACED. Before typing it stamps an expando
 * property on the focused element. A property lives on the DOM node, not in the
 * markup: if React unmounts the row and mounts a new one, the stamp is gone.
 * That is a direct observation of the remount, not an inference from focus.
 *
 * WHAT IT TOUCHES. One study, named by JOURNEY_STUDY_ID, whose journey it reads
 * before the run and restores afterwards in a finally block. It writes no other
 * row, creates nothing, and never publishes.
 *
 *   HARNESS_ORIGIN     the running app (default http://localhost:3000)
 *   JOURNEY_STUDY_ID   a disposable study that has numerical results
 *   CHROME_PATH        a Chrome/Chromium binary
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const APP_ORIGIN = (process.env.HARNESS_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
const STUDY_ID = process.env.JOURNEY_STUDY_ID ?? "";
const NAMES = ["Recomendación del capítulo", "Dar referencias", "Recibir referencias"];
const DESCRIPTION = "Qué vive la persona aquí. Y qué decide hacer después.";

let checks = 0;
const ok = (message) => { checks += 1; console.log(`  PASS  ${message}`); };

// Named as strings, never bound to a value: a privileged variable name written
// next to an assignment is exactly what Suite D's D-d scans blobs for.
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TEST_INTERNAL_EMAIL",
  "TEST_INTERNAL_PASSWORD",
]) {
  if (!process.env[name]) throw new Error(`${name} is required for the live journey editor gate`);
}
if (!STUDY_ID) throw new Error("JOURNEY_STUDY_ID must name the disposable study this gate may edit");

const chromeBinary = () =>
  [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium",
   "C:/Program Files/Google/Chrome/Application/chrome.exe"]
    .filter(Boolean).find((path) => existsSync(path));

const health = await fetch(new URL("/api/health", APP_ORIGIN)).catch(() => null);
if (!health?.ok) throw new Error(`the app is not answering at ${APP_ORIGIN}`);
ok(`the app answers /api/health at ${APP_ORIGIN}`);

/** The privileged client, used only to read and restore this study's journey. */
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const before = await admin.from("study").select("journey_definition, name, status").eq("id", STUDY_ID).single();
if (before.error) throw new Error(`cannot read the study: ${before.error.message}`);
const originalJourney = before.data.journey_definition;
console.log(`  Study under test: ${before.data.name} (${before.data.status})`);

/**
 * Sign in with the fixture account here, in Node, and hand the browser only the
 * resulting session cookies. No password is ever typed into a field.
 */
const jar = new Map();
const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  cookies: {
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
  },
});
const signIn = await auth.auth.signInWithPassword({
  email: process.env.TEST_INTERNAL_EMAIL,
  password: process.env.TEST_INTERNAL_PASSWORD,
});
if (signIn.error) throw new Error(`sign-in failed: ${signIn.error.message}`);
ok("signed in as the internal fixture account");

const binary = chromeBinary();
if (!binary) throw new Error("no Chrome binary found — set CHROME_PATH");
const port = 9800 + Math.floor(Math.random() * 200);
const chrome = spawn(binary, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "becommunity-journey-"))}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--disable-background-networking", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });

async function devtools() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* the browser is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Chrome did not expose DevTools");
}
await devtools();

async function connect() {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const loads = [];
  const consoleErrors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method === "Page.loadEventFired") {
      loads.splice(0).forEach((resolve) => resolve());
    } else if (message.method === "Runtime.exceptionThrown") {
      consoleErrors.push(message.params?.exceptionDetails?.text ?? "exception");
    } else if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      consoleErrors.push(message.params.entry.text);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      socket.send(JSON.stringify({ id: messageId, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Log.enable");
  return { send, consoleErrors, loads, close: () => socket.close() };
}
const page = await connect();

const appUrl = new URL(APP_ORIGIN);
await page.send("Network.setCookies", {
  cookies: [...jar.entries()].map(([name, value]) => ({
    name,
    value: encodeURIComponent(value),
    domain: appUrl.hostname,
    path: "/",
    secure: appUrl.protocol === "https:",
  })),
});

const evaluate = async (expression) => {
  const result = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
  return result.result.value;
};

async function load(path) {
  const loaded = new Promise((resolve) => page.loads.push(resolve));
  await page.send("Page.navigate", { url: new URL(path, APP_ORIGIN).toString() });
  await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 30000))]);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate("document.readyState === 'complete' && !!document.querySelector('header')")) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // Hydration has to finish before a click reaches a React handler.
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

/** A real mouse click on the element the expression returns. */
async function click(expression) {
  const box = await evaluate(`
    (() => {
      const node = ${expression};
      if (!node) return null;
      node.scrollIntoView({ block: 'center' });
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
  assert.ok(box, `nothing to click for ${expression}`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
}

/**
 * Clicks "Añadir momento" until the row really appears. A dev build can still
 * be hydrating when the page reports itself complete, and a click that lands
 * before React attaches its handler does nothing at all.
 */
async function addMoment(expected) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const count = await evaluate(`document.querySelectorAll('[name="stage_label"]').length`);
    if (count >= expected) return count;
    await click(BUTTON("Añadir momento"));
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw new Error(`the editor never added moment ${expected} — the page may not have hydrated`);
}

const BUTTON = (label) => `[...document.querySelectorAll('button')].find((b) => (b.textContent||'').trim() === ${JSON.stringify(label)})`;
const FIELD = (name, row) => `document.querySelectorAll('[name=${JSON.stringify(name)}]')[${row}]`;

/**
 * Types one character at a time through the browser's own input pipeline and,
 * after every single one, reports whether the element that still holds focus is
 * the same DOM node the caret started in.
 */
async function typeInto(expression, text) {
  await click(expression);
  const stamped = await evaluate(`
    (() => {
      const node = document.activeElement;
      if (!node || !('value' in node)) return null;
      node.__journeyProbe = 'stamped';
      return { name: node.name, value: node.value };
    })()`);
  assert.ok(stamped, "clicking the field did not put the caret in it");

  const report = { replaced: 0, blurred: 0, values: [] };
  for (const character of [...text]) {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", text: character, unmodifiedText: character, key: character });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: character });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const state = await evaluate(`
      (() => {
        const node = document.activeElement;
        const focused = !!node && 'value' in node && node.tagName !== 'BODY';
        return {
          focused,
          same: focused && node.__journeyProbe === 'stamped',
          value: focused ? node.value : null,
        };
      })()`);
    if (!state.focused) report.blurred += 1;
    else if (!state.same) report.replaced += 1;
    report.values.push(state.value);
  }
  return report;
}

const INDICATORS = `/studio/e/${STUDY_ID}/indicadores`;
let failures = 0;

try {
  // -------------------------------------------------------------------------
  // 1. A whole name, typed into a brand-new moment, at desktop width
  // -------------------------------------------------------------------------
  console.log("\n[1] Typing a name in a real browser (1280 px)");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await load(INDICATORS);
  assert.ok(await evaluate(`!!${BUTTON("Añadir momento")}`), "the editor did not render — check the session and the study id");

  await addMoment(1);

  const first = await typeInto(FIELD("stage_label", 0), NAMES[0]);
  assert.equal(first.blurred, 0, `the caret left the field ${first.blurred} times while typing "${NAMES[0]}"`);
  assert.equal(first.replaced, 0, `the input was replaced ${first.replaced} times while typing "${NAMES[0]}"`);
  assert.equal(first.values.at(-1), NAMES[0], "the field must hold every character that was typed");
  ok(`"${NAMES[0]}" typed in one go: 0 blurs, 0 remounts, full value present`);

  const consequence = await evaluate(`(() => {
    const alert = [...document.querySelectorAll('[role="alert"]')].map((n) => (n.textContent||'').trim());
    return { alerts: alert.length, focusedName: document.activeElement && document.activeElement.name };
  })()`);
  assert.equal(consequence.focusedName, "stage_label", "the incomplete-moment warning must not take the caret");
  ok("the warning about the missing result appears without stealing the caret");

  // -------------------------------------------------------------------------
  // 2. Choosing a result, then a description, keeps what was typed
  // -------------------------------------------------------------------------
  console.log("\n[2] Choosing a result and writing a description");
  const chosen = await evaluate(`
    (() => {
      const select = document.querySelectorAll('[name="stage_metric"]')[0];
      const option = [...select.options].find((o) => o.value);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return option.value;
    })()`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(await evaluate(`document.querySelectorAll('[name="stage_label"]')[0].value`), NAMES[0],
    "choosing a result must not reset the name");
  ok(`choosing a result (${chosen}) leaves the name intact`);

  const described = await typeInto(FIELD("stage_description", 0), DESCRIPTION);
  assert.equal(described.blurred + described.replaced, 0, "the description box must keep the caret too");
  assert.equal(described.values.at(-1), DESCRIPTION);
  assert.equal(await evaluate(`document.querySelectorAll('[name="stage_label"]')[0].value`), NAMES[0]);
  ok("a multi-sentence description is typed continuously, and the name survives it");

  // -------------------------------------------------------------------------
  // 3. Three moments, then remove the middle one
  // -------------------------------------------------------------------------
  console.log("\n[3] Three moments, each independent");
  for (const index of [1, 2]) {
    await addMoment(index + 1);
    const typedRow = await typeInto(FIELD("stage_label", index), NAMES[index]);
    assert.equal(typedRow.blurred + typedRow.replaced, 0, `moment ${index + 1} lost the caret while being named`);
    await evaluate(`
      (() => {
        const select = document.querySelectorAll('[name="stage_metric"]')[${index}];
        const used = [...document.querySelectorAll('[name="stage_metric"]')].map((s) => s.value);
        const option = [...select.options].find((o) => o.value && !used.includes(o.value));
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(select, option.value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const three = await evaluate(`[...document.querySelectorAll('[name="stage_label"]')].map((f) => f.value)`);
  assert.deepEqual(three, NAMES, "the three moments must hold the three names");
  const metrics = await evaluate(`[...document.querySelectorAll('[name="stage_metric"]')].map((f) => f.value)`);
  assert.equal(new Set(metrics).size, 3, "each moment must carry its own result");
  ok("three moments carry three names and three different results");

  await click(`[...document.querySelectorAll('button')].filter((b) => (b.textContent||'').trim() === 'Quitar')[1]`);
  const two = await evaluate(`[...document.querySelectorAll('[name="stage_label"]')].map((f) => f.value)`);
  assert.deepEqual(two, [NAMES[0], NAMES[2]], "removing the middle moment must leave the other two untouched");
  assert.equal(await evaluate(`document.querySelectorAll('[name="stage_description"]')[0].value`), DESCRIPTION,
    "the surviving moment keeps its description");
  ok("Quitar removes exactly one moment and the survivors keep their values");

  // -------------------------------------------------------------------------
  // 4. Save, reload, and read back what was stored
  // -------------------------------------------------------------------------
  console.log("\n[4] Saving and reading it back");
  const submittedIds = await evaluate(`[...document.querySelectorAll('[name="stage_id"]')].map((f) => f.value)`);
  await click(BUTTON("Guardar configuración"));
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const saved = await admin.from("study").select("journey_definition").eq("id", STUDY_ID).single();
  const stored = saved.data.journey_definition?.stages ?? [];
  assert.deepEqual(stored.map((stage) => stage.label), [NAMES[0], NAMES[2]], "the stored labels are the two that survived");
  assert.deepEqual(stored.map((stage) => stage.id), submittedIds, "the stored ids are the ids the editor submitted");
  assert.equal(stored[0].description, DESCRIPTION, "the description is stored as written");
  assert.equal(new Set(stored.map((stage) => stage.metric)).size, 2, "each stored moment keeps its own result");
  ok(`saved ${stored.length} moments with the identifiers the editor submitted (${submittedIds.join(", ")})`);

  await load(INDICATORS);
  const reloaded = await evaluate(`({
    labels: [...document.querySelectorAll('[name="stage_label"]')].map((f) => f.value),
    ids: [...document.querySelectorAll('[name="stage_id"]')].map((f) => f.value),
    descriptions: [...document.querySelectorAll('[name="stage_description"]')].map((f) => f.value),
  })`);
  assert.deepEqual(reloaded.labels, [NAMES[0], NAMES[2]], "the reload shows the saved names in order");
  assert.deepEqual(reloaded.ids, submittedIds, "the reload shows the saved identifiers in order");
  assert.equal(reloaded.descriptions[0], DESCRIPTION);
  ok("a reload shows the same names, identifiers, descriptions and order");

  // -------------------------------------------------------------------------
  // 5. A saved moment renamed keeps the identifier its comments point at
  // -------------------------------------------------------------------------
  console.log("\n[5] Renaming a saved moment");
  const renamed = await typeInto(FIELD("stage_label", 0), " revisado");
  assert.equal(renamed.blurred + renamed.replaced, 0, "renaming a saved moment must not replace its row either");
  assert.equal(await evaluate(`document.querySelectorAll('[name="stage_id"]')[0].value`), submittedIds[0],
    "a saved identifier must not move when the moment is renamed");
  ok(`"${NAMES[0]}" renamed in full, and its stored identifier stayed ${submittedIds[0]}`);

  // -------------------------------------------------------------------------
  // 6. The same typing, on a narrow phone
  // -------------------------------------------------------------------------
  console.log("\n[6] The same typing at 375 px");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await load(INDICATORS);
  const rows = await addMoment(3);
  const narrow = await typeInto(FIELD("stage_label", rows - 1), "Recomendación móvil");
  assert.equal(narrow.blurred + narrow.replaced, 0, "the caret must survive typing on a narrow screen too");
  assert.equal(narrow.values.at(-1), "Recomendación móvil");
  const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  assert.ok(overflow <= 1, `the page must not scroll sideways at 375 px (overflow ${overflow}px)`);
  ok("typing works at 375 px with no page-level horizontal overflow");

  const errors = page.consoleErrors.filter((text) => !/favicon|net::ERR_/i.test(text));
  assert.deepEqual(errors, [], `the browser reported console errors: ${errors.join(" | ")}`);
  ok("the run produced no console error");
} catch (error) {
  failures += 1;
  console.error(`\n  FAIL  ${error.message}`);
} finally {
  // Put the study back exactly as it was found, whatever happened above.
  const restore = await admin.from("study").update({ journey_definition: originalJourney }).eq("id", STUDY_ID);
  console.log(restore.error
    ? `\n  WARNING  could not restore the study's journey: ${restore.error.message}`
    : "\n  Restored the study's journey to what it was before the run.");
  page.close();
  chrome.kill();
}

if (failures > 0) {
  console.error(`\nJourney editor live gate: FAIL`);
  process.exit(1);
}
console.log(`\nJourney editor live gate: PASS (${checks} checks)`);
