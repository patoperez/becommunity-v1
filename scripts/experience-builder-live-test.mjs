// =============================================================================
// The dashboard builder, driven in a real browser
// =============================================================================
// Credential-bearing. Everything below is a claim about the RUNNING PRODUCT, so
// none of it can be settled by reading source:
//
//   1  a client-role account cannot reach the builder — the server redirects it;
//   2  the builder shows the study's REAL name, its real result labels and a
//      real aggregate, and the aggregate equals the canonical function's answer
//      computed independently in this script;
//   3  it shows no respondent, no answer and no approved quote;
//   4  typing keeps focus and the caret;
//   5  a saved edit survives a reload;
//   6  a second editor's save is detected instead of being overwritten;
//   7  a block moves with the keyboard alone;
//   8  every control is at least 44 x 44 CSS pixels at 320, 360 and 390;
//   9  no console error, no hydration error, no duplicate DOM id;
//  10  saving a draft changes NOTHING a client sees — proved by comparing the
//      client's own study page before and after a draft exists for it.
//
// WHAT IT WRITES. One disposable client and study, created and deleted here,
// for the save / conflict / reorder drive. And one draft on the synthetic
// client-visible fixture study, which is what makes claim 10 a real test rather
// than a vacuous one — a draft has to EXIST for "the client sees nothing of it"
// to mean anything. Drafts are deliberately not deletable by the application
// (migration 0023 grants no DELETE), so that one row stays; it is invisible to
// every client-facing route, which is the whole point.
//
// IT NEEDS A PRODUCTION SERVER, not `next dev`:
//
//     npm run build && npm start
//
// React's DEVELOPMENT build calls `eval()` for its debugging features, and this
// application sends a Content-Security-Policy without `unsafe-eval` — correctly
// — so under `next dev` React never hydrates this page and every control on it
// is inert. That is the CSP doing its job, not a defect, and it is also why a
// gate that DRIVES the product has to drive the build a client would receive.
// The check below fails loudly if React is not attached, so this can never
// again look like a broken button.
//
// It reads the richest study read-only and never writes to it.
// It never prints a credential, a respondent, an answer or a quote.
// =============================================================================

import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";

import { npsFromScores, csatTopBox } from "../src/lib/calc/metrics.ts";
import { formatNumber } from "../src/lib/calc/format.ts";
import { EXPERIENCE_SCHEMA_VERSION } from "../src/lib/experience/definition.ts";
import { newExperience, newPage } from "../src/lib/experience/defaults.ts";

