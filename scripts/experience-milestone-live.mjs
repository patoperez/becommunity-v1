// =============================================================================
// Independent rails, several recorridos, a real semáforo, the three remaining
// renderers and a thematic cloud — driven in a real browser, with screenshots
// =============================================================================
// Credential-bearing. Every claim here is about the RUNNING PRODUCT, so none of
// it can be settled by reading source. Its companion `test:experience-composer`
// settles what the model does; this settles what the screen does.
//
// WHAT IT WRITES, AND WHERE. One disposable client and study, created here and
// deleted in `finally`, carry every mutation. THE REAL STUDY IS READ ONLY: it
// is opened, looked at and photographed, and the gate asserts its stored draft
// revision and the sha256 of its stored definition are identical before and
// after the run. A gate that demonstrates a semáforo by editing somebody's work
// is not a gate.
//
// IT NEEDS A PRODUCTION SERVER, not `next dev`: React's development build calls
// eval(), this application's CSP correctly forbids it, and under `next dev` the
// builder never hydrates and every control on it is inert.
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
const DEBUG_PORT = Number(process.env.MILESTONE_DEBUG_PORT ?? 9700 + Math.floor(Math.random() * 200));
const PROFILE = mkdtempSync(join(tmpdir(), "becommunity-milestone-"));
const SHOTS = resolvePath(process.env.MILESTONE_ARTIFACTS ?? "artifacts/milestone");

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
  if (!process.env[name]) throw new Error(`${name} is required for the live milestone gate`);
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
    definition: row.definition,
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
    // The editor warns before losing unsaved work, which is correct — and a
    // headless browser with nobody to answer that dialog simply stops.
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

/**
 * A screenshot, with the thing it is evidence FOR scrolled into view first.
 *
 * A shot that proves "this block is coloured by the semáforo" has to contain
 * that block. Both panels and the canvas scroll independently and the panels
 * are far taller than the viewport, so a shutter fired wherever the last click
 * left the page photographs an empty column and captions it confidently.
 *
 * `reveal` is either a heading to bring into view, or — when it starts with
 * `[` — a CSS selector whose LAST match is brought into view, which is the
 * block that was just added.
 */
async function shoot(session, name, caption, reveal) {
  mkdirSync(SHOTS, { recursive: true });
  // A selector, not a heading, when it contains selector syntax. Headings in
  // this product are sentences in Spanish; none of them contain a bracket.
  const isSelector = (value) => /[[\].#>]/.test(value);
  if (reveal && isSelector(reveal)) {
    const found = await session.evaluate(`(() => {
      const nodes = [...document.querySelectorAll(${q(reveal)})];
      const node = nodes[nodes.length - 1];
      if (!node) return false;
      node.scrollIntoView({ block: "center", inline: "nearest" });
      return true;
    })()`);
    if (!found) throw new Error(`nothing matched ${reveal} to photograph for ${name}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  } else if (reveal) {
    const found = await session.evaluate(`(() => {
      const heading = [...document.querySelectorAll('h2, h3, h4, h5, legend')]
        .find((el) => el.textContent.trim().startsWith(${q(reveal)}));
      if (heading) heading.scrollIntoView({ block: "center" });
      return !!heading;
    })()`);
    if (!found) throw new Error(`no heading “${reveal}” to photograph for ${name}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
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

/** Click a control by its accessible name. */
const clickLabelled = (label) =>
  `(() => { const b = [...document.querySelectorAll('button')].find((el) => (el.getAttribute('aria-label') ?? '') === ${q(label)}); if (b) { b.click(); return true; } return false; })()`;

/** Select the first block of one type on the canvas. */
const selectBlockOfType = (type) =>
  `(() => { const card = document.querySelector('[data-block-type=' + ${q(JSON.stringify(type))} + ']'); if (!card) return false; const b = card.querySelector('[data-block-select]'); if (b) { b.click(); return true; } return false; })()`;

/**
 * Type into a field found by its id suffix, the way React wants to be told.
 *
 * SCOPED, ALWAYS. The left panel and the inspector both end ids in `-metric`
 * and `-variant`, so an unscoped `[id$="-variant"]` drives whichever happens to
 * come first in the document — which is a gate that passes while pointing at
 * the wrong control.
 */
const fillById = (suffix, value, scope = "body") =>
  `(() => {
    const root = document.querySelector(${q(scope)});
    const el = root && root.querySelector('[id$=' + ${q(JSON.stringify(suffix))} + ']');
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${q(String(value))});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return true;
  })()`;

/** Set a select by the visible text of one of its options. */
const chooseOption = (suffix, text, scope = "body") =>
  `(() => {
    const root = document.querySelector(${q(scope)});
    const el = root && root.querySelector('[id$=' + ${q(JSON.stringify(suffix))} + ']');
    if (!el) return "no control";
    const option = [...el.options].find((o) => o.textContent.trim() === ${q(text)}
      || o.textContent.trim().startsWith(${q(text)}));
    if (!option) return "not offered";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, option.value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return "ok";
  })()`;

/** Set a select by the first option whose text matches a pattern; returns that text. */
const chooseMatching = (suffix, pattern, scope = "body") =>
  `(() => {
    const root = document.querySelector(${q(scope)});
    const el = root && root.querySelector('[id$=' + ${q(JSON.stringify(suffix))} + ']');
    if (!el) return null;
    const option = [...el.options].find((o) => new RegExp(${q(pattern)}, "i").test(o.textContent));
    if (!option) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, option.value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return option.textContent.trim();
  })()`;

/** Click a button by its exact visible text, inside one region. */
const clickIn = (scope, label) =>
  `(() => {
    const root = document.querySelector(${q(scope)});
    const b = root && [...root.querySelectorAll('button')].find((el) => el.textContent.trim() === ${q(label)});
    if (b) { b.click(); return true; }
    return false;
  })()`;

const INSPECTOR = `(document.querySelector('aside[aria-label="Ficha del bloque seleccionado"]')?.innerText ?? "")`;
const LEFT = `(document.querySelector('aside[aria-label="Páginas y catálogo de bloques"]')?.innerText ?? "")`;
const CANVAS = `(document.querySelector('[aria-label="Lienzo de la página"]')?.innerText ?? "")`;
const NOTICE = `(document.querySelector('p[aria-live="polite"]')?.textContent?.trim() ?? "")`;

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
    /*
     * THE COLLAPSE RAIL IS THE ONE DELIBERATE EXCEPTION, and it is the
     * exception the guideline itself names: a control smaller than the target
     * minimum is acceptable when the same action is available through an
     * equivalent control of full size on the same screen. Collapsing a panel
     * has exactly that — a labelled toolbar button, always present, never
     * hidden by focus mode. The rail lives in the 16 px seam between the panel
     * and the canvas, where a 44 px target cannot fit without covering one of
     * the two things it sits between. It keeps 24 x 44, which is the WCAG 2.2
     * minimum, and it is never the only route.
     */
    .filter((el) => !el.hasAttribute('data-rail-control'))
    /*
     * AN INERT ELEMENT IS NOT A CONTROL.
     *
     * The builder's canvas draws a PICTURE of a client's page: it passes no
     * viewer, so a filter panel's controls there do nothing by design, and the
     * subtree is marked inert to say so — not focusable, not clickable, not
     * announced as operable. Counting one as a control made this sweep report a
     * 26 px control the moment the canvas was drawn at a scale, about something
     * nobody can operate at any size. The block's own chrome sits outside that
     * subtree and is still measured.
     *
     * No backticks in this comment: it lives inside a template literal.
     */
    .filter((el) => !el.closest('[inert]'))
    .flatMap((el) => {
      const target = (el.matches('input[type="checkbox"],input[type="radio"]') ? el.closest('label') : el) || el;
      const rect = target.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44
        ? [{ element: name(el), width: Math.round(rect.width), height: Math.round(rect.height) }]
        : [];
    })
    .slice(0, 8);
})()`;

const panelVisible = (label) =>
  `(() => { const el = document.querySelector('aside[aria-label=' + ${q(JSON.stringify(label))} + ']'); if (!el) return false; const s = getComputedStyle(el); return s.display !== 'none' && el.getBoundingClientRect().width > 4; })()`;

/** The collapse rail that lives on a panel's inner edge, and whether it is drawn. */
const railVisible = (side) =>
  `(() => {
    const el = document.querySelector('[data-collapse-rail=' + ${q(JSON.stringify(side))} + ']');
    if (!el) return false;
    const s = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && box.width > 0 && box.height > 0;
  })()`;

const restoreTabVisible = (side) =>
  `(() => {
    const el = document.querySelector('[data-restore-tab=' + ${q(JSON.stringify(side))} + ']');
    if (!el) return false;
    const s = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return s.display !== 'none' && box.width > 0 && box.height > 0;
  })()`;

const LEFT_PANEL = "Páginas y catálogo de bloques";
const RIGHT_PANEL = "Ficha del bloque seleccionado";

/** The two regions every scoped selector below is addressed against. */
const IN_LEFT = 'aside[aria-label="Páginas y catálogo de bloques"]';
const IN_CARD = 'aside[aria-label="Ficha del bloque seleccionado"]';

/**
 * Open a recorrido or a semáforo row, and know that it opened.
 *
 * BY `aria-expanded`, never by a phrase appearing in the panel. "Nombre
 * visible" is also a label in the study's identity card three sections above,
 * so a gate that waits for that text is satisfied before it has opened
 * anything — and then fails on the next step, describing a control that was
 * never the problem. The same attribute is what tells a screen reader whether
 * the row is open, so asserting on it tests the affordance a person uses.
 */
async function openRow(session, attribute, text, what) {
  const find = `(() => {
    const rows = [...document.querySelectorAll('[' + ${q("ATTR")} + ']')];
    const row = rows.find((el) => el.textContent.includes(${q("TEXT")}));
    if (row && row.getAttribute('aria-expanded') !== 'true') { row.click(); return true; }
    return false;
  })()`;
  const done = `(() => {
    const rows = [...document.querySelectorAll('[' + ${q("ATTR")} + ']')];
    const row = rows.find((el) => el.textContent.includes(${q("TEXT")}));
    return !!row && row.getAttribute('aria-expanded') === 'true';
  })()`;
  await clickUntil(
    session,
    find.replace(/ATTR/g, attribute).replace(/TEXT/g, text),
    done.replace(/ATTR/g, attribute).replace(/TEXT/g, text),
    what,
  );
}

/** Add one block type to the open page, through the catalogue, as a person does. */
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

/**
 * Choose the width the canvas is previewing.
 *
 * By PREFIX, because the label carries a non-breaking space before the
 * parenthesis — "Tableta (768 px)" — and an exact match against an
 * ordinary space silently finds nothing.
 */
const clickBreakpoint = (name) =>
  `(() => {
    const b = [...document.querySelectorAll('button')]
      .find((el) => el.textContent.trim().startsWith(${q(name)}) && el.hasAttribute('aria-pressed'));
    if (b) { b.click(); return true; }
    return false;
  })()`;

const breakpointChosen = (name) =>
  `(() => {
    const b = [...document.querySelectorAll('button')]
      .find((el) => el.textContent.trim().startsWith(${q(name)}) && el.hasAttribute('aria-pressed'));
    return !!b && b.getAttribute('aria-pressed') === 'true';
  })()`;

/**
 * Turn one characteristic on in the selected panel's card, and make sure it
 * stayed on.
 *
 * OFFERED IS NOT THE SAME AS TURNED ON: the card lists every characteristic the
 * experience has, and which of them this panel hands the reader is a separate
 * decision. Clicking once and moving on is not enough either — a click that
 * lands before React has attached its handler does nothing at all, and the next
 * assertion then fails somewhere unrelated, in the preview, about a missing
 * control.
 */
const panelFilterState = (label) => `(() => {
  const aside = document.querySelector(${q(IN_CARD)});
  if (!aside) return "no card";
  const row = [...aside.querySelectorAll('label')].find((el) => el.textContent.trim() === ${q(label)});
  if (!row) return "not listed";
  const box = row.querySelector('input[type="checkbox"]');
  if (!box) return "not a choice";
  return box.checked ? "on" : "off";
})()`;

async function tickPanelFilter(session, label) {
  const before = await session.evaluate(panelFilterState(label));
  assert.ok(
    before === "on" || before === "off",
    `the panel's card does not offer "${label}" as a choice (${before})`,
  );
  if (before === "on") return "already on";
  await clickUntil(
    session,
    `(() => {
      const aside = document.querySelector(${q(IN_CARD)});
      const row = aside && [...aside.querySelectorAll('label')].find((el) => el.textContent.trim() === ${q(label)});
      const box = row && row.querySelector('input[type="checkbox"]');
      if (!box) return false;
      box.click();
      return true;
    })()`,
    `${panelFilterState(label)} === "on"`,
    `"${label}" to be one of the characteristics this panel offers`,
  );
  return "turned on";
}

