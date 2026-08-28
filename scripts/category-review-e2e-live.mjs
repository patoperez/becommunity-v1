// =============================================================================
// LIVE end-to-end: the category review, driven through a real browser
//   HARNESS_ORIGIN=... CATEGORY_STUDY_ID=... node ... scripts/category-review-e2e-live.mjs
// =============================================================================
// The deterministic gate proves the rules and the live RPC test proves the
// database. This proves the thing neither can: that a consultant opening the
// deployed page, reading a card and pressing a button actually changes what the
// product counts — and that pressing undo actually changes it back.
//
// It drives a DISPOSABLE study named by CATEGORY_STUDY_ID and never publishes.
// The real study is never opened.
// =============================================================================

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { foldSegmentValue, parseSegmentAliases } from "../src/lib/calc/segments.ts";

const APP_ORIGIN = (process.env.HARNESS_ORIGIN ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const STUDY_ID = process.env.CATEGORY_STUDY_ID ?? "";

let checks = 0;
const ok = (message) => {
  checks += 1;
  console.log(`  PASS  ${message}`);
};

for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TEST_INTERNAL_EMAIL",
  "TEST_INTERNAL_PASSWORD",
]) {
  if (!process.env[name]) throw new Error(`${name} is required for the live category gate`);
}
if (!STUDY_ID) throw new Error("CATEGORY_STUDY_ID must name the disposable study this gate may edit");

const DIMENSION = "giro";
const KEEP = "Capacitación y Coaching";
const OTHER = "Capacitacion y Coaching";

const health = await fetch(new URL("/api/health", APP_ORIGIN)).catch(() => null);
if (!health?.ok) throw new Error(`the app is not answering at ${APP_ORIGIN}`);
ok(`the app answers /api/health at ${APP_ORIGIN}`);

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const aliasesNow = async () => {
  const { data } = await admin
    .from("segment_dimension").select("key, config").eq("study_id", STUDY_ID);
  return parseSegmentAliases(data ?? []);
};
const ledgerNow = async () => {
  const { data } = await admin
    .from("category_decision")
    .select("id, decision, version, canonical_label, reason, actor_user_id, suggestion_source")
    .eq("study_id", STUDY_ID).order("version");
  return data ?? [];
};

assert.equal((await ledgerNow()).length, 0, "the disposable study must start with no decisions");
ok("the study starts with no recorded decisions");

// --- sign in in Node; the browser only ever receives the session cookies -----
const jar = new Map();
const auth = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  },
);
const signIn = await auth.auth.signInWithPassword({
  email: process.env.TEST_INTERNAL_EMAIL,
  password: process.env.TEST_INTERNAL_PASSWORD,
});
if (signIn.error) throw new Error(`sign-in failed: ${signIn.error.message}`);
ok("signed in as the internal fixture account");

const binary = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .filter(Boolean).find((path) => existsSync(path));
if (!binary) throw new Error("no Chrome binary found — set CHROME_PATH");

const port = 9600 + Math.floor(Math.random() * 200);
const chrome = spawn(binary, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "becommunity-categories-"))}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--disable-background-networking", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });

for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) break;
  } catch { /* still starting */ }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let messageId = 0;
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
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");

const appUrl = new URL(APP_ORIGIN);
await send("Network.setCookies", {
  cookies: [...jar.entries()].map(([name, value]) => ({
    name, value: encodeURIComponent(value),
    domain: appUrl.hostname, path: "/", secure: appUrl.protocol === "https:",
  })),
});

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
  }
  return result.result.value;
};

async function load(path) {
  const loaded = new Promise((resolve) => loads.push(resolve));
  await send("Page.navigate", { url: new URL(path, APP_ORIGIN).toString() });
  await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 30000))]);
  await new Promise((resolve) => setTimeout(resolve, 900));
}

const REVIEW = `/studio/e/${STUDY_ID}/categorias`;

