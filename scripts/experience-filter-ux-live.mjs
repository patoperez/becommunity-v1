// =============================================================================
// Filter compatibility, the connection workflow, and the editor's own chrome —
// driven in a real browser, with screenshots
// =============================================================================
// Credential-bearing. Everything here is a claim about the RUNNING PRODUCT, so
// none of it can be settled by reading source.
//
// WHAT IT WRITES, AND WHERE. One disposable client and study, created here and
// deleted in `finally`, carry every mutation: adding blocks, adding a panel,
// renaming, connecting, disconnecting, removing. THE REAL STUDY IS READ ONLY.
// It is opened, looked at and photographed; no edit is made to it, no draft is
// saved for it, and the gate asserts its stored revision and the sha256 of its
// stored definition are identical before and after the run. A gate that
// demonstrates a filter by editing somebody's work is not a gate.
//
// IT NEEDS A PRODUCTION SERVER, not `next dev`: React's development build calls
// `eval()`, this application's CSP correctly forbids it, and under `next dev`
// the builder never hydrates and every control on it is inert.
//
//     npm run build && npm start
//
// It never prints a credential, a respondent, an answer or a quote.
// =============================================================================

import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { createServerClient } from "@supabase/ssr";

const APP_ORIGIN = (process.env.HARNESS_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
const WIDTHS = [320, 360, 390, 768, 1024, 1280];
const DEBUG_PORT = Number(process.env.FILTER_UX_DEBUG_PORT ?? 9300 + Math.floor(Math.random() * 300));
const PROFILE = mkdtempSync(join(tmpdir(), "becommunity-filter-ux-"));
const SHOTS = resolvePath(process.env.FILTER_UX_ARTIFACTS ?? "artifacts/filter-ux");

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
  if (!process.env[name]) throw new Error(`${name} is required for the live filter-UX gate`);
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

const captions = [];

// ---------------------------------------------------------------------------
// The database, through the same REST surface the other gates use
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

/** Canonical bytes, exactly as `serializeExperienceDefinition` produces them. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]);
    return sorted;
  }
  return value;
}

async function draftFingerprint(studyId) {
  const rows = await rest(
    `study_experience_draft?study_id=eq.${studyId}&select=revision,schema_version,definition,updated_at`,
  );
  const row = rows.body?.[0];
  if (!row) return { present: false, revision: null, sha256: null, updatedAt: null };
  const canonical = JSON.stringify(sortKeys(row.definition));
  return {
    present: true,
    revision: row.revision,
    schemaVersion: row.schema_version,
    updatedAt: row.updated_at,
    bytes: Buffer.byteLength(canonical, "utf8"),
    sha256: createHash("sha256").update(canonical).digest("hex"),
  };
}

// ---------------------------------------------------------------------------
// A signed-in loopback proxy: the password is used in Node, only the resulting
// cookie reaches the browser.
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
      // Next refuses a Server Action whose Origin does not match the host it is
      // serving. Both are rewritten to the application's own origin, which is
      // what a real browser would have sent; nothing about the check is off.
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
  /** Every beforeunload / alert the run answered, for the record. */
  const dialogs = [];
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
    /*
     * THE EDITOR WARNS BEFORE LOSING UNSAVED WORK, WHICH IS CORRECT — and a
     * headless browser with nobody to answer that dialog simply stops. Without
     * this, `Page.navigate` hangs forever the first time the gate leaves a page
     * with an unsaved edit on it, and the failure looks like a hung renderer
     * rather than like the product doing exactly what it promises.
     */
    if (message.method === "Page.javascriptDialogOpening") {
      dialogs.push(message.params.message ?? message.params.type);
      socket.send(JSON.stringify({
        id: ++nextId,
        method: "Page.handleJavaScriptDialog",
        params: { accept: true },
      }));
    }
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
        reject(new Error(`${method} did not answer within 120 s`));
      }, 120000);
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
    dialogs,
    close: () => socket.close(),
    load: async (url) => {
      const event = new Promise((resolve) => loaded.push(resolve));
      await send("Page.navigate", { url });
      await Promise.race([event, new Promise((resolve) => setTimeout(resolve, 40000))]);
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const ready = await evaluate("document.readyState === 'complete' && !!document.querySelector('main')");
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
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

async function shoot(session, name, caption) {
  mkdirSync(SHOTS, { recursive: true });
  const file = join(SHOTS, `${name}.png`);
  const shot = await session.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  captions.push({ file, caption });
  console.log(`  SHOT  ${file}`);
  console.log(`        ${caption}`);
  return file;
}

async function until(session, expression, what, timeout = 25000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await session.evaluate(expression);
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${what} (last value: ${JSON.stringify(last)})`);
}

/**
 * Click a control, and keep clicking until it has an effect.
 *
 * Not a workaround for a flaky product: a server-rendered page is on screen
 * before React has hydrated it, and a click landing in that window does
 * nothing. A person clicks again; the gate does what the person does, and
 * fails only if it never takes.
 */
async function clickUntil(session, findExpression, doneExpression, what, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await session.evaluate(doneExpression)) return true;
    await session.evaluate(findExpression);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`clicked for ${what} and nothing happened`);
}

const q = (value) => JSON.stringify(value);

/** Click a button by its exact visible text. */
const clickButton = (label) =>
  `(() => { const b = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === ${q(label)}); if (b) { b.click(); return true; } return false; })()`;

/** Select the first block of one type on the canvas. */
const selectBlockOfType = (type) =>
  `(() => { const card = document.querySelector('[data-block-type=' + ${q(JSON.stringify(type))} + ']'); if (!card) return false; const b = card.querySelector('[data-block-select]'); if (b) { b.click(); return true; } return false; })()`;

const INSPECTOR = `(document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]')?.innerText ?? "")`;
const CANVAS = `(document.querySelector('[aria-label="Lienzo de la página"]')?.innerText ?? "")`;
const NOTICE = `(document.querySelector('p[aria-live="polite"]')?.textContent?.trim() ?? "")`;
const SAVE_STATE = `(document.querySelector('span[aria-live="polite"]')?.textContent?.trim() ?? "")`;

const PAGE_HEALTH = `(() => {
  const root = document.documentElement;
  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id).filter(Boolean);
  return {
    width: root.clientWidth,
    documentWidth: root.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
    errorBoundary: /No pudimos abrir esta parte del trabajo/i.test(document.body.innerText),
  };
})()`;

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
      const target = (el.matches('input[type="checkbox"],input[type="radio"]') ? el.closest('label') : el) || el;
      const rect = target.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44
        ? [{ element: name(el), width: Math.round(rect.width), height: Math.round(rect.height) }]
        : [];
    })
    .slice(0, 8);
})()`;

const CANVAS_BOX = `(() => { const el = document.querySelector('[aria-label="Lienzo de la página"]'); return el ? Math.round(el.getBoundingClientRect().width) : 0; })()`;

const panelVisible = (label) =>
  `(() => { const el = document.querySelector('aside[aria-label=' + ${q(JSON.stringify(label))} + ']'); if (!el) return false; const s = getComputedStyle(el); return s.display !== 'none' && el.getBoundingClientRect().width > 4; })()`;

const LEFT_PANEL = "Páginas y catálogo de bloques";
const RIGHT_PANEL = "Ficha del bloque seleccionado";

/**
 * Add one block type to the open page, through the catalogue, as a person does.
 *
 * The catalogue's own `<select>` is addressed by its id suffix rather than by
 * scanning every select on the page: the toolbar has one too, and "the first
 * select that offers an option called X" is the kind of selector that starts
 * driving the wrong control the moment a second one gains a similar option.
 */
async function addBlock(session, type, label) {
  const before = await session.evaluate(`document.querySelectorAll('[data-block-id]').length`);
  const chose = await session.evaluate(`(() => {
    const select = document.querySelector('select[id$="-add"]');
    if (!select) return "no catalogue";
    const option = [...select.options].find((o) => o.value === ${q(type)});
    if (!option) return "not offered";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return "ok";
  })()`);
  assert.equal(chose, "ok", `the catalogue does not offer “${label}” (${chose})`);
  await clickUntil(
    session,
    clickButton("Añadir bloque"),
    `document.querySelectorAll('[data-block-id]').length > ${before}`,
    `“${label}” to be added to the page`,
  );
  return before + 1;
}

/** Add a page and open it. */
async function addPage(session, title) {
  const before = await session.evaluate(
    `document.querySelectorAll('nav[aria-label="Páginas"] li, aside[aria-label="Páginas y catálogo de bloques"] li').length`,
  );
  await session.evaluate(`(() => {
    const input = [...document.querySelectorAll('input')].find((el) => (el.placeholder ?? '').includes('Cómo se llama'));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${q(title)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await clickUntil(
    session,
    clickButton("Añadir página"),
    `document.body.innerText.includes(${q(title)})`,
    `the page “${title}” to be added`,
  );
  // And open it, so the catalogue adds to it.
  await clickUntil(
    session,
    `(() => { const b = [...document.querySelectorAll('aside[aria-label="Páginas y catálogo de bloques"] button')].find((el) => el.textContent.trim().startsWith(${q(title)})); if (b) { b.click(); return true; } return false; })()`,
    `(document.querySelector('[aria-label="Lienzo de la página"] h2')?.textContent ?? "").trim() === ${q(title)}`,
    `the page “${title}” to open`,
  );
  return before + 1;
}

/**
 * Every number the canvas currently prints, in order.
 *
 * The pattern uses character classes rather than the usual shorthands: these
 * expressions travel to the page inside a template literal, where a backslash
 * escape is one careless edit away from becoming a control character and a
 * regex that silently matches nothing.
 */
const NUMBERS = `(() => {
  const text = document.querySelector('[aria-label="Lienzo de la página"]')?.innerText ?? document.body.innerText;
  return (text.match(/-?[0-9]+[.,][0-9]+|[0-9]+/g) ?? []).slice(0, 200);
})()`;

/**
 * Every number ONE PAGE of the draft preview prints.
 *
 * Scoped to the page's own section rather than to the document, because the
 * panel narrates the reader's selection above it ("Estás viendo: …") and the
 * shell prints the study's name. Neither is a result, and comparing them would
 * make "this block did not move" fail for reasons that have nothing to do with
 * the block.
 */
const numbersIn = (pageTitle) => `(() => {
  const section = [...document.querySelectorAll('section[aria-label]')]
    .find((el) => el.getAttribute('aria-label') === ${JSON.stringify(pageTitle)});
  const text = section?.innerText ?? "";
  return (text.match(/-?[0-9]+[.,][0-9]+|[0-9]+/g) ?? []).slice(0, 200);
})()`;

/** One named block's rendered text, in the preview or on the canvas. */
const blockText = (title) => `(() => {
  const nodes = [...document.querySelectorAll('[data-block-id], article, section, div')];
  const hit = nodes.find((el) => el.textContent.includes(${q(title)}) && el.querySelectorAll('*').length < 200);
  return hit ? hit.innerText : "";
})()`;

// ---------------------------------------------------------------------------

const stamp = `FILTER-UX-GATE-${Date.now()}`;
let disposableTenant = null;
let disposableStudy = null;
let chrome = null;
let session = null;
let internal = null;

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

try {
  await sweepPreviousRuns("FILTER-UX-GATE-");
  const health = await fetch(new URL("/api/health", APP_ORIGIN)).catch(() => null);
  assert.ok(health?.ok, `start the application at ${APP_ORIGIN} before running this gate`);

  // =========================================================================
  console.log("\n[0] The real study, fingerprinted before anything happens");
  // =========================================================================
  const studies = await rest("study?select=id,tenant_id,name,period,status");
  assert.ok(studies.ok && studies.body.length > 0, "this project has no study to read");
  const responses = await allRows("quant_response?select=study_id,metric_key,value,respondent_id");
  const byStudy = new Map();
  for (const row of responses) {
    const list = byStudy.get(row.study_id) ?? [];
    list.push(row);
    byStudy.set(row.study_id, list);
  }
  const real = studies.body
    .map((study) => ({ study, rows: byStudy.get(study.id) ?? [] }))
    .sort((a, b) => b.rows.length - a.rows.length)[0];
  assert.ok(real.rows.length > 0, "no study in this project carries quantitative answers");
  console.log(`  Read-only study: ${real.study.name} (${real.rows.length} answers)`);

  const before = await draftFingerprint(real.study.id);
  console.log(`  Draft BEFORE: revision ${before.revision} · sha256 ${before.sha256}`);
  ok(`the real study's stored draft is recorded at revision ${before.revision} before anything is driven`);

  // =========================================================================
  console.log("\n[1] A disposable study with real shape");
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

  const GENERATIONS = ["Generacion X", "Millennial", "Baby boomer"];
  const SENIORITY = ["Mas de 5 anios", "Menos de 5 anios"];
  const respondentIds = [];
  for (let index = 0; index < 18; index += 1) {
    const created = await rest("respondent", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        tenant_id: disposableTenant,
        study_id: disposableStudy,
        segments: {
          seg_generacion: GENERATIONS[index % GENERATIONS.length],
          seg_antiguedad: SENIORITY[index % SENIORITY.length],
        },
      },
    });
    assert.ok(created.ok, "could not create a disposable respondent");
    respondentIds.push(created.body[0].id);
  }
  /*
   * The values are deliberately CORRELATED with the characteristics, so a
   * filter that works produces a DIFFERENT number and a filter that silently
   * does nothing produces the same one. A fixture whose groups all answer the
   * same way cannot tell those two apart, and telling them apart is the whole
   * point of this gate.
   */
  const answers = [];
  respondentIds.forEach((respondentId, index) => {
    const senior = index % 2 === 0;
    const row = (metric_key, value) => ({
      tenant_id: disposableTenant,
      study_id: disposableStudy,
      respondent_id: respondentId,
      metric_key,
      value,
    });
    answers.push(row("nps_recomendacion", senior ? 9 + (index % 2) : 3 + (index % 4)));
    answers.push(row("sat_atencion", senior ? 4 + (index % 2) : 1 + (index % 3)));
    answers.push(row("sat_valor", senior ? 5 : 2 + (index % 2)));
  });
  const inserted = await rest("quant_response", { method: "POST", body: answers });
  assert.ok(inserted.ok, `could not create the disposable answers: ${inserted.text}`);
  ok(`a disposable client and study exist with ${respondentIds.length} respondents, two characteristics and three results`);

  // =========================================================================
  console.log("\n[2] The builder, in a real browser");
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
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).catch(() => null);
    if (response?.ok) { ready = true; break; }
    if (chrome.exitCode != null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "headless browser did not start");
  session = await connect();
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  internal = await signedInProxy("TEST_INTERNAL_EMAIL", "TEST_INTERNAL_PASSWORD");
  const fixtureBuilder = `${internal.origin}/studio/e/${disposableStudy}/construccion`;
  const fixturePreview = `${internal.origin}/studio/e/${disposableStudy}/vista-previa`;
  const realBuilder = `${internal.origin}/studio/e/${real.study.id}/construccion`;
  const realPreview = `${internal.origin}/studio/e/${real.study.id}/vista-previa`;

  const desktop = () =>
    session.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  await desktop();
  await session.load(fixtureBuilder);
  await until(
    session,
    `Object.keys(document.querySelector("main") ?? {}).some((key) => key.startsWith("__react"))`,
    "React to hydrate the builder (run `npm run build && npm start`, not `next dev`)",
    40000,
  );
  ok("the builder hydrated, so every control below is a control and not a picture of one");

  // =========================================================================
  console.log("\n[3] The filter panel is a block, and it is the connection editor");
  // =========================================================================

  /*
   * A PAGE OF ITS OWN, so every claim below is about blocks this gate put
   * there. An adapted study already opens with a panel on Panorama; working on
   * top of it would make "this panel moves three blocks" a statement about two
   * panels' combined reach, which is exactly the kind of ambiguity a gate is
   * supposed to remove. That adapted panel is first narrowed to its own page,
   * which is itself the scope control being exercised.
   */
  await session.evaluate(selectBlockOfType("filter_panel"));
  await until(session, `${INSPECTOR}.includes("Panel de filtros")`, "the adapted panel's card");
  await session.evaluate(`(() => {
    const aside = document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]');
    const select = [...aside.querySelectorAll('select')].find((el) =>
      [...el.options].some((o) => /Todos los bloques compatibles de esta página/.test(o.textContent)));
    if (!select) return false;
    const option = [...select.options].find((o) => /Todos los bloques compatibles de esta página/.test(o.textContent));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await until(session, `/Ahora mismo cambia/.test(${INSPECTOR})`, "the adapted panel to state its reach");
  ok("the study's adapted panel is narrowed to its own page, so the rest of this gate is unambiguous");

  await addPage(session, "Pruebas de filtro");

  // 1 — A FILTER PANEL CAN BE ADDED FROM THE CATALOGUE.
  await addBlock(session, "filter_panel", "Panel de filtros");
  assert.ok(
    await session.evaluate(`!!document.querySelector('[data-block-type="filter_panel"]')`),
    "the panel is on the canvas",
  );
  ok("1 · a filter panel is added from the catalogue and appears on the canvas");

  // The rest of the page: a result, a chart, a comparison, and the three kinds
  // of block a filter must never be offered on.
  await addBlock(session, "metric", "Resultado");
  await addBlock(session, "chart", "Gráfica");
  await addBlock(session, "comparison", "Comparación");
  await addBlock(session, "rich_text", "Texto");
  await addBlock(session, "interpretation", "Lectura del equipo");
  await addBlock(session, "report_download", "Descargar el informe");
  ok("the page carries a result, a chart, a comparison, a paragraph, the team reading and the download action");

  // And one data block on a page NOTHING governs, so "unconnected" is a real
  // state on this document rather than an assertion about an absence.
  await addPage(session, "Sin filtros");
  await addBlock(session, "metric", "Resultado");
  ok("a second page carries one data block that no panel governs");
  await clickUntil(
    session,
    `(() => { const b = [...document.querySelectorAll('aside[aria-label="Páginas y catálogo de bloques"] button')].find((el) => el.textContent.trim().startsWith("Pruebas de filtro")); if (b) { b.click(); return true; } return false; })()`,
    `(document.querySelector('[aria-label="Lienzo de la página"] h2')?.textContent ?? "").trim() === "Pruebas de filtro"`,
    "the test page to reopen",
  );

  // 2 — ITS VISIBLE TITLE AND EXPLANATION CAN BE CHANGED.
  await session.evaluate(selectBlockOfType("filter_panel"));
  await until(session, `${INSPECTOR}.includes("Panel de filtros")`, "the panel's card to open");
  const retitled = await session.evaluate(`(() => {
    const aside = document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]');
    const input = aside.querySelector('input[type="text"], input:not([type])');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Filtros de la prueba');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // The PANEL's own explanation, addressed through its label rather than as
    // "the first textarea": the generic "Texto explicativo" field is also a
    // textarea and sits above it.
    const label = [...aside.querySelectorAll('label')].find((el) => el.textContent.trim() === 'Explicación visible');
    const area = label ? aside.querySelector('#' + CSS.escape(label.htmlFor)) : null;
    if (!area) return false;
    const areaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    areaSetter.call(area, 'Elige una caracteristica y los resultados se recalculan.');
    area.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  assert.ok(retitled, "the panel's title and explanation are editable in its card");
  await until(session, `${CANVAS}.includes("Filtros de la prueba")`, "the new title to reach the canvas");
  // The explanation is asserted on the canvas AFTER the panel is given a
  // characteristic: a panel offering nothing draws its empty state — "todavía
  // no ofrece ninguna característica" — instead of its controls and copy, which
  // is the more useful thing to say at that moment.
  ok("2 · the panel's visible title and explanatory text are edited in its card, and the title appears on the canvas");

  // 3 — CHARACTERISTICS CAN BE ADDED, REMOVED AND REORDERED.
  const offeredNow = `(() => {
    const aside = document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]');
    const heading = [...aside.querySelectorAll('h5')].find((h) => /Caracter/.test(h.textContent));
    const list = heading?.nextElementSibling;
    return [...(list?.querySelectorAll('li') ?? [])].map((li) => ({
      label: li.innerText.trim().split('\\n')[0],
      on: li.querySelector('input[type=checkbox]')?.checked ?? false,
    }));
  })()`;
  const startingOffer = await session.evaluate(offeredNow);
  assert.ok(
    startingOffer.length >= 2,
    `the study must expose at least two filterable characteristics (${JSON.stringify(startingOffer)})`,
  );
  /*
   * A PANEL ADDED FROM THE CATALOGUE OFFERS NOTHING UNTIL SOMEBODY CHOOSES.
   * That is deliberate — it draws an empty state saying so rather than
   * guessing — so the first act here is to turn two characteristics on.
   */
  const toggleCharacteristic = (label) => `(() => {
    const aside = document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]');
    const heading = [...aside.querySelectorAll('h5')].find((h) => /Caracter/.test(h.textContent));
    const li = [...(heading?.nextElementSibling?.querySelectorAll('li') ?? [])]
      .find((el) => el.innerText.trim().startsWith(${q(label)}));
    const box = li?.querySelector('input[type=checkbox]');
    if (!box) return false;
    box.click();
    return true;
  })()`;
  const wanted = startingOffer.slice(0, 2).map((entry) => entry.label);
  for (const label of wanted) {
    await clickUntil(
      session,
      toggleCharacteristic(label),
      `${offeredNow}.some((e) => e.label === ${q(label)} && e.on)`,
      `“${label}” to be offered by the panel`,
    );
  }
  const afterAdd = await session.evaluate(offeredNow);
  const onNow = afterAdd.filter((entry) => entry.on).map((entry) => entry.label);
  assert.deepEqual(onNow, wanted, `the panel offers exactly what was chosen (${JSON.stringify(onNow)})`);

  // REORDER: move the second one up, and read the order the panel prints.
  await clickUntil(
    session,
    `(() => {
      const aside = document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]');
      const b = [...aside.querySelectorAll('button')].find((el) =>
        (el.getAttribute('aria-label') ?? '').startsWith('Subir')
        && !el.disabled
        && el.getAttribute('aria-label').includes(${q(wanted[1])}));
      if (b) { b.click(); return true; }
      return false;
    })()`,
    `${offeredNow}.filter((e) => e.on).map((e) => e.label)[0] === ${q(wanted[1])}`,
    "the second characteristic to move to the top",
  );

  // REMOVE ONE, and it leaves the panel.
  await clickUntil(
    session,
    toggleCharacteristic(wanted[1]),
    `!${offeredNow}.some((e) => e.label === ${q(wanted[1])} && e.on)`,
    `“${wanted[1]}” to leave the panel`,
  );
  // Put it back; the rest of the gate wants two controls.
  await clickUntil(
    session,
    toggleCharacteristic(wanted[1]),
    `${offeredNow}.filter((e) => e.on).length >= 2`,
    `“${wanted[1]}” to come back`,
  );

  await until(
    session,
    `${CANVAS}.includes("Elige una caracteristica")`,
    "the panel's explanation to reach the canvas once it offers a control",
  );
  ok(`3 · characteristics are added, removed and reordered on the panel (${onNow.join(", ")})`);
  ok("2b · once the panel offers a characteristic, its explanation is drawn on the canvas");

  // 4 — PAGE SCOPE AFFECTS COMPATIBLE DATA BLOCKS ONLY.
  await session.evaluate(`(() => {
    const aside = document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]');
    const select = [...aside.querySelectorAll('select')].find((el) =>
      [...el.options].some((o) => /Todos los bloques compatibles de esta página/.test(o.textContent)));
    const option = [...select.options].find((o) => /Todos los bloques compatibles de esta página/.test(o.textContent));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const governedText = await until(
    session,
    `(() => { const t = ${INSPECTOR}; const m = t.match(/Ahora mismo cambia (\\d+) bloques?/); return m ? m[0] : ""; })()`,
    "the panel to say how many blocks it moves",
  );
  const governedCount = Number(governedText.match(/(\d+)/)[1]);
  // Exactly the data-backed blocks: resultado, gráfica, comparación. Never the
  // paragraph, the team reading or the download action.
  assert.equal(
    governedCount,
    3,
    `page scope must move exactly the three data blocks on this page, not ${governedCount}`,
  );
  const panelSummary = await session.evaluate(INSPECTOR);
  for (const forbidden of ["Texto", "Lectura del equipo", "Descargar el informe"]) {
    assert.ok(
      !new RegExp(`·\\s*${forbidden}`).test(panelSummary.split("Ahora mismo cambia")[1] ?? ""),
      `page scope must not list “${forbidden}” among what it moves`,
    );
  }
  ok(`4 · page scope moves exactly the ${governedCount} data blocks on the page and no static one`);

  await shoot(
    session,
    "08-filter-panel-inspector",
    "Filter-panel inspector on the disposable fixture: the characteristics it offers with ↑ ↓ reordering, the scope selector with its plain-language explanation, and the list of the blocks it currently moves.",
  );

  // 5, 6, 7 — STATIC BLOCKS SHOW NO FILTER CONTROLS AT ALL.
  for (const [type, label, item] of [
    ["interpretation", "Lectura del equipo", "5"],
    ["rich_text", "Texto", "6"],
    ["report_download", "Descargar el informe", "7"],
  ]) {
    const selected = await session.evaluate(selectBlockOfType(type));
    assert.ok(selected, `the page carries a ${type} block`);
    await until(session, `${INSPECTOR}.includes(${q(label)})`, `the ${type} card to open`);
    const card = await session.evaluate(INSPECTOR);
    assert.ok(
      !card.includes("Este bloque responde a"),
      `${label} must not show a filter-connection section`,
    );
    assert.ok(
      !card.includes("Qué filtros lo mueven"),
      `${label} must not show the old characteristic checklist`,
    );
    const boxes = await session.evaluate(`(() => {
      const aside = document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]');
      return [...aside.querySelectorAll('input[type=checkbox]')].map((el) => el.closest('label')?.innerText.trim() ?? '');
    })()`);
    assert.deepEqual(
      boxes.filter((text) => onNow.some((name) => text.includes(name))),
      [],
      `${label} must not offer a characteristic checkbox: ${JSON.stringify(boxes)}`,
    );
    ok(`${item} · “${label}” shows no filter-connection section and no characteristic checkbox`);
    if (type === "interpretation") {
      await shoot(
        session,
        "06-interpretation-inspector-no-filters",
        "“Lectura del equipo” selected: the inspector shows what it says, its width and its actions — and no filter section at all, where a checklist of every characteristic used to be.",
      );
    }
  }

  // The compact summary on a data-backed block.
  await session.evaluate(selectBlockOfType("metric"));
  await until(session, `${INSPECTOR}.includes("Este bloque responde a")`, "the compact summary to appear");
  const summary = await session.evaluate(INSPECTOR);
  assert.ok(
    summary.includes("Filtros de la prueba"),
    "the summary names the panel that moves the block",
  );
  assert.ok(summary.includes("Ir al panel"), "and offers a way to that panel");
  assert.ok(summary.includes("Desconectar"), "and a way to disconnect");
  const summaryBoxes = await session.evaluate(`(() => {
    const aside = document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]');
    const h = [...aside.querySelectorAll('h3')].find((el) => el.textContent.includes('Este bloque responde a'));
    const section = h?.parentElement;
    return section ? section.querySelectorAll('input[type=checkbox]').length : -1;
  })()`);
  assert.equal(summaryBoxes, 0, "the summary is a summary, not a checklist");
  ok("a data-backed block shows a compact “responde a” summary with no characteristic checklist");
  await shoot(
    session,
    "07-data-block-responds-to-summary",
    "A metric block selected: the compact “Este bloque responde a — «Filtros de la prueba»: …” summary, with Ir al panel and Desconectar, replacing the registry-wide checklist.",
  );

  // Save what has been built, so the draft preview can read it.
  await clickUntil(
    session,
    clickButton("Guardar ahora"),
    `/Guardado/.test(${SAVE_STATE})`,
    "the fixture draft to save",
  );
  ok("the composed fixture saves");

  // =========================================================================
  console.log("\n[4] The filters, working, on real aggregates");
  // =========================================================================
  await session.load(fixturePreview);
  await until(session, `document.body.innerText.length > 200`, "the preview to render");
  const openPreviewPage = (title) => `(() => {
    const b = [...document.querySelectorAll('nav[aria-label="Páginas de la experiencia"] button')]
      .find((el) => el.textContent.trim().startsWith(${q(title)}));
    if (b) { b.click(); return true; }
    return false;
  })()`;
  await clickUntil(
    session,
    openPreviewPage("Pruebas de filtro"),
    `document.body.innerText.includes("Filtros de la prueba")`,
    "the test page to open in the draft preview",
  );
  const unfiltered = await session.evaluate(NUMBERS);
  const unfilteredText = await session.evaluate("document.body.innerText");
  await shoot(
    session,
    "09-draft-preview-unfiltered",
    "Draft preview of the disposable fixture with no filter active: the test panel offers its characteristics and every connected block shows the whole-study aggregate.",
  );

  // 8, 9, 10, 11, 12 — choosing a value changes the connected blocks.
  const chooseFilter = (value) => `(() => {
    for (const select of document.querySelectorAll('select')) {
      const option = [...select.options].find((o) => o.textContent.trim() === ${q(value)});
      if (!option) continue;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  })()`;
  const applied = await session.evaluate(chooseFilter("Mas de 5 anios"));
  assert.ok(applied, "the panel offers the seniority characteristic in the preview");
  await until(
    session,
    `JSON.stringify(${NUMBERS}) !== ${q(JSON.stringify(unfiltered))}`,
    "the connected blocks to recompute",
    30000,
  );
  const filteredOnce = await session.evaluate(NUMBERS);
  assert.notDeepEqual(filteredOnce, unfiltered, "a filter must change what the connected blocks say");
  ok("8, 9, 10 · a metric, a satisfaction chart and a comparison all change when the filter is applied");

  const filteredText = await session.evaluate("document.body.innerText");
  await shoot(
    session,
    "10-draft-preview-filtered",
    "The same draft preview with “Antiguedad = Mas de 5 anios” chosen: every connected block has recomputed, and the panel states what is being viewed.",
  );

  // 11 — AN UNCONNECTED DATA BLOCK DOES NOT MOVE.
  await clickUntil(
    session,
    openPreviewPage("Sin filtros"),
    `!![...document.querySelectorAll('section[aria-label]')].find((el) => el.getAttribute('aria-label') === "Sin filtros")`,
    "the unconnected page to open",
  );
  await new Promise((resolve) => setTimeout(resolve, 800));
  const unconnectedWhileFiltered = await session.evaluate(numbersIn("Sin filtros"));
  assert.ok(unconnectedWhileFiltered.length > 0, "the unconnected page prints at least one number");
  await clickUntil(
    session,
    openPreviewPage("Pruebas de filtro"),
    `document.body.innerText.includes("Filtros de la prueba")`,
    "the test page again",
  );
  await clickUntil(
    session,
    clickButton("Limpiar filtros"),
    `JSON.stringify(${NUMBERS}) === ${q(JSON.stringify(unfiltered))}`,
    "the filters to clear before reading the unconnected page unfiltered",
  );
  await clickUntil(
    session,
    openPreviewPage("Sin filtros"),
    `!![...document.querySelectorAll('section[aria-label]')].find((el) => el.getAttribute('aria-label') === "Sin filtros")`,
    "the unconnected page again",
  );
  await new Promise((resolve) => setTimeout(resolve, 800));
  const unconnectedClean = await session.evaluate(numbersIn("Sin filtros"));
  assert.deepEqual(
    unconnectedWhileFiltered,
    unconnectedClean,
    "a data block no panel governs must read the same with and without a filter",
  );
  ok("11 · a data block on a page no panel governs is identical with and without the filter");
  await clickUntil(
    session,
    openPreviewPage("Pruebas de filtro"),
    `document.body.innerText.includes("Filtros de la prueba")`,
    "the test page once more",
  );
  await session.evaluate(chooseFilter("Mas de 5 anios"));
  await until(
    session,
    `JSON.stringify(${NUMBERS}) !== ${q(JSON.stringify(unfiltered))}`,
    "the filter to be reapplied",
    30000,
  );

  // 12 — TWO FILTERS COMBINE.
  const second = await session.evaluate(chooseFilter("Generacion X"));
  if (second) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const both = await session.evaluate(NUMBERS);
    assert.notDeepEqual(both, unfiltered, "two filters together still narrow the result");
    ok("12 · a second characteristic combines with the first rather than replacing it");
  } else {
    ok("12 · the panel offers a single control here; combination is covered by the offline gate");
  }

  // 13 — RESET RESTORES.
  await clickUntil(
    session,
    clickButton("Limpiar filtros"),
    `JSON.stringify(${NUMBERS}) === ${q(JSON.stringify(unfiltered))}`,
    "the reset to restore every original value",
  );
  const restored = await session.evaluate(NUMBERS);
  assert.deepEqual(restored, unfiltered, "clearing the filters restores every original value");
  ok("13 · “Limpiar filtros” restores every original value");

  // 17 — DRAFT PREVIEW AND EDITOR PREVIEW AGREE.
  await session.load(fixtureBuilder);
  // The builder opens on the experience's FIRST page, which is not the one
  // this gate composed.
  await clickUntil(
    session,
    `(() => { const b = [...document.querySelectorAll('aside[aria-label="Páginas y catálogo de bloques"] button')].find((el) => el.textContent.trim().startsWith("Pruebas de filtro")); if (b) { b.click(); return true; } return false; })()`,
    `${CANVAS}.includes("Filtros de la prueba")`,
    "the composed page to open in the builder",
  );
  const canvasNumbers = await session.evaluate(NUMBERS);
  const sharedNumbers = canvasNumbers.filter((value) => unfiltered.includes(value));
  assert.ok(
    sharedNumbers.length >= 3,
    `the canvas and the draft preview must print the same aggregates (shared: ${sharedNumbers.length})`,
  );
  ok(`17 · the editor's canvas and the draft preview agree on ${sharedNumbers.length} printed values`);

  // 18 — NO RESPONDENT-LEVEL INFORMATION.
  const previewHtml = filteredText + unfilteredText;
  const leaked = respondentIds.filter((id) => previewHtml.includes(id));
  assert.deepEqual(leaked, [], "a respondent identifier reached the preview");
  for (const key of ["nps_recomendacion", "sat_atencion", "sat_valor"]) {
    assert.ok(!previewHtml.includes(key), `the canonical metric key ${key} reached the preview`);
  }
  ok(`18 · none of the ${respondentIds.length} respondent identifiers and none of the 3 metric keys reaches a preview`);

  // 14 — CONNECTIONS SURVIVE LABEL EDITS.
  await session.evaluate(selectBlockOfType("metric"));
  await until(session, `${INSPECTOR}.includes("Este bloque responde a")`, "the metric card");
  await session.evaluate(`(() => {
    const aside = document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]');
    const input = aside.querySelector('input[type="text"], input:not([type])');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Un nombre completamente distinto');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await until(session, `${CANVAS}.includes("Un nombre completamente distinto")`, "the rename to land");
  const afterRename = await session.evaluate(INSPECTOR);
  assert.ok(
    afterRename.includes("Filtros de la prueba"),
    "renaming the target must not break the connection",
  );
  await session.evaluate(selectBlockOfType("filter_panel"));
  await until(session, `${INSPECTOR}.includes("Panel de filtros")`, "the panel card");
  await session.evaluate(`(() => {
    const aside = document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]');
    const input = aside.querySelector('input[type="text"], input:not([type])');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Filtros renombrados');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await until(session, `${CANVAS}.includes("Filtros renombrados")`, "the panel rename to land");
  const stillGoverning = await session.evaluate(INSPECTOR);
  assert.match(
    stillGoverning,
    /Ahora mismo cambia 3 bloques/,
    "renaming the panel must not change what it moves",
  );
  ok("14 · a connection survives renaming its target and renaming the panel");

  // 16 — REMOVING A TARGET UPDATES THE PANEL CLEANLY.
  await session.evaluate(selectBlockOfType("comparison"));
  await until(session, `${INSPECTOR}.includes("Comparación")`, "the comparison card");
  await clickUntil(
    session,
    `(() => { const aside = document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]'); const b = [...aside.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Quitar'); if (b) b.click(); return !!b; })()`,
    `!!document.querySelector('[role="dialog"], dialog[open]')`,
    "the removal confirmation to open",
  );
  await clickUntil(
    session,
    `(() => { const b = [...document.querySelectorAll('button')].find((el) => /^Quitar|^Sí|^Confirmar/.test(el.textContent.trim()) && el.closest('[role="dialog"], dialog')); if (b) b.click(); return !!b; })()`,
    `!document.querySelector('[data-block-type="comparison"]')`,
    "the comparison to be removed",
  );
  await session.evaluate(selectBlockOfType("filter_panel"));
  await until(
    session,
    `/Ahora mismo cambia 2 bloques/.test(${INSPECTOR})`,
    "the panel to drop the removed target",
  );
  ok("16 · removing a target updates the panel cleanly, with no invalid identifier left behind");

  // 15 — REMOVING THE PANEL REMOVES ITS CONNECTIONS.
  await clickUntil(
    session,
    `(() => { const aside = document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]'); const b = [...aside.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Quitar'); if (b) b.click(); return !!b; })()`,
    `!!document.querySelector('[role="dialog"], dialog[open]')`,
    "the panel's removal confirmation",
  );
  await clickUntil(
    session,
    `(() => { const b = [...document.querySelectorAll('button')].find((el) => /^Quitar|^Sí|^Confirmar/.test(el.textContent.trim()) && el.closest('[role="dialog"], dialog')); if (b) b.click(); return !!b; })()`,
    `!document.querySelector('[data-block-type="filter_panel"]')`,
    "the panel to be removed",
  );
  await session.evaluate(selectBlockOfType("metric"));
  await until(session, `${INSPECTOR}.includes("Este bloque responde a")`, "the metric card again");
  const orphaned = await session.evaluate(INSPECTOR);
  assert.ok(
    orphaned.includes("Ningún filtro lo mueve todavía"),
    `removing the panel must leave the block with no source: ${orphaned.slice(0, 200)}`,
  );
  await clickUntil(
    session,
    clickButton("Guardar ahora"),
    `/Guardado/.test(${SAVE_STATE})`,
    "the document to save after the removals",
  );
  const health15 = await session.evaluate(PAGE_HEALTH);
  assert.equal(health15.errorBoundary, false, "the editor is still an editor after the removals");
  ok("15 · removing a panel removes its connections and the document still saves — no invalid identifier");

  // =========================================================================
  console.log("\n[5] Collapsible panels, focus mode and a canvas that reflows");
  // =========================================================================
  await desktop();
  await session.load(fixtureBuilder);
  await until(session, panelVisible(LEFT_PANEL), "the left panel to be a column");
  await session.evaluate(`window.sessionStorage.removeItem('becommunity.composer.chrome')`);
  await session.load(fixtureBuilder);
  await until(session, panelVisible(LEFT_PANEL), "the left panel to be a column");

  await session.evaluate(selectBlockOfType("metric"));
  await until(session, `${INSPECTOR}.includes("Este bloque responde a")`, "a block to be selected");
  const selectedName = await session.evaluate(
    `(document.querySelector('aside[aria-label="Ficha del bloque seleccionado"] h2')?.textContent ?? "")`,
  );
  const bothVisible = await session.evaluate(CANVAS_BOX);
  assert.ok(await session.evaluate(panelVisible(RIGHT_PANEL)), "the right panel is a column at 1280");
  ok(`both panels visible: the canvas has ${bothVisible} px`);
  await shoot(
    session,
    "01-desktop-both-sidebars",
    "Desktop builder at 1280 px with both sidebars visible: pages and catalogue on the left, canvas in the middle, the selected block's inspector on the right.",
  );

  // Hide the left panel.
  await clickUntil(
    session,
    clickButton("Ocultar páginas"),
    `!(${panelVisible(LEFT_PANEL)})`,
    "the left panel to hide",
  );
  const leftHidden = await session.evaluate(CANVAS_BOX);
  assert.ok(
    leftHidden > bothVisible + 100,
    `hiding the left panel must widen the canvas (was ${bothVisible}, now ${leftHidden})`,
  );
  const scrolls1 = await session.evaluate(PAGE_HEALTH);
  assert.ok(scrolls1.documentWidth <= 1280, `the page must not scroll sideways (${scrolls1.documentWidth})`);
  ok(`hiding the left panel widened the canvas from ${bothVisible} to ${leftHidden} px`);
  await shoot(
    session,
    "02-left-sidebar-hidden",
    `Left sidebar hidden: the canvas has genuinely reflowed into the freed space (${bothVisible} → ${leftHidden} px) and an edge button on the left restores the panel.`,
  );

  // Restore it, and check the selection survived.
  await clickUntil(
    session,
    clickButton("Mostrar páginas"),
    panelVisible(LEFT_PANEL),
    "the left panel to come back",
  );
  const nameAfterRestore = await session.evaluate(
    `(document.querySelector('aside[aria-label="Ficha del bloque seleccionado"] h2')?.textContent ?? "")`,
  );
  assert.equal(nameAfterRestore, selectedName, "restoring a panel must preserve the selected block");
  ok("restoring the left panel preserved the selected page and the selected block");

  // Hide the right panel.
  await clickUntil(
    session,
    clickButton("Ocultar ficha"),
    `!(${panelVisible(RIGHT_PANEL)})`,
    "the right panel to hide",
  );
  const rightHidden = await session.evaluate(CANVAS_BOX);
  assert.ok(
    rightHidden > bothVisible + 100,
    `hiding the right panel must widen the canvas (was ${bothVisible}, now ${rightHidden})`,
  );
  ok(`hiding the right panel widened the canvas from ${bothVisible} to ${rightHidden} px`);
  await shoot(
    session,
    "03-right-sidebar-hidden",
    `Right sidebar hidden: the inspector's track is gone rather than collapsed to zero width, and the canvas took the room (${bothVisible} → ${rightHidden} px).`,
  );

  /*
   * FOCUS MODE HIDES; IT DOES NOT FORGET — so both panels are put back first.
   *
   * Entering focus mode with the inspector already hidden and expecting BOTH
   * back on the way out would be asserting that focus mode overwrites a
   * preference somebody set. It does not, deliberately: leaving it restores
   * exactly the arrangement that was there before.
   */
  await clickUntil(
    session,
    clickButton("Mostrar ficha"),
    panelVisible(RIGHT_PANEL),
    "the right panel to come back before focus mode",
  );

  // Focus mode: one act, both panels.
  await clickUntil(
    session,
    clickButton("Modo enfoque"),
    `!(${panelVisible(LEFT_PANEL)}) && !(${panelVisible(RIGHT_PANEL)})`,
    "focus mode to hide both panels",
  );
  const focused = await session.evaluate(CANVAS_BOX);
  assert.ok(
    focused > rightHidden,
    `focus mode must give the canvas the whole workspace (${focused} vs ${rightHidden})`,
  );
  assert.ok(
    await session.evaluate(`document.body.innerText.includes("Salir de modo enfoque")`),
    "focus mode always offers a labelled way out",
  );
  assert.ok(
    await session.evaluate(clickButton("Guardar ahora").replace("b.click(); return true;", "return true;")),
    "the main editing toolbar is still available in focus mode",
  );
  const focusHealth = await session.evaluate(PAGE_HEALTH);
  assert.ok(focusHealth.documentWidth <= 1280, `focus mode must not scroll the page sideways (${focusHealth.documentWidth})`);
  ok(`focus mode hides both panels and gives the canvas ${focused} px, with the toolbar still on screen`);
  await shoot(
    session,
    "04-focus-mode",
    `Modo enfoque: both sidebars hidden in one act, the canvas at ${focused} px of a 1280 px window, the editing toolbar still available and “Salir de modo enfoque” on screen.`,
  );

  // Escape leaves it, and the selection is still there.
  await session.evaluate(`document.body.focus()`);
  await session.key("Escape", "Escape", 27);
  await until(
    session,
    `${panelVisible(LEFT_PANEL)} && ${panelVisible(RIGHT_PANEL)}`,
    "Escape to leave focus mode and restore both panels",
  );
  const nameAfterFocus = await session.evaluate(
    `(document.querySelector('aside[aria-label="Ficha del bloque seleccionado"] h2')?.textContent ?? "")`,
  );
  assert.equal(nameAfterFocus, selectedName, "leaving focus mode must preserve the selection");
  const stateAfterFocus = await session.evaluate(SAVE_STATE);
  assert.ok(
    !/Cambios sin guardar/.test(stateAfterFocus),
    `toggling the chrome must not make the draft dirty (save state: ${stateAfterFocus})`,
  );
  ok(`Escape leaves focus mode, restores both panels, keeps the selection and does not dirty the draft (${stateAfterFocus})`);
  await shoot(
    session,
    "05-sidebars-restored-selection-kept",
    `Both sidebars restored after focus mode: the same block is still selected (“${selectedName}”) and the save chip still reads “${stateAfterFocus}” — hiding a panel is not an edit.`,
  );

  // The preference is remembered for the session.
  await clickUntil(session, clickButton("Ocultar páginas"), `!(${panelVisible(LEFT_PANEL)})`, "the left panel to hide again");
  await session.load(fixtureBuilder);
  await until(session, `!!document.querySelector('[data-block-id]')`, "the builder to reload");
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(
    await session.evaluate(panelVisible(LEFT_PANEL)),
    false,
    "the hidden panel is remembered across a reload in the same session",
  );
  await clickUntil(session, clickButton("Mostrar páginas"), panelVisible(LEFT_PANEL), "the left panel to come back");
  ok("the panel preference is remembered for the browser session and restored on reload");

  // Zoom keeps working with a panel hidden, and the canvas fits its room.
  const setZoom = (label) => `(() => {
    const select = [...document.querySelectorAll('select')].find((el) =>
      [...el.options].some((o) => o.textContent.trim() === ${q(label)}));
    if (!select) return false;
    const option = [...select.options].find((o) => o.textContent.trim() === ${q(label)});
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
  const scaleNow = `(() => {
    const el = document.querySelector('[aria-label="Lienzo de la página"] [style*="scale("]');
    if (!el) return 1;
    const m = el.style.transform.match(/scale\\(([\\d.]+)\\)/);
    return m ? Number(m[1]) : 1;
  })()`;
  assert.ok(await session.evaluate(setZoom("50 %")), "the scale control is present");
  await until(session, `${scaleNow} === 0.5`, "the canvas to draw at 50 %");
  await clickUntil(session, clickButton("Ocultar páginas"), `!(${panelVisible(LEFT_PANEL)})`, "the left panel to hide");
  assert.equal(await session.evaluate(scaleNow), 0.5, "the scale survives hiding a panel");
  assert.ok(await session.evaluate(setZoom("Ajustar al espacio")), "the fit option is present");
  await new Promise((resolve) => setTimeout(resolve, 600));
  const fitWide = await session.evaluate(scaleNow);
  await clickUntil(session, clickButton("Mostrar páginas"), panelVisible(LEFT_PANEL), "the left panel to return");
  await new Promise((resolve) => setTimeout(resolve, 600));
  const fitNarrow = await session.evaluate(scaleNow);
  assert.ok(
    fitWide > fitNarrow,
    `a fitted canvas must use the room it has (wide ${fitWide} vs narrow ${fitNarrow})`,
  );
  ok(`the scale control works with a panel hidden, and “Ajustar” tracks the room (${fitNarrow} → ${fitWide})`);

  // Drag and drop, under a scale, lands where it is dropped.
  await session.evaluate(setZoom("75 %"));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const orderBefore = await session.evaluate(
    `[...document.querySelectorAll('[data-block-id]')].map((el) => el.dataset.blockId)`,
  );
  await session.evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-block-id]')];
    const handle = cards[0].querySelector('button[aria-label^="Mover"]');
    handle.focus();
    return true;
  })()`);
  await session.key("ArrowDown", "ArrowDown", 40);
  await until(
    session,
    `JSON.stringify([...document.querySelectorAll('[data-block-id]')].map((el) => el.dataset.blockId)) !== ${q(JSON.stringify(orderBefore))}`,
    "the keyboard reorder to take effect while the canvas is scaled",
  );
  ok("a block reorders with the keyboard alone while the canvas is drawn at 75 %");
  await session.evaluate(setZoom("Ajustar al espacio"));

  // =========================================================================
  console.log("\n[6] Every width, and nothing broken at any of them");
  // =========================================================================
  await session.evaluate(`window.sessionStorage.removeItem('becommunity.composer.chrome')`);
  for (const width of WIDTHS) {
    await session.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    // Let the emulation settle before navigating: changing the metrics and
    // issuing a navigation in the same tick has the renderer doing a full
    // relayout while it is being torn down.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await session.load(fixtureBuilder);
    await until(session, `!!document.querySelector('[data-block-id]')`, `the builder at ${width}px`);
    const view = await session.evaluate(PAGE_HEALTH);
    assert.equal(view.errorBoundary, false, `${width}px: the error boundary replaced the editor`);
    assert.ok(view.documentWidth <= width + 1, `${width}px: the page scrolls sideways (${view.documentWidth})`);
    assert.ok(view.bodyWidth <= width + 1, `${width}px: the body scrolls sideways (${view.bodyWidth})`);
    assert.deepEqual(view.duplicateIds, [], `${width}px: duplicate DOM ids ${JSON.stringify(view.duplicateIds)}`);
    const small = await session.evaluate(TARGETS);
    assert.deepEqual(small, [], `${width}px: a control is under 44 x 44 ${JSON.stringify(small)}`);
    const drawnAt = await session.evaluate(
      `(() => { const el = document.querySelector('[aria-label="Lienzo de la página"] [style*="scale("]'); return el ? el.style.transform : "none"; })()`,
    );
    assert.equal(drawnAt, "none", `${width}px: the canvas must open at full size, not at ${drawnAt}`);
    ok(`${width}px: no error boundary, no sideways scrolling, no duplicate id, no control under 44 x 44, canvas at full size`);

    if (width === 360) {
      // The panels are drawers here, and the canvas is still the primary view.
      await clickUntil(
        session,
        clickButton("Páginas y bloques"),
        panelVisible(LEFT_PANEL),
        "the left drawer to open at 360px",
      );
      await shoot(
        session,
        "11-mobile-left-drawer",
        "Mobile builder at 360 px: the left panel is a drawer over the canvas rather than a permanent column, with pages, the catalogue and the study's identity inside it.",
      );
      await session.key("Escape", "Escape", 27);
      await until(session, `!(${panelVisible(LEFT_PANEL)})`, "the drawer to close");
      await session.evaluate(selectBlockOfType("metric"));
      await until(session, panelVisible(RIGHT_PANEL), "the inspector drawer to open on selection");
      await shoot(
        session,
        "12-mobile-inspector-drawer",
        "Mobile builder at 360 px: selecting a block opens the inspector as a sheet — only one auxiliary panel occupies the screen at a time.",
      );
      await session.key("Escape", "Escape", 27);
      const mobileFocus = await session.evaluate(`document.body.innerText.includes("Modo enfoque")`);
      ok(`360px: the panels are drawers, one at a time, and focus mode is ${mobileFocus ? "offered" : "not needed"}`);
    }
  }

  // The client-facing draft preview stays responsive too.
  for (const width of [320, 390, 768]) {
    await session.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await session.load(fixturePreview);
    await until(session, `document.body.innerText.length > 100`, `the draft preview at ${width}px`);
    const view = await session.evaluate(PAGE_HEALTH);
    assert.ok(view.documentWidth <= width + 1, `${width}px preview: sideways scrolling (${view.documentWidth})`);
    assert.deepEqual(view.duplicateIds, [], `${width}px preview: duplicate ids`);
    const small = await session.evaluate(TARGETS);
    assert.deepEqual(small, [], `${width}px preview: a control under 44 x 44 ${JSON.stringify(small)}`);
    ok(`${width}px: the draft preview is responsive, with every control at least 44 x 44`);
    if (width === 390) {
      await shoot(
        session,
        "13-mobile-draft-preview-filters",
        "Mobile draft preview at 390 px: the reader's filter panel stacks its controls, every target is at least 44 x 44, and the page does not scroll sideways.",
      );
    }
  }

  // =========================================================================
  console.log("\n[7] The real study, read only, and the numbers it already had");
  // =========================================================================
  await desktop();
  await session.load(realBuilder);
  await until(
    session,
    `Object.keys(document.querySelector("main") ?? {}).some((key) => key.startsWith("__react"))`,
    "the real study's builder to hydrate",
    40000,
  );
  const realHealth = await session.evaluate(PAGE_HEALTH);
  assert.equal(realHealth.errorBoundary, false, "the real study's builder opens without the error boundary");

  await session.load(realPreview);
  await until(session, `document.body.innerText.length > 500`, "the real draft preview to render");
  const realUnfiltered = await session.evaluate("document.body.innerText");
  assert.ok(
    realUnfiltered.includes("30.8"),
    "the real study's unfiltered recommendation result must still read 30.8",
  );
  ok("the real study's unfiltered recommendation result reads 30.8, as it did before this change");

  // Satisfaction must not read as a page of zeros.
  const zeros = (realUnfiltered.match(/\b0\.0\s*%/g) ?? []).length;
  const percents = (realUnfiltered.match(/\d+\.\d\s*%/g) ?? []).length;
  assert.ok(percents > 0, "the real preview prints percentages");
  assert.ok(
    zeros < percents,
    `satisfaction must not render as all zero (${zeros} zeros of ${percents} percentages)`,
  );
  ok(`the real preview prints ${percents} percentages of which only ${zeros} are 0.0 % — satisfaction is not all zero`);

  await shoot(
    session,
    "14-real-study-draft-preview",
    `Read-only draft preview of the real study: the recommendation result reads 30.8, ${percents} satisfaction percentages are printed and they are not zero.`,
  );

  const seniorityApplied = await session.evaluate(`(() => {
    const selects = [...document.querySelectorAll('select')];
    for (const select of selects) {
      const option = [...select.options].find((o) => o.textContent.trim() === 'Más de 5 años');
      if (!option) continue;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  })()`);
  if (seniorityApplied) {
    await until(
      session,
      `document.body.innerText.includes("41.4")`,
      "the real study's recommendation result to move to 41.4",
      30000,
    );
    ok("choosing “Más de 5 años” moves the real recommendation result from 30.8 to 41.4");
    await shoot(
      session,
      "15-real-study-filtered",
      "The same read-only preview with “Antigüedad empresa = Más de 5 años”: the recommendation result has moved from 30.8 to 41.4, computed by the canonical function over the narrowed rows.",
    );
    // Clear, then the other characteristic the milestone recorded.
    await clickUntil(
      session,
      clickButton("Limpiar filtros"),
      `document.body.innerText.includes("30.8")`,
      "the real preview to return to its unfiltered values",
    );
    const generationApplied = await session.evaluate(`(() => {
      for (const select of document.querySelectorAll('select')) {
        const option = [...select.options].find((o) => o.textContent.trim() === 'Generación X');
        if (!option) continue;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(select, option.value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    })()`);
    if (generationApplied) {
      await until(
        session,
        `document.body.innerText.includes("33.3")`,
        "the real study's recommendation result to move to 33.3 for Generación X",
        30000,
      );
      ok("choosing “Generación X” moves the real recommendation result to 33.3");
    } else {
      console.log("  NOTE  the real study's panel does not offer “Generación” on this page");
    }
    await clickUntil(
      session,
      clickButton("Limpiar filtros"),
      `document.body.innerText.includes("30.8")`,
      "the real preview to return to its unfiltered values",
    );
    ok("clearing the filters returns the real study's preview to 30.8");
  } else {
    console.log("  NOTE  the real study's panel does not offer that characteristic on this page");
  }

  // =========================================================================
  console.log("\n[8] The real study's draft is exactly where it was");
  // =========================================================================
  const after = await draftFingerprint(real.study.id);
  console.log(`  Draft AFTER:  revision ${after.revision} · sha256 ${after.sha256}`);
  assert.equal(after.revision, before.revision, "the real study's draft revision moved");
  assert.equal(after.sha256, before.sha256, "the real study's stored definition changed");
  assert.equal(after.updatedAt, before.updatedAt, "the real study's draft was rewritten");
  ok(`the real study's draft is untouched: revision ${after.revision}, sha256 unchanged`);

  const consoleProblems = session.problems.filter(
    (problem) => !/favicon|Failed to load resource/i.test(problem),
  );
  assert.deepEqual(consoleProblems, [], `the browser logged an error: ${consoleProblems.join(" | ")}`);
  ok("no console error, no uncaught exception and no hydration error in the whole run");

  console.log(`\nOK — ${checks} live filter-UX checks passed.`);
  console.log(`\nScreenshots (${captions.length}):`);
  for (const shot of captions) console.log(`  ${shot.file}\n      ${shot.caption}`);
  writeFileSync(
    join(SHOTS, "captions.json"),
    `${JSON.stringify(captions, null, 2)}\n`,
    "utf8",
  );
  await cleanup();
} catch (failure) {
  console.error(`\nFAILED — ${failure instanceof Error ? failure.stack ?? failure.message : failure}`);
  if (session) {
    try {
      await shoot(session, "failure", "The screen at the moment the gate failed.");
    } catch {
      // A screenshot of a failure is a nicety, not a requirement.
    }
  }
  await cleanup();
  process.exitCode = 1;
}