const APP_ORIGIN = (process.env.HARNESS_ORIGIN ?? process.env.RESPONSIVE_APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
const WIDTHS = [320, 360, 390];
const DEBUG_PORT = Number(process.env.BUILDER_DEBUG_PORT ?? 9800 + Math.floor(Math.random() * 300));
const PROFILE = mkdtempSync(join(tmpdir(), "becommunity-builder-"));

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "TEST_INTERNAL_EMAIL",
  "TEST_INTERNAL_PASSWORD",
  "TEST_USER_A_EMAIL",
  "TEST_USER_A_PASSWORD",
]) {
  if (!process.env[name]) throw new Error(`${name} is required for the live builder gate`);
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
// The database, read and written only through the paths the product uses
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

async function allRows(path, page = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += page) {
    const chunk = await rest(path, { headers: { Range: `${offset}-${offset + page - 1}` } });
    if (!chunk.ok || !Array.isArray(chunk.body) || chunk.body.length === 0) break;
    rows.push(...chunk.body);
    if (chunk.body.length < page) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// A signed-in loopback proxy, exactly as the acceptance matrix does it: the
// password is used in Node and only the resulting cookie reaches the browser.
// ---------------------------------------------------------------------------

async function signedInProxy(emailVar, passwordVar) {
  const jar = new Map();
  const client = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: process.env[emailVar],
    password: process.env[passwordVar],
  });
  if (error) throw new Error(`fixture sign-in failed for ${emailVar}: ${error.message}`);
  const cookie = [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
  const server = http.createServer(async (request, response) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (["host", "connection", "cookie", "content-length", "accept-encoding"].includes(key)) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
      }
      headers.set("cookie", cookie);
      headers.set("accept-encoding", "identity");
      // A Server Action is a POST, and Next refuses one whose `Origin` does not
      // match the host it is serving — the CSRF check that makes Server Actions
      // safe. The browser is talking to this loopback proxy, so the origin it
      // sends is the proxy's; both are rewritten to the application's own
      // origin, which is what a real browser would have sent. Nothing about the
      // check is disabled: the request still has to carry a matching pair.
      headers.set("origin", APP_ORIGIN);
      headers.set("referer", `${APP_ORIGIN}${request.url}`);
      const upstream = await fetch(new URL(request.url, APP_ORIGIN), {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method ?? "GET") ? undefined : await readBody(request),
        redirect: "manual",
      });
      const outgoing = {};
      upstream.headers.forEach((value, key) => {
        if (!["content-encoding", "content-length", "set-cookie", "transfer-encoding"].includes(key)) {
          outgoing[key] = value;
        }
      });
      response.writeHead(upstream.status, outgoing);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (failure) {
      response.writeHead(502, { "content-type": "text/plain" });
      response.end(failure instanceof Error ? failure.message : "proxy error");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    userId: data.user?.id ?? null,
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
      // Every call is bounded. A socket that closes mid-request resolves
      // nothing, and a gate that hangs is a gate whose result nobody can read.
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} did not answer within 45 s`));
      }, 45000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (failure) => { clearTimeout(timer); reject(failure); },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
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
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const ready = await evaluate("document.readyState === 'complete' && !!document.querySelector('main')");
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    },
    /** Real keystrokes, so React sees what a person's typing looks like. */
    type: async (text) => {
      for (const character of text) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", text: character });
        await send("Input.dispatchKeyEvent", { type: "keyUp" });
      }
    },
    key: async (key, code, windowsVirtualKeyCode) => {
      const shared = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...shared });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...shared });
    },
  };
}

/**
 * Click a control, and keep clicking until it has an effect.
 *
 * Not a workaround for a flaky product: a server-rendered page is on screen
 * before React has hydrated it, and a click that lands in that window does
 * nothing at all. A person experiences the same thing and clicks again; the
 * gate does what the person does, and fails only if it never takes.
 */
async function clickUntil(session, findExpression, doneExpression, what, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await session.evaluate(doneExpression)) return true;
    await session.evaluate(findExpression);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`clicked for ${what} and nothing happened`);
}

/** Poll a page expression until it is true, or say what it was when it was not. */
async function until(session, expression, what, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await session.evaluate(expression);
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${what} (last value: ${JSON.stringify(last)})`);
}

const SAVE_STATE = `document.querySelector('[aria-live="polite"][class*="rounded-lg"]')?.textContent?.trim() ?? null`;

/** Every visible control, measured the way a finger meets it. */
const TARGETS = `(() => {
  const visible = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return !el.classList.contains('sr-only') && style.display !== 'none'
      && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const name = (el) => el.tagName.toLowerCase()
    + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  return [...document.querySelectorAll('a[href],button,summary,select,textarea,input:not([type="hidden"])')]
    .filter(visible)
    .flatMap((el) => {
      // A checkbox or a radio is hit by its label; that is the target a person
      // actually aims at, and it is what the box is sized against.
      const target = (el.matches('input[type="checkbox"],input[type="radio"]') ? el.closest('label') : el) || el;
      const rect = target.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44
        ? [{ element: name(el), width: Math.round(rect.width), height: Math.round(rect.height) }]
        : [];
    })
    .slice(0, 8);
})()`;

const PAGE_HEALTH = `(() => {
  const root = document.documentElement;
  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id).filter(Boolean);
  return {
    width: root.clientWidth,
    documentWidth: root.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
  };
})()`;

// ---------------------------------------------------------------------------