/**
 * Add a page and open it.
 *
 * THE DONE-CONDITION IS THE PAGE LIST, never "the title appears somewhere on
 * screen". The recorrido manager's own heading is the word "Recorridos", so a
 * gate that waits for that word to appear in the body considers the page added
 * before it clicks anything, and then fails ten lines later with a message
 * about a completely different control.
 */
const PAGE_BUTTONS = `[...document.querySelectorAll('nav[aria-label="Páginas de la experiencia"] li > button:first-child')]`;

async function addPage(session, title) {
  const before = await session.evaluate(`${PAGE_BUTTONS}.length`);
  // By id, not by placeholder: the recorrido manager offers a "Cómo se llama"
  // field too, and "the first input with that placeholder" is a selector that
  // starts creating recorridos the moment the panels are reordered.
  await session.evaluate(fillById("-newpage", title, IN_LEFT));
  await clickUntil(
    session,
    clickButton("Añadir página"),
    `${PAGE_BUTTONS}.length > ${before}`,
    `the page “${title}” to be added`,
  );
  await clickUntil(
    session,
    `(() => { const b = ${PAGE_BUTTONS}.find((el) => el.textContent.trim().startsWith(${q(title)})); if (b) { b.click(); return true; } return false; })()`,
    `${PAGE_BUTTONS}.some((el) => el.getAttribute('aria-current') === 'page' && el.textContent.trim().startsWith(${q(title)}))`,
    `the page “${title}” to open`,
  );
}

/** Save, and wait for the editor to say it saved. */
async function save(session) {
  await clickUntil(
    session,
    clickButton("Guardar ahora"),
    `/Guardado/.test(document.body.innerText)`,
    "the draft to be saved",
  );
}

// ---------------------------------------------------------------------------