try {
  // -------------------------------------------------------------------------
  console.log("\n[1] The review screen renders the question");
  await load(REVIEW);
  assert.equal(await evaluate(`document.documentElement.lang`), "es", "the page must render, in Spanish");
  const body = await evaluate(`document.body.innerText`);
  assert.match(body, /Revisar categorías/, "the screen names itself");
  assert.match(body, /Los datos que se importaron no se tocan/, "it states that raw data is untouched");
  assert.match(body, /El total de personas que respondieron no cambia/, "and that totals never move");
  assert.match(body, /Nada se agrupa solo/, "and that nothing merges by itself");
  ok("the review screen renders with its three standing promises");

  assert.match(body, /Capacitación y Coaching/, "the accent pair is on screen");
  assert.match(body, /Solo se diferencian en los acentos/, "and the reason is stated in plain Spanish");
  ok("the accent pair is raised, with the rule explained");

  assert.doesNotMatch(body, /fuzzy|deterministic|jaccard|canonicalKey|jsonb/i,
    "no internal vocabulary reaches the screen");
  ok("nothing on screen asks the consultant to understand the implementation");

  // -------------------------------------------------------------------------
  console.log("\n[2] Pressing Agrupar changes what the product counts");
  const grouped = await evaluate(`
    (() => {
      const forms = [...document.querySelectorAll('form')];
      const form = forms.find((f) => [...f.querySelectorAll('input[name="member"]')]
        .some((i) => i.value === ${JSON.stringify(OTHER)}));
      if (!form) return 'no form for the accent pair';
      const label = form.querySelector('input[name="canonical_label"]');
      label.value = ${JSON.stringify(KEEP)};
      const button = [...form.querySelectorAll('button')].find((b) => b.value === 'grouped');
      if (!button) return 'no Agrupar button';
      button.click();
      return 'clicked';
    })()`);
  assert.equal(grouped, "clicked", `could not press Agrupar: ${grouped}`);
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const ledger = await ledgerNow();
  assert.equal(ledger.length, 1, "exactly one decision was recorded");
  assert.equal(ledger[0].decision, "grouped", "and it is a grouping");
  assert.equal(ledger[0].canonical_label, KEEP, "under the label that was on the form");
  assert.ok(ledger[0].actor_user_id, "attributed to the signed-in account");
  ok(`the click recorded one decision, attributed and labelled "${KEEP}"`);

  const aliases = await aliasesNow();
  assert.equal(aliases[DIMENSION]?.[foldSegmentValue(OTHER)], KEEP,
    "and the projection now groups the two spellings");
  ok("the projection the calculation layer reads was updated in the same act");

  const { data: rows } = await admin
    .from("respondent").select("segments").eq("study_id", STUDY_ID);
  const rawStillThere = (rows ?? []).filter((r) => String(r.segments[DIMENSION]) === OTHER).length;
  assert.ok(rawStillThere > 0, "the raw spelling must still be in the database");
  ok(`the raw value is untouched: ${rawStillThere} respondents still carry it exactly as imported`);

  // -------------------------------------------------------------------------
  console.log("\n[3] The screen now shows it as decided, with undo reachable");
  await load(REVIEW);
  const afterBody = await evaluate(`document.body.innerText`);
  assert.match(afterBody, /Ya decididas/, "the decided section appears");
  assert.match(afterBody, /Agrupadas/, "and the pair is marked as grouped");
  assert.match(afterBody, /Deshacer esta decisión/, "with undo offered");
  ok("the decision is shown as taken, and undo is one click away");

  // -------------------------------------------------------------------------
  console.log("\n[4] Undo puts the numbers back, without erasing the record");
  const undone = await evaluate(`
    (() => {
      const button = [...document.querySelectorAll('button')]
        .find((b) => (b.textContent || '').trim() === 'Deshacer esta decisión');
      if (!button) return 'no undo button';
      button.click();
      return 'clicked';
    })()`);
  assert.equal(undone, "clicked", `could not press undo: ${undone}`);
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const afterUndo = await ledgerNow();
  assert.equal(afterUndo.length, 2, "undo APPENDED a version rather than deleting one");
  assert.equal(afterUndo[0].decision, "grouped", "the original decision is still there");
  assert.equal(afterUndo[0].canonical_label, KEEP, "with its label intact");
  assert.equal(afterUndo[1].decision, "revoked", "and the new version reverses it");
  ok("undo wrote an inverse version; the original survives in full");

  const aliasesAfter = await aliasesNow();
  assert.ok(!aliasesAfter[DIMENSION]?.[foldSegmentValue(OTHER)],
    "the projection no longer groups them");
  ok("and the product counts the two spellings separately again");

  // -------------------------------------------------------------------------
  console.log("\n[5] No console error anywhere in the run");
  const real = consoleErrors.filter((text) => !/favicon|manifest/i.test(text));
  assert.deepEqual(real, [], `console errors: ${real.join(" | ")}`);
  ok("the run produced no console error");
} finally {
  socket.close();
  chrome.kill();
}

console.log(`\nCategory review live E2E: PASS (${checks} checks)`);