const stamp = `EXPERIENCE-BUILDER-GATE-${Date.now()}`;
let disposableTenant = null;
let disposableStudy = null;
let chrome = null;
let session = null;
let internal = null;
let client = null;

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
  client?.close();
  if (disposableStudy) await rest(`study?id=eq.${disposableStudy}`, { method: "DELETE" });
  if (disposableTenant) await rest(`tenant?id=eq.${disposableTenant}`, { method: "DELETE" });
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

try {
  const health = await fetch(new URL("/api/health", APP_ORIGIN)).catch(() => null);
  assert.ok(health?.ok, `start the application at ${APP_ORIGIN} before running this gate`);

  // =========================================================================
  console.log("\n[1] The richest study in this project, read without writing");
  // =========================================================================
  const studies = await rest("study?select=id,tenant_id,name,period,status");
  assert.ok(studies.ok && studies.body.length > 0, "this project has no study to read");
  const responses = await allRows("quant_response?select=study_id,metric_key,value");
  const byStudy = new Map();
  for (const row of responses) {
    const list = byStudy.get(row.study_id) ?? [];
    list.push(row);
    byStudy.set(row.study_id, list);
  }
  const richest = studies.body
    .map((study) => ({ study, rows: byStudy.get(study.id) ?? [] }))
    .sort((a, b) => b.rows.length - a.rows.length)[0];
  assert.ok(richest.rows.length > 0, "no study in this project carries quantitative answers");
  console.log(`  Study under test: ${richest.study.name} (${richest.rows.length} answers)`);

  // The canonical answer, computed HERE, independently of the product.
  const npsScores = richest.rows
    .filter((row) => String(row.metric_key).startsWith("nps"))
    .map((row) => Number(row.value))
    .filter((value) => Number.isFinite(value));
  assert.ok(npsScores.length > 0, "the study under test has no recommendation answers");
  const expectedNps = formatNumber(npsFromScores(npsScores).nps, 1);
  ok(`the canonical recommendation result for this study is ${expectedNps} over ${npsScores.length} answers`);

  // =========================================================================
  console.log("\n[2] A client-role account cannot reach the builder");
  // =========================================================================
  client = await signedInProxy("TEST_USER_A_EMAIL", "TEST_USER_A_PASSWORD");
  const refused = await fetch(`${client.origin}/studio/e/${richest.study.id}/construccion`, {
    redirect: "manual",
  });
  assert.ok(
    [302, 303, 307, 308].includes(refused.status),
    `a client-role account must be redirected away from the builder (got ${refused.status})`,
  );
  assert.match(
    refused.headers.get("location") ?? "",
    /\/dashboard/,
    "and redirected to its own dashboard",
  );
  ok(`a client-role account is redirected to /dashboard (HTTP ${refused.status})`);

  // =========================================================================
  console.log("\n[3] The builder, in a real browser");
  // =========================================================================
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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).catch(() => null);
    if (response?.ok) {
      ready = true;
      break;
    }
    if (chrome.exitCode != null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "headless browser did not start");
  session = await connect();
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  internal = await signedInProxy("TEST_INTERNAL_EMAIL", "TEST_INTERNAL_PASSWORD");
  const builderUrl = `${internal.origin}/studio/e/${richest.study.id}/construccion`;

  await session.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await session.load(builderUrl);

  // React has to be attached before anything below means anything: an inert
  // server-rendered page looks identical and answers no click.
  const hydrated = await until(
    session,
    `Object.keys(document.querySelector("main") ?? {}).some((key) => key.startsWith("__react"))`,
    "React to hydrate the page (run `npm run build && npm start`, not `next dev`)",
    30000,
  );
  assert.ok(hydrated, "React hydrated the builder");
  ok("the page hydrated, so every control below is a control and not a picture of one");

  const text = await session.evaluate("document.body.innerText");
  assert.ok(text.includes(richest.study.name), "the builder shows the study's real name");
  assert.ok(
    text.includes("Construcción del dashboard"),
    "and says what the screen is",
  );
  assert.ok(
    /el cliente no ve nada de esto/i.test(text),
    "and that the client cannot see any of it",
  );
  ok("the builder opens on the real study and says what it is");

  assert.ok(
    text.includes(expectedNps),
    `the builder shows the canonical recommendation result (${expectedNps}); it is not on the page`,
  );
  ok(`the canvas renders the study's real aggregate (${expectedNps}), matching the canonical function`);

  // Result LABELS, not keys. Every result the study offers is named in words.
  const metricKeys = [...new Set(richest.rows.map((row) => String(row.metric_key)))];
  const leakedKeys = metricKeys.filter((key) => key.length > 6 && text.includes(key));
  assert.deepEqual(leakedKeys, [], `a canonical metric key is on screen: ${leakedKeys.join(", ")}`);
  ok(`none of the ${metricKeys.length} canonical metric keys appears on screen`);

  // =========================================================================
  console.log("\n[4] No respondent, no answer, no quote");
  // =========================================================================
  const quotes = await allRows(
    `qual_observation?study_id=eq.${richest.study.id}&review_status=eq.confirmed&select=id,quote&quote=not.is.null`,
  );
  const html = await session.evaluate("document.documentElement.outerHTML");
  for (const row of quotes.slice(0, 25)) {
    const fragment = String(row.quote).trim().slice(0, 40);
    if (fragment.length < 20) continue;
    assert.ok(!html.includes(fragment), "an approved quote must not appear in the builder");
  }
  const respondents = await allRows(`respondent?study_id=eq.${richest.study.id}&select=id`);
  const leakedRespondents = respondents.filter((row) => html.includes(row.id));
  assert.deepEqual(leakedRespondents, [], "a respondent identifier must not appear in the builder");
  ok(`no quote and none of the ${respondents.length} respondent identifiers reaches the page`);

  // =========================================================================
  console.log("\n[5] Every control is at least 44 x 44, at every narrow width");
  // =========================================================================
  for (const width of WIDTHS) {
    await session.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await session.load(builderUrl);
    const small = await session.evaluate(TARGETS);
    assert.deepEqual(small, [], `${width}px: a control is under 44 x 44 ${JSON.stringify(small)}`);
    const view = await session.evaluate(PAGE_HEALTH);
    assert.equal(view.documentWidth, width, `${width}px: the page scrolls sideways (${view.documentWidth})`);
    assert.ok(view.bodyWidth <= width, `${width}px: the body scrolls sideways (${view.bodyWidth})`);
    assert.deepEqual(view.duplicateIds, [], `${width}px: duplicate DOM ids ${JSON.stringify(view.duplicateIds)}`);
    ok(`${width}px: no control under 44 x 44, no sideways scrolling, no duplicate id`);
  }

  // The panels are drawers here, and they open and close.
  const drawerOpen = await clickUntil(
    session,
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Páginas y bloques')?.click()`,
    `getComputedStyle(document.querySelector('aside[aria-label="Páginas y catálogo de bloques"]')).display !== 'none'`,
    "the left drawer to open",
  );
  assert.ok(drawerOpen, "the pages drawer opens on a narrow screen");
  await session.key("Escape", "Escape", 27);
  const drawerClosed = await until(
    session,
    `getComputedStyle(document.querySelector('aside[aria-label="Páginas y catálogo de bloques"]')).display === 'none'`,
    "the left drawer to close on Escape",
  );
  assert.ok(drawerClosed, "and Escape closes it");
  ok("on a narrow screen the panels are drawers that open and close, Escape included");

  // =========================================================================
  console.log("\n[6] A disposable study: type, save, reload, conflict, reorder");
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

  await session.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const disposableUrl = `${internal.origin}/studio/e/${disposableStudy}/construccion`;
  await session.load(disposableUrl);
  assert.equal(await session.evaluate(SAVE_STATE), "Sin guardar todavía", "a study with no draft says so");
  ok("a study nobody has composed yet says it has nothing saved, rather than claiming a draft");

  // Typing keeps focus and the caret.
  const marker = `Página ${Date.now() % 100000}`;
  await session.evaluate(`(() => {
    const input = [...document.querySelectorAll('input')].find((el) => el.previousElementSibling?.textContent?.includes('Nombre de la página abierta'));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    return input.id;
  })()`);
  await session.type(marker);
  const typing = await session.evaluate(`(() => {
    const el = document.activeElement;
    return { tag: el?.tagName, value: el?.value ?? null, caret: el?.selectionStart ?? null };
  })()`);
  assert.equal(typing.tag, "INPUT", "focus stayed in the field while typing");
  assert.ok(typing.value.endsWith(marker), `the field holds what was typed (${JSON.stringify(typing.value)})`);
  assert.equal(typing.caret, typing.value.length, "and the caret stayed at the end");
  ok("typing a page name keeps focus and the caret exactly where a person left them");

  const saved = await until(
    session,
    `(() => { const state = ${SAVE_STATE}; return state?.startsWith('Guardado') ? state : null; })()`,
    // The chip and any visible failure, so a red run says WHY rather than
    // leaving somebody to guess which half of the round trip broke.
    `the autosave to land — the screen says ${JSON.stringify(await session.evaluate(SAVE_STATE))}`,
    30000,
  ).catch(async (failure) => {
    const shown = await session.evaluate(
      `[...document.querySelectorAll('p')].map((p) => p.textContent.trim()).filter((t) => /guardar|versión|inválid|permiso/i.test(t)).slice(0, 3)`,
    );
    throw new Error(`${failure.message}; on screen: ${JSON.stringify(shown)}`);
  });
  assert.ok(saved, "the draft saved itself");
  ok("the edit autosaved without anybody pressing anything");

  await session.load(disposableUrl);
  const afterReload = await session.evaluate("document.body.innerText");
  assert.ok(afterReload.includes(marker), "the saved page name survived a reload");
  assert.match(await session.evaluate(SAVE_STATE), /^Guardado/, "and the screen says it is saved");
  ok("a reload brings back exactly what was saved");

  const storedAfterReload = await rest(
    `study_experience_draft?study_id=eq.${disposableStudy}&select=revision,definition`,
  );
  assert.equal(storedAfterReload.body.length, 1, "exactly one draft row exists for the study");
  assert.ok(
    JSON.stringify(storedAfterReload.body[0].definition).includes(marker),
    "and the stored document is the one on screen",
  );
  ok(`the draft is stored once, at revision ${storedAfterReload.body[0].revision}`);

  // A second editor saves behind this browser's back.
  const internalProfile = await rest("profiles?select=user_id&role=eq.internal&limit=1");
  const otherActor = internalProfile.body[0].user_id;
  const theirs = {
    ...newExperience({
      seed: `${disposableStudy}/other`,
      title: "Lo que guardó la otra persona",
      studyId: disposableStudy,
      tenantId: disposableTenant,
    }),
    pages: [newPage(`${disposableStudy}/other/page`, "De la otra persona", 0)],
  };
  const theirSave = await rest("rpc/save_study_experience_draft", {
    method: "POST",
    body: {
      p_study_id: disposableStudy,
      p_actor: otherActor,
      p_definition: theirs,
      p_schema_version: EXPERIENCE_SCHEMA_VERSION,
      p_expected_revision: storedAfterReload.body[0].revision,
    },
  });
  assert.ok(theirSave.ok, `the second editor's save failed: ${theirSave.text.slice(0, 200)}`);

  // Now this browser edits and tries to save on top of a revision that moved.
  await session.evaluate(`(() => {
    const input = [...document.querySelectorAll('input')].find((el) => el.previousElementSibling?.textContent?.includes('Nombre de la página abierta'));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  })()`);
  await session.type(" X");
  const conflicted = await until(
    session,
    `document.body.innerText.includes('Alguien más guardó una versión más nueva')`,
    "the conflict to be reported",
    30000,
  );
  assert.ok(conflicted, "the builder reported the conflict");
  assert.equal(await session.evaluate(SAVE_STATE), "Hay una versión más nueva");
  const untouched = await rest(
    `study_experience_draft?study_id=eq.${disposableStudy}&select=revision,definition`,
  );
  assert.equal(
    untouched.body[0].definition.title,
    theirs.title,
    "and the other person's version is still the one that is stored",
  );
  ok("a save onto a revision that moved is reported, and overwrites nothing");

  // Taking their version is offered, and it works.
  const adopted = await clickUntil(
    session,
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('quedarme con la versión guardada'))?.click()`,
    `document.body.innerText.includes('De la otra persona')`,
    "the stored version to be adopted",
  );
  assert.ok(adopted, "the builder can take the version that is stored");
  ok("the person can take the stored version, and the screen becomes it");

  // Reordering with the keyboard alone.
  //
  // The two added blocks are the same kind, so they read the same on the canvas
  // and swapping them would be invisible. One of them is renamed first — which
  // exercises the title field as well — so the order is something a person, and
  // therefore this gate, can actually see.
  await session.load(disposableUrl);
  await clickUntil(
    session,
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Añadir bloque')?.click()`,
    `document.querySelectorAll('li [aria-label^="Mover"]').length >= 2`,
    "two blocks on the canvas",
  );
  await clickUntil(
    session,
    `document.querySelectorAll('li [aria-label^="Mover"]')[0]?.parentElement?.querySelector('button[aria-current], button:not([aria-label])')?.click()`,
    `!!document.getElementById([...document.querySelectorAll('label')].find((l) => l.textContent.includes('Título visible'))?.getAttribute('for') ?? '')`,
    "the first block to be selected and its card opened",
  );
  const named = "Bloque de arriba";
  await session.evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Título visible'));
    const input = document.getElementById(label.getAttribute('for'));
    input.focus();
    input.setSelectionRange(0, input.value.length);
  })()`);
  await session.key("Backspace", "Backspace", 8);
  await session.type(named);
  // Adding a block SELECTS it, so the card that is open is the one just added.
  // The gate finds the renamed block wherever it is rather than assuming a
  // position, and moves it the direction there is room for.
  const before = await until(
    session,
    `(() => {
      const names = [...document.querySelectorAll('li [aria-label^="Mover"]')].map((b) => b.getAttribute('aria-label'));
      return names.length >= 2 && names.some((n) => n.includes(${JSON.stringify(named)})) ? names : null;
    })()`,
    "the renamed block to appear on the canvas",
  ).catch(async (failure) => {
    const seen = await session.evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Título visible'));
      const input = label ? document.getElementById(label.getAttribute('for')) : null;
      return {
        titleField: input ? input.value : "(no title field on screen)",
        handles: [...document.querySelectorAll('li [aria-label^="Mover"]')].map((b) => b.getAttribute('aria-label')).slice(0, 3),
      };
    })()`);
    throw new Error(`${failure.message}; ${JSON.stringify(seen)}`);
  });

  const position = before.findIndex((name) => name.includes(named));
  const direction = position === 0 ? "ArrowDown" : "ArrowUp";
  const expected = position === 0 ? position + 1 : position - 1;
  await session.evaluate(
    `document.querySelectorAll('li [aria-label^="Mover"]')[${position}].focus()`,
  );
  await session.key(direction, direction, direction === "ArrowDown" ? 40 : 38);
  const after = await until(
    session,
    `(() => {
      const names = [...document.querySelectorAll('li [aria-label^="Mover"]')].map((b) => b.getAttribute('aria-label'));
      return names[${expected}]?.includes(${JSON.stringify(named)}) ? names : null;
    })()`,
    `the renamed block to move from position ${position} to ${expected} with ${direction}`,
  ).catch(async (failure) => {
    const focused = await session.evaluate(
      `({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute?.('aria-label') })`,
    );
    throw new Error(`${failure.message}; focus was on ${JSON.stringify(focused)}`);
  });
  assert.notDeepEqual(after, before, "the arrow key moved the block");
  assert.deepEqual([...after].sort(), [...before].sort(), "and moved it rather than losing it");
  ok("a block moves down with the keyboard alone, no pointer involved");

  // =========================================================================
  console.log("\n[7] No console error, no hydration error");
  // =========================================================================
  const noise = session.problems.filter(
    (problem) => !/favicon|ERR_ABORTED|Failed to load resource/i.test(problem),
  );
  assert.deepEqual(noise, [], `the browser reported errors: ${JSON.stringify(noise.slice(0, 4))}`);
  ok("the browser reported no console error and no hydration error across every load");

  // =========================================================================
  console.log("\n[8] Saving a draft changes nothing a client sees");
  // =========================================================================
  const clientStudies = await rest(`study?select=id,tenant_id,name&status=eq.published&limit=1`);
  const clientStudy = clientStudies.body?.[0] ?? null;
  if (!clientStudy) {
    console.log("  SKIP  this project has no published study to read as a client");
  } else {
    // Compared as the SERVER SENDS IT, not as a browser paints it. The bytes are
    // what a client receives, so anything a draft could change would change
    // them — and it needs no browser, so a hang here would be the product's
    // rather than the harness's.
    // The ONE thing that is required to differ between two identical responses:
    // the CSP nonce. It is per-request by definition and carries no product
    // meaning, so it is normalised away and nothing else is. If any other byte
    // moves, the comparison below catches it.
    const stripNonce = (html) =>
      html
        .replace(/nonce="[^"]*"/g, `nonce="N"`)
        .replace(/\\"nonce\\":\\"[^\\"]*\\"/g, `\\"nonce\\":\\"N\\"`);
    const fetchClientPage = async () => {
      const response = await fetch(`${client.origin}/insights/e/${clientStudy.id}`, {
        headers: { accept: "text/html" },
      });
      return { status: response.status, body: stripNonce(await response.text()) };
    };

    const first = await fetchClientPage();
    assert.equal(first.status, 200, "the client can read its own study");
    assert.ok(first.body.length > 2000, "and the page has real content in it");
    // Two identical requests first, so the comparison below cannot be fooled by
    // something that differs on every render anyway.
    const second = await fetchClientPage();
    assert.equal(second.body, first.body, "the client's study page is byte-stable between requests");

    const existing = await rest(`study_experience_draft?study_id=eq.${clientStudy.id}&select=revision`);
    const marker = `Invisible para el cliente ${Date.now()}`;
    const definition = {
      ...newExperience({
        seed: `${clientStudy.id}/invariance`,
        title: marker,
        studyId: clientStudy.id,
        tenantId: clientStudy.tenant_id,
      }),
      pages: [newPage(`${clientStudy.id}/invariance/page`, marker, 0)],
    };
    const write = await rest("rpc/save_study_experience_draft", {
      method: "POST",
      body: {
        p_study_id: clientStudy.id,
        p_actor: otherActor,
        p_definition: definition,
        p_schema_version: EXPERIENCE_SCHEMA_VERSION,
        p_expected_revision: existing.body.length > 0 ? existing.body[0].revision : null,
      },
    });
    assert.ok(write.ok, `could not save the invariance draft: ${write.text.slice(0, 200)}`);
    const stored = await rest(`study_experience_draft?study_id=eq.${clientStudy.id}&select=revision`);
    assert.equal(stored.body.length, 1, "the draft really is stored for the client's own study");

    const after = await fetchClientPage();
    assert.equal(after.body, first.body, "the client's study page changed after a draft was saved for it");
    assert.ok(!after.body.includes(marker), "and it carries no trace of the draft");
    ok("a saved draft leaves the client's own study page byte for byte identical");
  }


  console.log(`\nOK — ${checks} live builder checks passed.`);
} finally {
  await cleanup();
  const strays = await rest(`study?name=eq.${encodeURIComponent(stamp)}&select=id`);
  const strayTenants = await rest(`tenant?name=eq.${encodeURIComponent(stamp)}&select=id`);
  const remaining = (strays.body?.length ?? 0) + (strayTenants.body?.length ?? 0);
  console.log(
    remaining === 0
      ? "  CLEAN  the disposable client and study were removed"
      : `  WARNING  ${remaining} disposable row(s) remain and must be removed by hand`,
  );
}