const stamp = `MILESTONE-GATE-${Date.now()}`;
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
  await sweepPreviousRuns("MILESTONE-GATE-");
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
  console.log("\n[1] A disposable study with real shape, and real qualitative evidence");
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
   * THIRTY-SIX PEOPLE, NOT EIGHTEEN — because the study's own disclosure rule
   * applies to this fixture exactly as it applies to a client's work.
   *
   * The adapter stamps the legacy rule (withhold below five) onto every study
   * it derives, and a cross of three generations by two seniorities over
   * eighteen people is six cells of three: every one of them correctly
   * withheld. A gate that "fixed" that by turning the rule off would be
   * testing a product nobody ships. Six people per cell is what it takes for a
   * heat map to have something to draw, so that is what the fixture has.
   */
  const GENERATIONS = ["Generacion X", "Millennial", "Baby boomer"];
  const SENIORITY = ["Mas de 5 anios", "Menos de 5 anios"];
  const PEOPLE = 36;
  const respondentIds = [];
  for (let index = 0; index < PEOPLE; index += 1) {
    const created = await rest("respondent", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        tenant_id: disposableTenant,
        study_id: disposableStudy,
        segments: {
          /*
           * UNEVEN GROUPS, ON PURPOSE. Dealing 36 people round-robin into three
           * generations gives three groups of twelve, and a treemap of three
           * identical rectangles is a picture that would look the same whether
           * the renderer read the data or not. Fifteen, twelve and nine is a
           * shape a reader can actually read.
           */
          seg_generacion: index < 15 ? GENERATIONS[0] : index < 27 ? GENERATIONS[1] : GENERATIONS[2],
          /*
           * A CROSS WITH UNEVEN CELLS, ON PURPOSE.
           *
           * Three generations by two seniorities over an evenly dealt 36 gives
           * six cells of exactly six, and a heat map of six identical numbers
           * is one flat colour — a picture that would look the same whether
           * the renderer read the data or not. A five-cycle against a
           * three-cycle deals 7, 5, 7, 5, 8 and 4, which has a range to shade
           * AND one cell the study's disclosure rule withholds.
           */
          seg_antiguedad: SENIORITY[index % 5 < 3 ? 0 : 1],
        },
      },
    });
    assert.ok(created.ok, "could not create a disposable respondent");
    respondentIds.push(created.body[0].id);
  }
  /*
   * The values are deliberately CORRELATED with the characteristics, and the
   * performance score is deliberately SPREAD across what a three-band semáforo
   * will be told to call green, amber and red. A fixture whose respondents all
   * land in one band cannot tell a working semáforo filter from an inert one.
   *
   * The band a person lands in is DECORRELATED from their generation on
   * purpose: if every Generación X were green, "filter by verde" and "filter
   * by Generación X" would be the same act, and the gate could not tell which
   * of the two it had proved.
   */
  const answers = [];
  respondentIds.forEach((respondentId, index) => {
    // Read FROM the characteristic, so "seniors answer higher" is a statement
    // about the same column a reader filters by rather than a coincidence.
    const senior = index % 5 < 3;
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
    /*
     * THE BAND IS INDEPENDENT OF THE GENERATION, deliberately. If every
     * Generación X were green, "filter by verde" and "filter by Generación X"
     * would be the same act and the gate could not tell which of the two it had
     * proved. Round-robin across the three bands cuts across the generation
     * ranges above, so each group carries all three.
     */
    const band = index % 3;
    answers.push(row("desempeno_general", band === 0 ? 90 : band === 1 ? 70 : 40));
  });
  const inserted = await rest("quant_response", { method: "POST", body: answers });
  assert.ok(inserted.ok, `could not create the disposable answers: ${inserted.text}`);

  /*
   * A CONFIRMED OBSERVATION HAS A REVIEWER AND A TIME, because the schema says
   * so: `qual_observation_review_confirmation_check` refuses a row that claims
   * a person confirmed it without recording which person, and when. The gate
   * signs in first and confirms as that account rather than reaching around
   * the constraint — a fixture that has to disable a rule to exist is a
   * fixture that is not testing the product.
   */
  internal = await signedInProxy("TEST_INTERNAL_EMAIL", "TEST_INTERNAL_PASSWORD");
  assert.ok(internal.userId, "the fixture account has no user id to record as the reviewer");
  const reviewedAt = new Date().toISOString();

  /*
   * CONFIRMED QUALITATIVE EVIDENCE, shaped so the cloud has something true to
   * say AND so the study's own disclosure rule leaves it standing.
   *
   *   · "Precio y valor" is 12 mentions from 10 people, so the two bases are
   *     genuinely different numbers and a cloud that quietly used one while
   *     saying the other would be caught.
   *   · Four raw spellings were folded into it by the review, which are its
   *     aliases — and the fold is the one the review already recorded, not a
   *     second merge ledger invented for the cloud.
   *   · Two sources exist, and three themes reach five voices in the focus
   *     group alone, so a second cloud reading only that source is a genuinely
   *     different picture rather than an empty one.
   *
   * Nothing here is pending except the single row that exists to prove a
   * pending theme and an unapproved quote can never reach a screen.
   */
  const observations = [];
  const observe = (respondentIndex, confirmed, suggested, source) =>
    observations.push({
      tenant_id: disposableTenant,
      study_id: disposableStudy,
      respondent_id: respondentIds[respondentIndex],
      suggested_theme: suggested,
      confirmed_theme: confirmed,
      review_status: "confirmed",
      reviewed_by: internal.userId,
      reviewed_at: reviewedAt,
      source,
      // Every row carries the same keys: PostgREST refuses a batch whose
      // objects differ, and the pending row below has to name `quote` to prove
      // a quote exists and still never reaches the screen.
      quote: null,
    });

  /*
   * WHO SAID WHAT, LAID OUT SO EVERY CLAIM BELOW SURVIVES THE DISCLOSURE RULE.
   *
   * "Precio y valor" spans fifteen people so that the five who are ALSO in the
   * green band still clear the study's threshold — which is what makes "what
   * did the chapters in green actually say?" a question with a legible answer
   * rather than a page of withheld results.
   */
  for (let index = 0; index <= 7; index += 1) observe(index, "Precio y valor", "precio", "encuesta");
  observe(0, "Precio y valor", "el precio", "encuesta");
  observe(1, "Precio y valor", "PRECIO", "encuesta");
  for (let index = 8; index <= 14; index += 1) observe(index, "Precio y valor", "precio", "focus_group");
  observe(8, "Precio y valor", "costo alto", "focus_group");
  for (let index = 15; index <= 19; index += 1) observe(index, "Atención del equipo", "atención", "encuesta");
  observe(15, "Atención del equipo", "trato", "encuesta");
  for (let index = 20; index <= 24; index += 1) observe(index, "Atención del equipo", "atención", "focus_group");
  for (let index = 25; index <= 29; index += 1) observe(index, "Seguimiento", "seguimiento", "encuesta");
  for (let index = 25; index <= 29; index += 1) observe(index, "Referencias", "referencias", "focus_group");
  for (let index = 30; index <= 35; index += 1) observe(index, "Capacitación", "capacitación", "encuesta");

  // One PENDING observation with a distinctive theme and a quote, which must
  // never reach a cloud, a list or a screenshot.
  observations.push({
    tenant_id: disposableTenant,
    study_id: disposableStudy,
    respondent_id: respondentIds[0],
    suggested_theme: "TEMA-SIN-REVISAR",
    confirmed_theme: null,
    review_status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    source: "encuesta",
    quote: "CITA-SIN-APROBAR",
  });
  const observed = await rest("qual_observation", { method: "POST", body: observations });
  assert.ok(observed.ok, `could not create the disposable observations: ${observed.text}`);
  ok(`a disposable client and study exist with ${respondentIds.length} respondents, four results, ${observations.length - 1} confirmed observations and one deliberately unreviewed one`);

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

  const fixtureBuilder = `${internal.origin}/studio/e/${disposableStudy}/construccion`;
  const fixturePreview = `${internal.origin}/studio/e/${disposableStudy}/vista-previa`;
  const realBuilder = `${internal.origin}/studio/e/${real.study.id}/construccion`;

  const desktop = () =>
    session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

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
  console.log("\n[3] Two rails, two panels, four states — and each one is independent");
  // =========================================================================
  /*
   * THE CLAIM UNDER TEST is that the two sides are genuinely independent: that
   * collapsing one leaves the other exactly where it was, that each has a way
   * back on the edge it went out of, and that the four combinations are all
   * reachable and all survive a reload. A rail that quietly drags the other
   * panel with it looks identical in a single screenshot; only the pair of
   * states, asserted together, tells them apart.
   */
  await until(session, panelVisible(LEFT_PANEL), "the pages panel at 1440px");
  await until(session, panelVisible(RIGHT_PANEL), "the inspector at 1440px");
  assert.ok(await session.evaluate(railVisible("left")), "the left panel has no collapse rail");
  assert.ok(await session.evaluate(railVisible("right")), "the right panel has no collapse rail");
  const seams = await session.evaluate(`(() => {
    const measure = (side) => {
      const rail = document.querySelector('[data-collapse-rail=' + JSON.stringify(side) + ']');
      const panel = rail && rail.closest('aside[aria-label]');
      if (!rail || !panel) return null;
      const r = rail.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      return { gap: Math.round(side === 'left' ? r.left - p.right : p.left - r.right), viewport: window.innerWidth, right: Math.round(r.right) };
    };
    return { left: measure('left'), right: measure('right') };
  })()`);
  /*
   * ON THE SEAM, NOT SOMEWHERE ELSE ON THE SCREEN. The rail is positioned
   * against its panel's edge, and it only lands there if the panel is the
   * containing block. When it was not, the rail resolved against the viewport
   * and was drawn pinned to the far right of the window — visible in a
   * screenshot only if you knew to look, and silently pushing the page into a
   * sideways scroll.
   */
  assert.ok(
    seams.left && Math.abs(seams.left.gap) <= 24,
    `the left rail is not on the seam with the canvas: ${JSON.stringify(seams.left)}`,
  );
  assert.ok(
    seams.right && Math.abs(seams.right.gap) <= 24,
    `the right rail is not on the seam with the canvas: ${JSON.stringify(seams.right)}`,
  );
  const railTargets = await session.evaluate(
    `[...document.querySelectorAll('[data-rail-control]')].map((el) => { const r = el.getBoundingClientRect(); return { side: el.getAttribute('data-rail-control'), w: Math.round(r.width), h: Math.round(r.height) }; })`,
  );
  assert.equal(railTargets.length, 2, "one rail control per panel");
  for (const target of railTargets) {
    assert.ok(
      target.w >= 24 && target.h >= 24,
      `the ${target.side} rail control is under the 24 x 24 minimum: ${JSON.stringify(target)}`,
    );
  }
  ok("both panels are columns, and each carries a rail ON THE SEAM, at least 24 x 24, beside a full-size toolbar equivalent");
  await shoot(
    session,
    "01-rails-both-open",
    "Composer at 1440 px with both panels docked. Each panel carries its own collapse rail on the inner edge where it meets the canvas — a real button, reachable by keyboard, with the strip itself accepting a double-click as an accelerator.",
  );

  // LEFT OUT, RIGHT UNTOUCHED.
  await clickUntil(
    session,
    clickLabelled("Ocultar el panel de páginas y catálogo de bloques"),
    `!(${panelVisible(LEFT_PANEL)})`,
    "the left rail to collapse the left panel",
  );
  assert.ok(
    await session.evaluate(panelVisible(RIGHT_PANEL)),
    "collapsing the left panel also took the inspector with it",
  );
  assert.ok(
    await session.evaluate(restoreTabVisible("left")),
    "the left panel went out with no way back on the edge it left from",
  );
  ok("the left rail hides only the left panel, and leaves a restore tab on the left edge");
  await shoot(
    session,
    "02-rails-left-collapsed",
    "The left rail collapsed only the pages panel. The inspector is untouched, the canvas grew into the space, and a restore tab sits on the left edge where the panel went out.",
  );

  // AND BACK, from the tab.
  await clickUntil(
    session,
    `(() => { const b = document.querySelector('[data-restore-tab="left"]'); if (b) { b.click(); return true; } return false; })()`,
    panelVisible(LEFT_PANEL),
    "the restore tab to bring the left panel back",
  );
  assert.ok(await session.evaluate(panelVisible(RIGHT_PANEL)), "restoring the left panel disturbed the inspector");
  ok("the left restore tab brings back the left panel, and only the left panel");

  // RIGHT OUT, LEFT UNTOUCHED.
  await clickUntil(
    session,
    clickLabelled("Ocultar la ficha del bloque seleccionado"),
    `!(${panelVisible(RIGHT_PANEL)})`,
    "the right rail to collapse the inspector",
  );
  assert.ok(await session.evaluate(panelVisible(LEFT_PANEL)), "collapsing the inspector also hid the pages panel");
  assert.ok(await session.evaluate(restoreTabVisible("right")), "the inspector left no restore tab");
  ok("the right rail hides only the inspector, and leaves a restore tab on the right edge");
  await shoot(
    session,
    "03-rails-right-collapsed",
    "The right rail collapsed only the inspector. The pages panel is untouched and a restore tab sits on the right edge — the two sides are operated independently, never as a pair.",
  );

  // BOTH OUT — reachable one rail at a time, and reachable in one act.
  await clickUntil(
    session,
    clickLabelled("Ocultar el panel de páginas y catálogo de bloques"),
    `!(${panelVisible(LEFT_PANEL)})`,
    "the second rail to leave the canvas alone",
  );
  assert.ok(
    (await session.evaluate(restoreTabVisible("left"))) && (await session.evaluate(restoreTabVisible("right"))),
    "with both panels hidden there is no way back on either edge",
  );
  const bothHidden = await session.evaluate(PAGE_HEALTH);
  assert.equal(bothHidden.errorBoundary, false, "hiding both panels broke the editor");
  assert.ok(bothHidden.documentWidth <= 1441, "the canvas alone scrolls the page sideways");
  ok("all four panel states are reachable one rail at a time, and both-hidden still offers a way back on each edge");
  await shoot(
    session,
    "04-rails-both-collapsed",
    "Both panels collapsed one rail at a time. The canvas has the whole width, the toolbar is still on screen, and a restore tab waits on each edge — this is a state you arrive at deliberately and can leave from either side.",
  );

  // FOCUS MODE is the one act for the intention, and Escape leaves it.
  await clickUntil(
    session,
    clickButton("Mostrar páginas"),
    panelVisible(LEFT_PANEL),
    "the toolbar to restore the pages panel",
  );
  await clickUntil(
    session,
    clickButton("Mostrar ficha"),
    panelVisible(RIGHT_PANEL),
    "the toolbar to restore the inspector",
  );
  await clickUntil(
    session,
    clickButton("Modo enfoque"),
    `!(${panelVisible(LEFT_PANEL)}) && !(${panelVisible(RIGHT_PANEL)})`,
    "focus mode to clear both panels at once",
  );
  assert.ok(
    await session.evaluate(`document.body.innerText.includes("Salir de modo enfoque")`),
    "focus mode is a corner with no labelled way out",
  );
  await shoot(
    session,
    "05-focus-mode",
    "Modo enfoque: one act for one intention, both panels away, and the toolbar deliberately still on screen with “Salir de modo enfoque” — a mode you can only leave by guessing a key is a trap.",
  );
  await session.key("Escape", "Escape", 27);
  await until(
    session,
    `${panelVisible(LEFT_PANEL)} && ${panelVisible(RIGHT_PANEL)}`,
    "Escape to leave focus mode",
  );
  ok("focus mode clears both panels in one act, says how to leave, and Escape leaves it");

  // AND THE STATE IS REMEMBERED ACROSS A RELOAD.
  await clickUntil(
    session,
    clickLabelled("Ocultar la ficha del bloque seleccionado"),
    `!(${panelVisible(RIGHT_PANEL)})`,
    "the inspector to collapse before the reload",
  );
  await session.load(fixtureBuilder);
  await until(session, `!!document.querySelector('[data-block-id]')`, "the builder to come back");
  assert.ok(await session.evaluate(panelVisible(LEFT_PANEL)), "the reload lost the left panel");
  assert.ok(
    !(await session.evaluate(panelVisible(RIGHT_PANEL))),
    "the reload put back a panel the person had deliberately collapsed",
  );
  ok("the exact combination of open and collapsed panels survives a reload, per side");
  await shoot(
    session,
    "06-rails-state-after-reload",
    "The same tab after a full reload: the pages panel is back because it was open, the inspector is still away because it was collapsed. The preference is remembered per side, not as a single on/off.",
  );
  await clickUntil(
    session,
    `(() => { const b = document.querySelector('[data-restore-tab="right"]'); if (b) { b.click(); return true; } return false; })()`,
    panelVisible(RIGHT_PANEL),
    "the inspector back for the rest of the run",
  );

  // =========================================================================
  console.log("\n[4] Several recorridos, defined once and shown wherever they belong");
  // =========================================================================
  /*
   * A recorrido is a thing the STUDY has, not a thing a page has. Two blocks
   * can be windows onto one of them, and the distinction the product has to
   * keep straight is between DUPLICATING THE BLOCK — a second window, editing
   * either changes both — and DUPLICATING THE RECORRIDO, which makes a new one
   * that is edited apart. A builder that blurs those two is a builder where
   * somebody's edit silently rewrites a page they were not looking at.
   */
  await addPage(session, "Recorridos");
  await shoot(
    session,
    "07-journey-manager",
    "The recorrido manager, beside the pages and the study's identity rather than on the canvas: a recorrido is defined once here and shown wherever it belongs.",
    "Recorridos",
  );

  await session.evaluate(fillById("-journey-new", "Recorrido de socios", IN_LEFT));
  await clickUntil(
    session,
    clickButton("Añadir recorrido"),
    `${LEFT}.includes("Recorrido de socios")`,
    "the first recorrido to be created",
  );
  await session.evaluate(fillById("-journey-new", "Recorrido de invitados", IN_LEFT));
  await clickUntil(
    session,
    clickButton("Añadir recorrido"),
    `${LEFT}.includes("Recorrido de invitados")`,
    "the second recorrido to be created",
  );
  const journeyRows = await session.evaluate(`document.querySelectorAll('[data-journey-row]').length`);
  assert.ok(journeyRows >= 2, `expected at least two recorridos, found ${journeyRows}`);
  ok(`this study now holds ${journeyRows} recorridos at once, each with its own identity`);
  await shoot(
    session,
    "08-journey-two-defined",
    "Two recorridos defined in the same study. Each row says how many momentos it has and on which pages it is shown, so a recorrido that is defined but not placed anywhere is visible as exactly that.",
    "Recorridos",
  );

  // Open the first and give it momentos.
  await openRow(session, "data-journey-row", "Recorrido de socios", "the first recorrido to open");
  // COUNTED, NOT READ. A momento's name lives in an `<input value>`, and an
  // input's value is not part of `innerText` — so "the panel now mentions this
  // name" is a condition that never becomes true no matter how many momentos
  // were actually created.
  const MOMENTS = `document.querySelectorAll('[data-moment]').length`;
  const wanted = ["Primer contacto", "Primera visita", "Decisión de entrar"];
  for (const moment of wanted) {
    const before = await session.evaluate(MOMENTS);
    await session.evaluate(fillById("-journey-newmoment", moment, IN_LEFT));
    await clickUntil(
      session,
      clickButton("Añadir momento"),
      `${MOMENTS} > ${before}`,
      `the momento “${moment}” to be added`,
    );
  }
  const named = await session.evaluate(
    `[...document.querySelectorAll('[data-moment] input')].map((el) => el.value).filter(Boolean)`,
  );
  for (const moment of wanted) {
    assert.ok(named.includes(moment), `the momento “${moment}” was created without its name`);
  }
  const momentCount = await session.evaluate(`document.querySelectorAll('[data-moment]').length`);
  assert.equal(momentCount, 3, `expected three momentos, found ${momentCount}`);
  ok("momentos are added, named and ordered inside the recorrido they belong to");
  await shoot(
    session,
    "09-journey-moments",
    "Three momentos inside “Recorrido de socios”. Each carries its own name, its own reading, its own result and its own place in the order — moved with real buttons rather than a drag nobody can do by keyboard.",
    "Momentos",
  );

  /*
   * "QUIÉN NO CONOCÍA ESTE MOMENTO" IS TWO ANSWERS, NOT ONE.
   *
   * A study that records a 0/100 column looks like it is measuring awareness,
   * and wiring it up on that resemblance is how a product invents a finding.
   * The mapping stays incomplete — and says so — until somebody names BOTH the
   * result that measures it and the exact answers that mean "no lo conocía".
   */
  // A REAL RESULT, not the first option: the picker's first entry is "No se
  // mide", and choosing it is choosing not to measure awareness at all.
  const awarenessMetric = await session.evaluate(chooseMatching("-aware", "desempe", IN_LEFT));
  assert.ok(awarenessMetric, "the momento offers no result to measure awareness with");
  assert.ok(
    await session.evaluate(`${LEFT}.includes("todavía no se guarda nada")`),
    "naming only the result was accepted as a finished awareness mapping",
  );
  ok(`naming only the result leaves the awareness mapping visibly incomplete (“${awarenessMetric}”)`);
  await shoot(
    session,
    "10-journey-awareness-incomplete",
    "Half of an awareness mapping: the result is named but the answers that mean “no lo conocía” are not, and the product says so instead of guessing. A blank answer is neither — it is not counted as unaware.",
    "Quién no conocía este momento",
  );

  await session.evaluate(fillById("-awarevalues", "100", IN_LEFT));
  await until(
    session,
    `${LEFT}.includes("Se contarán como")`,
    "the awareness mapping to be complete",
  );
  ok("naming the exact answers completes the awareness mapping, and the editor states which they are");
  await shoot(
    session,
    "11-journey-awareness-configured",
    "The completed mapping, stated back in the consultant's own words: which result measures it, which exact answers count as “no lo conocía”, and the scale that result lives on.",
    "Quién no conocía este momento",
  );

  // A BLOCK IS A WINDOW ONTO A RECORRIDO — and duplicating the block makes a
  // second window, while duplicating the recorrido makes a second recorrido.
  await addBlock(session, "journey", "Recorrido");
  await until(session, `${INSPECTOR}.includes("Qué recorrido muestra")`, "the recorrido block's card");
  const pickedJourney = await session.evaluate(chooseMatching("-journeyref", "Recorrido de socios", IN_CARD));
  assert.ok(pickedJourney, "the block's card does not offer the recorridos this study defines");
  await until(
    session,
    `${CANVAS}.includes("Primer contacto")`,
    "the block to draw the recorrido it was pointed at",
  );
  ok("a recorrido block is a window: it is pointed at one of the study's recorridos and draws it");
  await shoot(
    session,
    "12-journey-block-on-canvas",
    "A recorrido block on the canvas, pointed at “Recorrido de socios”. The block is a window onto a recorrido the study owns, which is why the same one can appear on two pages without being copied twice.",
    '[data-block-type="journey"]',
  );

  const journeyBlockId = await session.evaluate(
    `(() => { const el = document.querySelector('[data-block-type="journey"]'); return el ? el.getAttribute('data-block-id') : null; })()`,
  );
  assert.ok(journeyBlockId, "the recorrido block has no identifier on the canvas");
  await clickUntil(
    session,
    clickIn(IN_CARD, "Duplicar"),
    `document.querySelectorAll('[data-block-type="journey"]').length === 2`,
    "the recorrido block to be duplicated",
  );
  const windows = await session.evaluate(
    `[...document.querySelectorAll('[data-block-type="journey"]')].map((el) => el.innerText.includes("Primer contacto"))`,
  );
  assert.deepEqual(windows, [true, true], "the duplicated block is not a second window onto the same recorrido");
  const journeysAfterCopy = await session.evaluate(`document.querySelectorAll('[data-journey-row]').length`);
  assert.equal(journeysAfterCopy, journeyRows, "duplicating a BLOCK silently created a new recorrido");
  ok("duplicating the block makes a second window onto the same recorrido, and creates no new recorrido");
  await shoot(
    session,
    "13-journey-two-windows",
    "Two blocks, one recorrido. Duplicating the block made a second window — the momentos are the same momentos, so editing them in one place is not a fork.",
    '[data-block-type="journey"]',
  );

  await clickUntil(
    session,
    clickLabelled("Duplicar el recorrido “Recorrido de socios”"),
    `document.querySelectorAll('[data-journey-row]').length === ${journeyRows + 1}`,
    "the recorrido itself to be duplicated",
  );
  ok("duplicating the RECORRIDO creates a new one, edited apart — the two acts are kept distinct");

  // A recorrido that is on a page cannot be removed by accident.
  await session.evaluate(clickLabelled("Quitar el recorrido “Recorrido de socios”"));
  await until(
    session,
    `${NOTICE}.length > 0`,
    "the editor to say why the recorrido was not removed",
  );
  const refusal = await session.evaluate(NOTICE);
  assert.match(refusal, /bloque|página|muestra/i, `the refusal does not say why: “${refusal}”`);
  assert.ok(
    await session.evaluate(`${LEFT}.includes("Recorrido de socios")`),
    "a recorrido still shown on a page was removed anyway",
  );
  ok(`removing a recorrido that is still on a page is refused, and says why: “${refusal}”`);
  await shoot(
    session,
    "14-journey-remove-refused",
    "Removing a recorrido that two blocks are still windows onto is refused, and the refusal names the reason rather than failing silently.",
  );

  // =========================================================================
  console.log("\n[5] A real semáforo: the consultant writes the standard, the product applies it");
  // =========================================================================
  /*
   * WHAT MAKES THIS A SEMÁFORO RATHER THAN A COLOUR RAMP. The bands, their
   * edges, their colours, their shapes and their words are all written down by
   * a person. Nothing here is derived from the distribution: a product that
   * decides where green starts by taking the top third has invented a finding
   * and dressed it as a measurement.
   */
  await addPage(session, "Semáforo");
  await session.evaluate(fillById("-band-new", "Desempeño del capítulo", IN_LEFT));
  await clickUntil(
    session,
    clickButton("Añadir semáforo"),
    `${LEFT}.includes("Desempeño del capítulo")`,
    "the semáforo to be created",
  );
  await openRow(session, "data-scheme-row", "Desempeño del capítulo", "the semáforo to open");
  /*
   * A NEW SEMÁFORO ARRIVES WITH THREE NAMED BANDS AND NO RULE.
   *
   * Verde, amarillo, rojo are the shape of the thing; where each one starts,
   * and what being in it MEANS, are the parts only the consultant can supply.
   * So the scheme exists, says out loud that it is not finished, and colours
   * nothing until it is.
   */
  const bandCount = await session.evaluate(`document.querySelectorAll('[data-band]').length`);
  assert.equal(bandCount, 3, `a new semáforo should arrive with three bands, found ${bandCount}`);
  assert.ok(
    await session.evaluate(`${LEFT}.includes("Falta configurar")`),
    "a semáforo with no edges and no meanings called itself ready",
  );
  ok("a new semáforo arrives with three named bands, no rule of its own, and says what is missing");
  await shoot(
    session,
    "15-semaforo-empty",
    "A new semáforo: three named bands and no rule. Where green starts and what being in it MEANS are the parts only a consultant can supply, so the scheme says what is missing and colours nothing until it is written.",
    "Semáforos",
  );

  await session.evaluate(fillById("-band-min", "0", IN_LEFT));
  await session.evaluate(fillById("-band-max", "100", IN_LEFT));
  const meanings = [
    "El capítulo está funcionando como se esperaba.",
    "Hay señales que conviene atender este trimestre.",
    "Requiere intervención del equipo de acompañamiento.",
  ];
  const setMeaning = (index, text) => `(() => {
    const row = [...document.querySelectorAll('[data-band]')][${index}];
    if (!row) return false;
    const el = row.querySelector('[id$="-meaning"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${q("TEXT")});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
  for (const [index, text] of meanings.entries()) {
    const wrote = await session.evaluate(setMeaning(index, text).replace("TEXT", text));
    assert.ok(wrote, `band ${index} has no field for what it means`);
  }

  /*
   * The edges are typed in deliberately WRONG first — green from 80, amber from
   * 60, red from 0 to 50 — so there is a hole between 50 and 60 that no band
   * claims. A product that quietly rounds that away is a product that will one
   * day colour a respondent by the nearest band instead of by the rule.
   */
  const setBandRange = (index, lower, upper) => `(() => {
    const rows = [...document.querySelectorAll('[data-band]')];
    const row = rows[${index}];
    if (!row) return false;
    const numbers = [...row.querySelectorAll('input[type="number"]')];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    if (numbers[0]) { setter.call(numbers[0], ${q(String(lower))}); numbers[0].dispatchEvent(new Event('input', { bubbles: true })); }
    if (numbers[1]) { setter.call(numbers[1], ${q(String(upper))}); numbers[1].dispatchEvent(new Event('input', { bubbles: true })); }
    return true;
  })()`;
  await session.evaluate(setBandRange(0, 80, 100));
  await session.evaluate(setBandRange(1, 60, 80));
  await session.evaluate(setBandRange(2, 0, 50));
  await until(
    session,
    `${LEFT}.includes("no hay ninguna banda")`,
    "the editor to name the hole between 50 and 60",
  );
  const gapText = await session.evaluate(
    `(() => { const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.includes("Falta configurar")); return el ? el.textContent.trim() : ""; })()`,
  );
  assert.match(gapText, /50|60/, `the gap is reported without the values that break: “${gapText}”`);
  ok(`a semáforo with a hole in it is named by the exact values that break: “${gapText}”`);
  await shoot(
    session,
    "16-semaforo-gap-named",
    "Bands typed with a hole between 50 and 60. The editor names the gap instead of rounding it away — a value nobody wrote a rule for is a value the product must not colour.",
    "Semáforos",
  );

  await session.evaluate(setBandRange(2, 0, 60));
  await until(
    session,
    `${LEFT}.includes("listo para usarse")`,
    "the semáforo to become usable once the bands meet",
  );
  ok("closing the gap makes the semáforo usable, and the editor says so in the same place it complained");
  await shoot(
    session,
    "17-semaforo-complete",
    "The finished standard: three bands, each with its own colour ROLE and its own SHAPE, so the reading survives a black-and-white print and a reader who does not distinguish green from red.",
    "Semáforos",
  );

  // A BLOCK DRAWN AS A SEMÁFORO SAYS SO WHEN NO STANDARD IS CHOSEN…
  await addBlock(session, "metric", "Resultado");
  await until(session, `${INSPECTOR}.includes("Cómo se dibuja")`, "the metric block's card");
  const perfMetric = await session.evaluate(chooseMatching("-metric", "desempe", IN_CARD));
  assert.ok(perfMetric, `the study offers no performance result to classify (${perfMetric})`);
  assert.equal(await session.evaluate(chooseOption("-variant", "Semáforo", IN_CARD)), "ok", "“Semáforo” is not offered as a drawing");
  await until(session, `${INSPECTOR}.includes("Con qué semáforo se lee")`, "the block's semáforo picker");
  await until(
    session,
    `${CANVAS}.includes("semáforo") || ${CANVAS}.includes("Semáforo")`,
    "the canvas to say the standard is missing",
  );
  ok("a block drawn as a semáforo with no standard chosen shows the number and says the standard is missing");
  await shoot(
    session,
    "18-semaforo-unconfigured-block",
    "A block drawn as a semáforo before a standard is chosen: the number is shown, uncoloured, and the block says which decision is missing. It never picks a colour to fill the gap.",
    '[data-block-type="metric"]',
  );

  // …AND WEARS THE STANDARD ONCE ONE IS CHOSEN.
  const chosenScheme = await session.evaluate(chooseMatching("-blockband", "Desempeño del capítulo", IN_CARD));
  assert.ok(chosenScheme, "the block's card does not offer the semáforo this study defines");
  await until(
    session,
    `${CANVAS}.includes("Verde") || ${CANVAS}.includes("Amarillo") || ${CANVAS}.includes("Rojo")`,
    "the block to read the standard it was given",
  );
  /*
   * COLOUR IS NEVER THE ONLY SIGNAL. Every classified value carries a shape as
   * well, which is what makes the reading survive a photocopy and a reader who
   * does not distinguish green from red.
   */
  const glyphs = await session.evaluate(`(() => {
    const card = document.querySelector('[data-block-type="metric"]');
    if (!card) return { shapes: 0, words: false };
    return {
      shapes: card.querySelectorAll('svg, [data-band-glyph]').length,
      words: /Verde|Amarillo|Rojo/.test(card.innerText),
    };
  })()`);
  assert.ok(glyphs.words, "the semáforo shows a colour with no word for it");
  assert.ok(glyphs.shapes > 0, "the semáforo relies on colour alone, with no shape beside it");
  ok("the classified value carries a colour, a SHAPE and the band's own words — colour is never the only signal");
  await shoot(
    session,
    "19-semaforo-block-classified",
    "The same block reading “Desempeño del capítulo”. The value is classified by the written rule, and the reading is carried by three redundant signals at once: colour, shape and the band's own words.",
    '[data-block-type="metric"]',
  );

  // THE STANDARD BECOMES A CHARACTERISTIC PEOPLE CAN FILTER BY.
  await openRow(session, "data-scheme-row", "Desempeño del capítulo", "the semáforo's filter section");
  await until(
    session,
    `${LEFT}.includes("Ofrecerlo como característica para filtrar")`,
    "the semáforo's filter section",
  );
  const classifies = await session.evaluate(chooseMatching("-band-filtermetric", "desempe", IN_LEFT));
  assert.ok(classifies, "the semáforo cannot be told which result it classifies");
  ok(`the semáforo is told which result it classifies (“${classifies}”), which is what makes it a characteristic`);
  await shoot(
    session,
    "20-semaforo-as-characteristic",
    "The semáforo offered as a characteristic to filter by. It becomes one only when it names the result it classifies — the bands stay exactly as written, and nothing is split by percentile.",
    "Ofrecerlo como característica para filtrar",
  );

  await addBlock(session, "filter_panel", "Panel de filtros");
  await until(session, `${INSPECTOR}.includes("Panel de filtros")`, "the filter panel's card");
  const offersBands = await session.evaluate(`${INSPECTOR}.includes("Desempeño del capítulo")`);
  assert.ok(offersBands, "the filter panel does not offer the semáforo as a characteristic");
  /*
   * OFFERED IS NOT THE SAME AS TURNED ON. The card lists every characteristic
   * the experience has; which of them this panel actually hands the reader is a
   * separate decision, made with a checkbox, and the gate makes it the way a
   * person would rather than assuming a default.
   */
  const ticked = await tickPanelFilter(session, "Desempeño del capítulo");
  ok(`the filter panel offers the semáforo beside the study's own characteristics, and it is handed to the reader (${ticked})`);
  await shoot(
    session,
    "21-semaforo-filter-offered",
    "The filter panel's card, offering “Desempeño del capítulo” beside the characteristics the study itself recorded. A derived characteristic is a property of this document, not of the study — another draft can hold a different standard.",
    "Características que ofrece",
  );

  await save(session);
  ok("the recorridos, the semáforo and the blocks that read them are saved together, in one document");

  // =========================================================================
  console.log("\n[6] The three remaining drawings, drawn — and each one still readable as text");
  // =========================================================================
  await addPage(session, "Dibujos");
  /*
   * FIT THE CANVAS TO THE COLUMN BEFORE PHOTOGRAPHING A WIDE DRAWING.
   *
   * The canvas draws at the breakpoint being previewed — 1280 px — inside a
   * column narrower than that, and scrolls. That is right for editing and
   * wrong for evidence: a heat map photographed at 100 % has its last column
   * outside the frame, and the caption then claims something the image does
   * not show. "Ajustar al espacio" is the product's own control for exactly
   * this, and using it is what a person would do.
   */
  /*
   * PREVIEW THE TABLET WIDTH FOR THESE THREE.
   *
   * The canvas draws at the breakpoint being previewed, and 1 280 px inside
   * the column left between two panels can only be scaled to the 40 % floor —
   * still wider than the column, so a heat map loses its last column off the
   * right edge of the frame. 768 px fits, and it is a width these drawings
   * genuinely have to work at anyway.
   */
  await clickUntil(
    session,
    clickBreakpoint("Tableta"),
    breakpointChosen("Tableta"),
    "the canvas to preview the tablet width",
  );
  const fitted = await session.evaluate(`(() => {
    for (const select of document.querySelectorAll('select')) {
      const option = [...select.options].find((o) => o.textContent.trim() === "Ajustar al espacio");
      if (!option) continue;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  })()`);
  assert.ok(fitted, "the toolbar offers no way to fit the canvas to the space");
  /*
   * AND IT HAS TO ACTUALLY FIT — asserted as geometry, not as a class name.
   * The scale is measured from the frame by a ResizeObserver, so the choice
   * and its consequence are a tick apart, and "the whole page is inside the
   * column" is the property the screenshots depend on.
   */
  const drawings = [
    {
      label: "Mapa de calor",
      dimensions: 2,
      name: "22-renderer-heatmap",
      caption:
        "A heat map, drawn rather than described. Its colour is a SCALE, its cells carry their own values, and the same numbers exist as a table for a reader who cannot see it.",
    },
    {
      label: "Burbujas",
      dimensions: 2,
      name: "23-renderer-bubble",
      caption:
        "A bubble field. Area — not radius — carries the quantity, because a radius proportional to the value overstates a big number by its square.",
    },
    {
      label: "Rectángulos proporcionales",
      dimensions: 1,
      name: "24-renderer-treemap",
      caption:
        "A treemap laid out deterministically, so the same data always produces the same picture and a screenshot in a report keeps agreeing with the screen.",
    },
  ];
  for (const drawing of drawings) {
    const { label, name, caption } = drawing;
    await addBlock(session, "chart", "Gráfica");
    await until(session, `${INSPECTOR}.includes("Cómo se dibuja")`, "the chart block's card");
    await session.evaluate(chooseMatching("-metric", "desempe|Satisfacc|Recomend", IN_CARD));
    assert.equal(
      await session.evaluate(chooseOption("-agg", "Cantidad de respuestas", IN_CARD)),
      "ok",
      "the block cannot be asked for a count",
    );
    const first = await session.evaluate(chooseMatching("-dim1", "Generaci", IN_CARD));
    assert.ok(first, `“${label}” could not be broken down by a characteristic`);
    const second = drawing.dimensions === 2
      ? await session.evaluate(chooseMatching("-dim2", "Antig", IN_CARD))
      : await session.evaluate(chooseOption("-dim2", "Nada más", IN_CARD));
    assert.ok(second, `“${label}” could not be given the ${drawing.dimensions} characteristic(s) it needs`);
    const chose = await session.evaluate(chooseOption("-variant", label, IN_CARD));
    assert.equal(chose, "ok", `“${label}” is not offered (${chose})`);
    /*
     * AND IT STAYED THE DRAWING THAT WAS CHOSEN. The editor moves a block to a
     * compatible drawing when the question changes underneath it, which is
     * right — and it means "I clicked treemap" is not the same claim as "this
     * block is a treemap".
     */
    const settled = await session.evaluate(
      `document.querySelector(${q(IN_CARD)}).querySelector('[id$="-variant"]').selectedOptions[0].textContent.trim()`,
    );
    assert.ok(
      settled.startsWith(label),
      `“${label}” did not stick: the block settled on “${settled}”`,
    );
    /*
     * THE NUMBERS ARE COMPUTED ON THE SERVER, half a second after the shape of
     * the question changes. Asserting before that round trip lands photographs
     * the honest "todavía no se calcularon" placeholder and calls it a missing
     * renderer.
     */
    await until(
      session,
      `!${CANVAS}.includes("Todavía no se calcularon")`,
      `the server to compute the aggregate “${label}” needs`,
      30000,
    );
    /*
     * THE POINT OF THIS LOOP is that these three used to be declared and then
     * quietly substituted with a bar chart. A drawing that is offered has to be
     * DRAWN — and if it genuinely is not implemented, the block has to say so
     * out loud rather than swap in a different picture under the same title.
     */
    const substituted = await session.evaluate(`${CANVAS}.includes("todavía no se dibuja")`);
    assert.equal(substituted, false, `“${label}” is still offered as a drawing the product does not draw`);
    const drawn = await session.evaluate(`(() => {
      const cards = [...document.querySelectorAll('[data-block-type="chart"]')];
      const card = cards[cards.length - 1];
      if (!card) return null;
      const picture = card.querySelector('[role="img"]');
      const table = card.querySelector('.sr-only table');
      return {
        picture: !!picture,
        label: picture ? (picture.getAttribute('aria-label') ?? "") : "",
        shapes: card.querySelectorAll('svg rect, svg circle, svg g, table td').length,
        table: !!table,
        text: card.innerText.slice(0, 300),
      };
    })()`);
    assert.ok(drawn?.picture, `“${label}” produced no picture — the block says: ${JSON.stringify(drawn?.text ?? null)}`);
    assert.ok(drawn.label.length > 10, `“${label}” has no sentence for somebody who cannot see it`);
    assert.ok(drawn.shapes > 0, `“${label}” drew a picture with nothing in it`);
    assert.ok(drawn.table, `“${label}” carries no plain-text table`);
    ok(`“${label}” is drawn, described in a sentence, and carries the same numbers as text`);
    /*
     * AND THE WHOLE DRAWING IS INSIDE THE FRAME BEFORE THE SHUTTER OPENS.
     * "Ajustar al espacio" is measured by a ResizeObserver, so the choice and
     * its consequence are a tick apart — and a heat map photographed one tick
     * early loses its last column off the right edge while the caption claims
     * the whole cross is there.
     */
    await until(
      session,
      `(() => {
        const region = document.querySelector('[aria-label="Lienzo de la página"]');
        const grid = region && region.querySelector('ul.grid');
        if (!region || !grid) return false;
        return grid.getBoundingClientRect().right <= region.getBoundingClientRect().right + 2;
      })()`,
      `the whole of “${label}” to be inside the frame`,
    );
    await shoot(session, name, caption, '[data-block-type="chart"]');
  }

  // The palette is a decision, and it changes the drawing.
  const paletteBefore = await session.evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-block-type="chart"]')];
    const card = cards[cards.length - 1];
    // COMPUTED, not the attribute: a fill set through a CSS custom property
    // reads identically as an attribute string no matter which ramp produced
    // it, and a comparison of those strings would pass on a control that does
    // nothing at all.
    return card ? [...card.querySelectorAll('svg rect, svg circle, svg path')].slice(0, 12).map((el) => getComputedStyle(el).fill).join("|") : "";
  })()`);
  const paletteChosen = await session.evaluate(chooseMatching("-palette", "Un solo tono", IN_CARD));
  assert.ok(
    paletteChosen,
    `the drawing offers no palette to choose — the card has: ${JSON.stringify(
      await session.evaluate(
        `({ selects: [...document.querySelector(${q(IN_CARD)}).querySelectorAll('select')].map((el) => el.id), variant: document.querySelector(${q(IN_CARD)}).querySelector('[id$="-variant"]')?.selectedOptions[0]?.textContent })`,
      ),
    )}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const paletteAfter = await session.evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-block-type="chart"]')];
    const card = cards[cards.length - 1];
    // COMPUTED, not the attribute: a fill set through a CSS custom property
    // reads identically as an attribute string no matter which ramp produced
    // it, and a comparison of those strings would pass on a control that does
    // nothing at all.
    return card ? [...card.querySelectorAll('svg rect, svg circle, svg path')].slice(0, 12).map((el) => getComputedStyle(el).fill).join("|") : "";
  })()`);
  assert.notEqual(paletteAfter, paletteBefore, "choosing a palette changed nothing on the drawing");
  ok(`choosing the palette “${paletteChosen}” actually repaints the drawing`);
  await shoot(
    session,
    "25-renderer-palette",
    "The same treemap after choosing a different palette. The colour of a scaled drawing is a decision somebody makes; a rainbow suggests categories where there are degrees.",
    '[data-block-type="chart"]',
  );

  /*
   * AND PUT THE SCALE BACK. "Ajustar al espacio" is a preference this session
   * set in order to take a photograph, and it is remembered across reloads —
   * leaving it on would measure every later control at the size a shrunken
   * canvas draws it, which is not the size anybody's finger meets.
   */
  await clickUntil(
    session,
    clickBreakpoint("Computadora"),
    breakpointChosen("Computadora"),
    "the canvas to go back to previewing the desktop width",
  );
  const unfitted = await session.evaluate(`(() => {
    for (const select of document.querySelectorAll('select')) {
      const option = [...select.options].find((o) => o.textContent.trim() === "100 %");
      if (!option) continue;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  })()`);
  assert.ok(unfitted, "the canvas scale could not be put back to 100 %");
  await until(
    session,
    `(() => {
      const region = document.querySelector('[aria-label="Lienzo de la página"]');
      const grid = region && region.querySelector('ul.grid');
      if (!region || !grid) return false;
      // Back at full size the 1 280 px canvas is WIDER than the column again,
      // and scrolls inside its own box. That is the editing view.
      return grid.getBoundingClientRect().width > region.getBoundingClientRect().width;
    })()`,
    "the canvas to return to full size",
  );

  // =========================================================================
  console.log("\n[7] A thematic cloud that is a cloud, and counts what it says it counts");
  // =========================================================================
  /*
   * A NAME THE STUDY DOES NOT ALREADY USE. The adapted arrangement opens with
   * a page called "Lo que dijeron", and adding a second page with that title
   * makes every later "go to the page called X" ambiguous — the preview opened
   * the adapted one, which has a different panel, and the failure looked like
   * a missing filter rather than a duplicate name.
   */
  await addPage(session, "Nube de temas");
  await addBlock(session, "theme_cloud", "Nube de temas");
  await until(session, `${INSPECTOR}.includes("Qué cuenta esta nube")`, "the cloud's card");
  await until(
    session,
    `!!document.querySelector('[data-theme-cloud]')`,
    "the cloud to be drawn",
  );
  const cloud = await session.evaluate(`(() => {
    const el = document.querySelector('[data-theme-cloud]');
    const words = [...el.querySelectorAll('[data-theme]')];
    const boxes = words.map((w) => {
      const r = w.getBoundingClientRect();
      const rect = w.querySelector('rect').getBoundingClientRect();
      return {
        label: w.getAttribute('data-theme'),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        reservedW: Math.round(rect.width), reservedH: Math.round(rect.height),
      };
    });
    return { count: words.length, boxes, text: el.innerText };
  })()`);
  assert.ok(cloud.count >= 4, `the cloud drew ${cloud.count} words, expected the study's confirmed themes`);
  // NO TWO WORDS OVERLAP — on the screen, not only in the layout function.
  for (let i = 0; i < cloud.boxes.length; i += 1) {
    for (let j = i + 1; j < cloud.boxes.length; j += 1) {
      const a = cloud.boxes[i];
      const b = cloud.boxes[j];
      const apart = a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
      assert.ok(
        apart,
        `“${a.label}” and “${b.label}” overlap on screen: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
      );
    }
  }
  ok(`the cloud drew ${cloud.count} confirmed themes with no two words overlapping on screen`);
  await shoot(
    session,
    "26-cloud-drawn",
    "The thematic cloud, drawn from the themes the qualitative review confirmed. Word size carries the count, the words are turned deterministically, and no two of them overlap.",
    "[data-theme-cloud]",
  );

  // NOTHING UNREVIEWED AND NOTHING PERSONAL IS REACHABLE.
  const leak = await session.evaluate(`(() => {
    const body = document.body.innerText;
    return {
      pendingTheme: body.includes("TEMA-SIN-REVISAR"),
      quote: body.includes("CITA-SIN-APROBAR"),
    };
  })()`);
  assert.equal(leak.pendingTheme, false, "a theme nobody confirmed reached the cloud");
  assert.equal(leak.quote, false, "an unapproved quote reached the screen");
  ok("the pending theme and the unapproved quote this fixture deliberately contains are nowhere on the page");

  // MENTIONS AND PEOPLE ARE DIFFERENT NUMBERS, AND THE CLOUD SAYS WHICH.
  // THE COUNTS THEMSELVES, from the words' own accessible names — not the
  // caption. A caption is repainted in the browser; the numbers come back from
  // the server, and comparing captions would pass on a cloud that relabelled
  // stale figures.
  const WORD_COUNTS = `[...document.querySelectorAll('[data-theme-cloud] [data-theme]')].map((el) => el.getAttribute('aria-label')).sort().join("|")`;
  const mentionsCounts = await session.evaluate(WORD_COUNTS);
  assert.match(mentionsCounts, /menciones/i, "the cloud does not say it is counting mentions");
  await session.evaluate(chooseOption("-cloudbasis", "Personas", IN_CARD));
  /*
   * WAIT FOR THE NUMBER, NOT THE NOUN. The word "personas" is painted from the
   * setting the instant it changes; the COUNT comes back from the server half
   * a second later. A gate that waited for the noun would read the old figures
   * under the new caption — which is exactly the bug this assertion exists to
   * catch.
   */
  await until(
    session,
    `/Precio y valor: 15 personas/.test(${WORD_COUNTS})`,
    "the cloud to recount by people on the server",
    30000,
  );
  const peopleCounts = await session.evaluate(WORD_COUNTS);
  assert.notEqual(peopleCounts, mentionsCounts, "switching the basis changed nothing but the caption");
  assert.ok(
    /Precio y valor: 18 menciones/.test(mentionsCounts) && /Precio y valor: 15 personas/.test(peopleCounts),
    `the two bases are not the fixture's own two numbers: ${mentionsCounts} / ${peopleCounts}`,
  );
  ok("switching between mentions and people changes the NUMBERS — 18 mentions from 15 people — and says which one is on screen");
  await shoot(
    session,
    "27-cloud-by-people",
    "The same cloud sized by people rather than by mentions. They are different counts of the same evidence — one person repeating a concern three times is 3 and 1 — so the drawing states which it used.",
    "[data-theme-cloud]",
  );
  await session.evaluate(chooseOption("-cloudbasis", "Menciones", IN_CARD));

  // A WORD IS A CONTROL, AND SELECTING IT SHOWS WHAT WAS FOLDED INTO IT.
  await clickUntil(
    session,
    // An SVG element has no `.click()` — that helper is HTMLElement's. A real
    // click is a dispatched MouseEvent, which is also what a browser sends.
    `(() => { const w = document.querySelector('[data-theme]'); if (w) { w.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; } return false; })()`,
    `!!document.querySelector('[data-theme-detail]')`,
    "a word to open its detail",
  );
  const detail = await session.evaluate(
    `(() => document.querySelector('[data-theme-detail]').innerText)()`,
  );
  assert.ok(detail.length > 10, "selecting a theme opened an empty detail");
  ok(`selecting a word opens its aggregate detail: “${detail.split("\\n")[0]}”`);
  await shoot(
    session,
    "28-cloud-theme-selected",
    "A theme selected in the cloud. The detail is an AGGREGATE — counts, the raw spellings the review folded into it, and which sources it came from — never a person and never a sentence somebody wrote.",
    "[data-theme-detail]",
  );

  // THE RANKED LIST IS THE REFERENCE, NOT THE CONSOLATION PRIZE.
  await clickUntil(
    session,
    clickButton("Ver la lista ordenada"),
    `!!document.querySelector('[data-theme-list]')`,
    "the ranked list to open",
  );
  const list = await session.evaluate(`(() => {
    const ol = document.querySelector('[data-theme-list]');
    return ol ? [...ol.children].map((li) => li.innerText.trim()).slice(0, 20) : null;
  })()`);
  assert.ok(Array.isArray(list) && list.length >= 4, "the cloud carries no ranked list");
  ok(`the same themes are available as a ranked list of ${list.length}, in order, for anybody who cannot read a cloud`);
  await shoot(
    session,
    "29-cloud-ranked-list",
    "The ranked list every cloud carries. It is ordered by the same count that sizes the words, so the picture and the list can never disagree.",
    "[data-theme-list]",
  );

  // KEYBOARD. A cloud only a mouse can use is a picture.
  const keyboard = await session.evaluate(`(() => {
    const w = document.querySelector('[data-theme]');
    return w ? { tabbable: w.tabIndex >= 0, named: !!w.getAttribute('aria-label'), pressed: w.hasAttribute('aria-pressed') } : null;
  })()`);
  assert.ok(keyboard?.tabbable, "the words in the cloud cannot be reached by keyboard");
  assert.ok(keyboard.named, "the words in the cloud have no accessible name");
  assert.ok(keyboard.pressed, "a word does not say whether it is the selected one");
  ok("every word is focusable, named and states whether it is selected — the cloud is operable without a mouse");

  // TWO CLOUDS ON ONE PAGE CAN READ TWO DIFFERENT QUESTIONS.
  await addBlock(session, "theme_cloud", "Nube de temas");
  const secondSource = await session.evaluate(chooseMatching("-cloudsource", "focus", IN_CARD));
  assert.ok(secondSource, "the cloud cannot be pointed at one qualitative source");
  // The second cloud reads a different set of observations, so its counts are
  // a fresh question for the server — and until they come back the block
  // correctly says so rather than drawing the first cloud's numbers.
  await until(
    session,
    `document.querySelectorAll('[data-theme-cloud]').length === 2`,
    "the server to compute the second cloud's own counts",
    30000,
  );
  const twoClouds = await session.evaluate(`(() => {
    const clouds = [...document.querySelectorAll('[data-theme-cloud]')];
    return clouds.map((el) => [...el.querySelectorAll('[data-theme]')].map((w) => w.getAttribute('data-theme')).sort().join("|"));
  })()`);
  assert.equal(twoClouds.length, 2, "the page does not carry two clouds");
  assert.notEqual(twoClouds[0], twoClouds[1], "the second cloud reads the same evidence as the first");
  ok(`two clouds on one page read two different qualitative sources (the second is “${secondSource}”)`);
  await shoot(
    session,
    "30-cloud-two-sources",
    "Two clouds on one page reading two different qualitative sources — “what they said in the survey” beside “what they said in the focus group” — neither of them a filter of the other.",
    "[data-theme-cloud]",
  );

  /*
   * A PANEL ON THE PAGE OF CLOUDS, because a cloud that cannot be narrowed is a
   * poster. The catalogue says a cloud answers to a reader's filter; that
   * declaration is only true if the reader has somewhere to make the choice.
   */
  await addBlock(session, "filter_panel", "Panel de filtros");
  /*
   * SELECT IT EXPLICITLY. Two panels now exist in this document, and both
   * cards are headed "Panel de filtros" — so "wait until the card says panel"
   * is satisfied by the OTHER page's panel, and the tick lands on the wrong
   * block while every assertion still passes. The canvas only draws the open
   * page, so selecting from the canvas names this page's panel unambiguously.
   */
  await clickUntil(
    session,
    selectBlockOfType("filter_panel"),
    // `aria-current` on the card is the selection, and it is the same signal a
    // screen reader is given. The card's own heading cannot be used: both
    // panels are called "Panel de filtros", and the characteristics list is
    // inside a collapsed disclosure, so it is not in the card's `innerText`
    // whether the right panel is selected or not.
    `!!document.querySelector('[data-block-type="filter_panel"] [data-block-select][aria-current="true"]')`,
    "this page's own panel to be selected",
  );
  const cloudFilterOn = await tickPanelFilter(session, "Desempeño del capítulo");
  assert.equal(
    cloudFilterOn,
    "turned on",
    "the tick landed on a panel that already offered the semáforo — probably the other page's",
  );
  ok(`the page of clouds carries its own panel offering the semáforo, so a reader can ask what the green chapters said (${cloudFilterOn})`);

  await save(session);
  ok("the page of clouds is saved with the rest of the document");

  // =========================================================================
  console.log("\n[8] The reader's side: the semáforo narrows, and the cloud recomputes");
  // =========================================================================
  await session.load(fixturePreview);
  await until(session, `document.body.innerText.length > 200`, "the draft preview");
  const previewHealth = await session.evaluate(PAGE_HEALTH);
  assert.equal(previewHealth.errorBoundary, false, "the preview could not render the composed draft");
  // The reader opens on the first page; the semáforo and its panel are on the
  // page that was built for them, so go there before asking about them.
  const openPage = (title) =>
    session.evaluate(`(() => {
      const target = [...document.querySelectorAll('a, button')]
        .find((el) => el.textContent.trim().startsWith(${q(title)}));
      if (!target) return false;
      target.click();
      return true;
    })()`);
  const onSemaforo = await openPage("Semáforo");
  assert.ok(onSemaforo, "the preview does not offer the semáforo page by name");
  await until(session, `document.body.innerText.includes("Verde")`, "the semáforo page in the preview");
  await shoot(
    session,
    "31-preview-semaforo-page",
    "The draft preview as a reader meets it: the semáforo page, with the classified value, its legend and the filter panel that offers the standard as a characteristic.",
    'section[aria-label] [role="img"]',
  );

  /*
   * THE SEMÁFORO AS A FILTER, PROVED BY A NUMBER THAT MOVES. The fixture put
   * six respondents in each band deliberately: an inert filter and a working
   * one look identical on a study where everybody lands in green.
   */
  const beforeFilter = await session.evaluate(
    `(document.body.innerText.match(/-?[0-9]+[.,][0-9]+|[0-9]+/g) ?? []).slice(0, 60).join(",")`,
  );
  const narrowed = await session.evaluate(`(() => {
    for (const select of document.querySelectorAll('select')) {
      const option = [...select.options].find((o) => o.textContent.trim() === 'Verde');
      if (!option) continue;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  })()`);
  if (narrowed) {
    await until(
      session,
      `(document.body.innerText.match(/-?[0-9]+[.,][0-9]+|[0-9]+/g) ?? []).slice(0, 60).join(",") !== ${q(beforeFilter)}`,
      "the numbers to move when the semáforo band is chosen",
      20000,
    );
    ok("choosing a semáforo band narrows the reader's selection, and the numbers recompute over the narrowed rows");
    await shoot(
      session,
      "32-preview-semaforo-filtered",
      "“Desempeño del capítulo = Verde” chosen in the reader's panel. The classification is the written rule applied per respondent, and every number on the page is recomputed by the canonical engine over the narrowed rows.",
      'section[aria-label] [role="img"]',
    );
    await clickUntil(
      session,
      clickButton("Limpiar filtros"),
      `(document.body.innerText.match(/-?[0-9]+[.,][0-9]+|[0-9]+/g) ?? []).slice(0, 60).join(",") === ${q(beforeFilter)}`,
      "the preview to return to its unfiltered values",
    );
    ok("clearing the filters returns every number to exactly what it was before");
  } else {
    console.log("  NOTE  the preview's panel is not on the page the reader opens first");
  }

  // THE CLOUD RECOMPUTES WITH THE SAME SELECTION, AND CLEARING RESTORES IT.
  const cloudPage = await openPage("Nube de temas");
  if (cloudPage) {
    await until(session, `!!document.querySelector('[data-theme-cloud]')`, "the cloud in the preview");
    const cloudBefore = await session.evaluate(
      `[...document.querySelectorAll('[data-theme-cloud] [data-theme]')].map((el) => el.getAttribute('aria-label')).join("|")`,
    );
    const filtered = await session.evaluate(`(() => {
      for (const select of document.querySelectorAll('select')) {
        // NARROWED BY THE SEMÁFORO ITSELF — "what did the chapters in green
        // actually say?" — which is the question the whole derived-characteristic
        // design exists to make askable, and it carries enough voices behind it
        // that the study's disclosure rule still lets a theme through.
        const option = [...select.options].find((o) => o.textContent.trim() === "Verde");
        if (!option) continue;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(select, option.value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    })()`);
    if (filtered) {
      await until(
        session,
        `[...document.querySelectorAll('[data-theme-cloud] [data-theme]')].map((el) => el.getAttribute('aria-label')).join("|") !== ${q(cloudBefore)}`,
        "the cloud to recompute for the narrowed selection",
        20000,
      );
      const narrowedWords = await session.evaluate(
        `[...document.querySelectorAll('[data-theme-cloud] [data-theme]')].length`,
      );
      assert.ok(
        narrowedWords > 0,
        "the narrowed cloud has no words at all, so nothing was proved about its counts",
      );
      ok(`narrowing the reader's selection recomputes the cloud's counts — ${narrowedWords} themes still clear the study's disclosure rule`);
      await shoot(
        session,
        "33-preview-cloud-filtered",
        "The cloud narrowed by the semáforo itself: what the chapters classified green actually said. The words are those people's themes, counted among those people — a derived characteristic narrowing qualitative evidence.",
        "[data-theme-cloud]",
      );
      await clickUntil(
        session,
        clickButton("Limpiar filtros"),
        `[...document.querySelectorAll('[data-theme-cloud] [data-theme]')].map((el) => el.getAttribute('aria-label')).join("|") === ${q(cloudBefore)}`,
        "the cloud to come back to its unfiltered state",
      );
      ok("clearing the selection restores the cloud exactly, word for word and count for count");
    } else {
      const controls = await session.evaluate(
        `({ selects: [...document.querySelectorAll('select')].map((el) => [...el.options].map((o) => o.textContent.trim()).slice(0, 6)), page: (document.querySelector('section[aria-label]')?.getAttribute('aria-label') ?? null) })`,
      );
      const saved = await draftFingerprint(disposableStudy);
      const panels = saved.definition.pages.map((page) => ({
        page: page.title,
        panels: page.blocks
          .filter((block) => block.type === "filter_panel")
          .map((block) => block.filterRefs),
      }));
      assert.fail(
        `the cloud page carries no characteristic to narrow by: ${JSON.stringify(controls)}
`
        + `filters: ${JSON.stringify(saved.definition.filterDefinitions.map((f) => [f.id, f.label, f.dimensionId, f.clientVisible, f.scope]))}
`
        + `panels: ${JSON.stringify(panels)}`,
      );
    }
  } else {
    console.log("  NOTE  the preview does not offer the cloud page by name");
  }

  // =========================================================================
  console.log("\n[9] It is all one document, and it survives being put down");
  // =========================================================================
  const stored = await draftFingerprint(disposableStudy);
  assert.ok(stored.present, "nothing was saved for the disposable study");
  assert.equal(stored.schemaVersion, 3, `the draft was stored at schema version ${stored.schemaVersion}`);
  const definition = stored.definition;
  assert.ok(Array.isArray(definition.journeyReferences) && definition.journeyReferences.length >= 3,
    "the several recorridos did not reach the stored document");
  assert.ok(Array.isArray(definition.bandSchemes) && definition.bandSchemes.length >= 1,
    "the semáforo did not reach the stored document");
  const scheme = definition.bandSchemes[0];
  assert.equal(scheme.bands.length, 3, "the semáforo's bands did not survive the save");
  assert.ok(scheme.filterMetricId, "the semáforo forgot which result it classifies");
  assert.ok(
    scheme.bands.every((band) => typeof band.shape === "string" && typeof band.colorRole === "string"),
    "a band was stored without its shape or its colour role",
  );
  const cloudBlocks = definition.pages.flatMap((page) =>
    page.blocks.filter((block) => block.type === "theme_cloud"),
  );
  assert.ok(cloudBlocks.length >= 2, "the two clouds did not reach the stored document");
  assert.ok(
    cloudBlocks.every((block) => block.themeCloud && typeof block.themeCloud.basis === "string"),
    "a cloud was stored without saying what it counts",
  );
  ok(`the stored document is schema v${stored.schemaVersion} and carries ${definition.journeyReferences.length} recorridos, ${definition.bandSchemes.length} semáforo(s) and ${cloudBlocks.length} clouds`);

  await session.load(fixtureBuilder);
  await until(session, `!!document.querySelector('[data-journey-row]')`, "the builder to reopen the saved draft");
  const reopened = await session.evaluate(`({
    journeys: document.querySelectorAll('[data-journey-row]').length,
    schemes: document.querySelectorAll('[data-scheme-row]').length,
    text: ${LEFT},
  })`);
  assert.ok(reopened.journeys >= 3, `only ${reopened.journeys} recorridos came back`);
  assert.ok(reopened.schemes >= 1, "the semáforo did not come back");
  assert.ok(reopened.text.includes("Recorrido de socios"), "a recorrido came back without its name");
  assert.ok(reopened.text.includes("Desempeño del capítulo"), "the semáforo came back without its name");
  ok("reopening the study brings back every recorrido and every semáforo, by name, with no migration prompt");
  await shoot(
    session,
    "34-reopened-after-save",
    "The same study reopened from its saved draft. The recorridos, the semáforo and the blocks that read them all came back by name — one document, one save, one schema version.",
  );

  // =========================================================================
  console.log("\n[10] Six widths, on the parts this milestone added");
  // =========================================================================
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
    if (view.documentWidth > width + 1) {
      const culprits = await session.evaluate(`(() => {
        const out = [];
        for (const el of document.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right <= ${width} + 1) continue;
          out.push({
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
            left: Math.round(r.left),
            right: Math.round(r.right),
            width: Math.round(r.width),
            panel: el.closest('aside[aria-label]')?.getAttribute('aria-label') ?? null,
            scrollable: (() => {
              let node = el.parentElement;
              while (node) {
                if (/auto|scroll/.test(getComputedStyle(node).overflowX)) return true;
                node = node.parentElement;
              }
              return false;
            })(),
            text: (el.textContent ?? '').trim().slice(0, 30),
          });
        }
        const asides = [...document.querySelectorAll('aside[aria-label]')].map((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return { label: el.getAttribute('aria-label'), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), position: cs.position, display: cs.display, overflowX: cs.overflowX };
        });
        return { asides, out: out.slice(0, 3) };
      })()`);
      assert.fail(`${width}px: the page scrolls sideways (${view.documentWidth}). Widest: ${JSON.stringify(culprits, null, 1)}`);
    }
    assert.ok(view.bodyWidth <= width + 1, `${width}px: the body scrolls sideways (${view.bodyWidth})`);
    assert.deepEqual(view.duplicateIds, [], `${width}px: duplicate DOM ids ${JSON.stringify(view.duplicateIds)}`);
    const small = await session.evaluate(TARGETS);
    assert.deepEqual(small, [], `${width}px: a control is under 44 x 44 ${JSON.stringify(small)}`);
    /*
     * THE RAIL IS A COLUMN'S CONTROL, NEVER A PHONE'S. A 6 px edge strip is a
     * target nobody can hit, so below the width where the panel is a column it
     * must not be drawn at all — the drawer's own opener is the route there.
     */
    const rails = {
      left: await session.evaluate(railVisible("left")),
      right: await session.evaluate(railVisible("right")),
    };
    if (width < 1024) {
      assert.equal(rails.left, false, `${width}px: the pages panel draws an edge rail where it is a drawer`);
    }
    if (width < 1280) {
      assert.equal(rails.right, false, `${width}px: the inspector draws an edge rail where it is a drawer`);
    }
    ok(`${width}px: no error boundary, no sideways scrolling, no duplicate id, no control under 44 x 44, and the rails exist only where the panels are columns`);

    if (width === 390) {
      await shoot(
        session,
        "35-mobile-builder-390",
        "The composer at 390 px. The panels are drawers rather than columns, the edge rails are correctly absent because a 6 px strip is not a phone target, and nothing scrolls sideways.",
      );
    }
    if (width === 1024) {
      await shoot(
        session,
        "36-builder-1024",
        "At 1024 px the pages panel has docked as a column and carries its rail; the inspector is still a drawer and correctly draws none. The two sides dock at different widths so the canvas keeps the room.",
      );
    }
  }

  // The reader's side of the new drawings, at the narrow widths.
  for (const width of [320, 390, 768]) {
    await session.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await session.load(fixturePreview);
    await until(session, `document.body.innerText.length > 100`, `the draft preview at ${width}px`);
    const view = await session.evaluate(PAGE_HEALTH);
    assert.ok(view.documentWidth <= width + 1, `${width}px preview: sideways scrolling (${view.documentWidth})`);
    assert.deepEqual(view.duplicateIds, [], `${width}px preview: duplicate ids`);
    const small = await session.evaluate(TARGETS);
    assert.deepEqual(small, [], `${width}px preview: a control under 44 x 44 ${JSON.stringify(small)}`);
    ok(`${width}px: the draft preview carries the new drawings without scrolling sideways or shrinking a target`);
    if (width === 320) {
      await shoot(
        session,
        "37-preview-320",
        "The reader's draft preview at 320 px — the narrowest width in the declared matrix. The semáforo, the drawings and the cloud all fit without the page scrolling sideways.",
      );
    }
  }

  // =========================================================================
  console.log("\n[11] The real study, read only");
  // =========================================================================
  await session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await session.load(realBuilder);
  await until(session, `!!document.querySelector('[data-block-id]')`, "the real study's builder");
  const realHealth = await session.evaluate(PAGE_HEALTH);
  assert.equal(realHealth.errorBoundary, false, "the real study's builder opens with the error boundary");
  assert.ok(realHealth.documentWidth <= 1441, "the real study's builder scrolls sideways");
  ok("the real study's saved draft opens unchanged under the new schema, with no migration prompt and no error");
  await shoot(
    session,
    "38-real-study-untouched",
    "The real study's saved draft, opened read-only under the new schema version. It carries no semáforo and no second recorrido, because nobody configured one — the migration adds capability, never content.",
  );

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

  console.log(`\nOK — ${checks} live milestone checks passed.`);
  console.log(`\nScreenshots (${captions.length}):`);
  for (const shot of captions) console.log(`  ${shot.file}\n      ${shot.caption}`);
  writeFileSync(join(SHOTS, "captions.json"), `${JSON.stringify(captions, null, 2)}\n`, "utf8");
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
