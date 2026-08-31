// =============================================================================
// The mechanism the publication live gate drives the product with
// =============================================================================
// ASSERTION-NEUTRAL, on purpose. Nothing in this file decides whether anything
// passed: it opens a browser, signs a session in, clicks, reads and
// photographs. The gate that imports it owns every claim, which is the same
// separation `docs/P7_HARNESS_DESIGN.md` established for the adversarial
// suites — a mechanism that also judged would be a mechanism whose failures
// look like findings.
//
// It is a NEW module rather than an import of the composer milestone's gate
// because that gate is a script with a top-level flow, not a library. The
// helpers below are the same shapes it settled on, each of them written to
// answer a defect that was actually met: a click that lands before hydration,
// a screenshot fired wherever the last click left the page, an unscoped
// selector that drives the wrong one of two identical controls.
// =============================================================================

import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";

export const q = (value) => JSON.stringify(value);

// ---------------------------------------------------------------------------
// The database, through the same REST surface the other gates use
// ---------------------------------------------------------------------------

export function createRest({ url, secret }) {
  async function rest(path, { method = "GET", body, headers = {} } = {}) {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
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

  /** Call one database function through the Data API, as the application does. */
  async function rpc(name, args) {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
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

  return { rest, rpc, allRows };
}

/** Canonical bytes, exactly as `serializeExperienceDefinition` produces them. */
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]);
    return sorted;
  }
  return value;
}

export function canonicalSha256(definition) {
  return createHash("sha256").update(JSON.stringify(sortKeys(definition))).digest("hex");
}

// ---------------------------------------------------------------------------
// A signed-in loopback proxy: the password is used in Node, only the resulting
// cookie ever reaches the browser.
// ---------------------------------------------------------------------------

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export async function signedInProxy({ url, anon, origin, email, password, label }) {
  const jar = new Map();
  const client = createServerClient(url, anon, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`fixture sign-in failed for ${label}: ${error.message}`);
  const cookie = [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
  /** Known once the server is listening; read inside the handler, never before. */
  let proxyOrigin = "";
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
      headers.set("origin", origin);
      headers.set("referer", `${origin}${request.url}`);
      const upstream = await fetch(new URL(request.url, origin), {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method ?? "GET") ? undefined : await readBody(request),
        redirect: "manual",
      });
      const outgoing = {};
      upstream.headers.forEach((value, key) => {
        if (!["content-encoding", "content-length", "set-cookie", "transfer-encoding"].includes(key)) {
          /*
           * A REDIRECT HAS TO COME BACK TO THIS PROXY, not to the application's
           * own origin.
           *
           * The request is forwarded with `Origin` and `Host` rewritten to the
           * application, because Next refuses a Server Action whose Origin does
           * not match the host serving it. Next then builds the `redirect()`
           * target ABSOLUTELY, on that same origin — so a browser sitting on
           * this proxy is told to navigate to `localhost:3000`, where the
           * signed-in cookie this proxy injects does not exist.
           *
           * What that looked like from outside was the worst possible symptom:
           * pressing "Publicar" produced no console error, no server error, a
           * genuine 303 on the wire, and a page that did not move — because
           * Next's own client router will not follow a cross-origin push. The
           * redirect is rewritten back to this proxy so the browser follows it
           * to the place the cookie lives.
           */
          outgoing[key] =
            ["location", "x-action-redirect"].includes(key) && typeof value === "string"
              ? value.replace(origin, proxyOrigin)
              : value;
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
  proxyOrigin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin: proxyOrigin,
    userId: data.user?.id ?? null,
    accessToken: data.session?.access_token ?? null,
    close: () => server.close(),
  };
}

/** An UNAUTHENTICATED proxy, for the request an anonymous visitor would make. */
export async function anonymousProxy({ origin }) {
  const server = http.createServer(async (request, response) => {
    try {
      const upstream = await fetch(new URL(request.url, origin), {
        method: request.method,
        headers: { "accept-encoding": "identity" },
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
    close: () => server.close(),
  };
}

// ---------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------

export function findChrome() {
  const candidate = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium"]
    .filter(Boolean)
    .find(existsSync);
  assert.ok(candidate, "a Chrome or Chromium binary is required (set CHROME_PATH)");
  return candidate;
}

export async function launchChrome({ binary, port, profile }) {
  const chrome = spawn(
    binary,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (probe.ok) return chrome;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  chrome.kill();
  throw new Error("the browser never opened its debugging port");
}

export async function connect(port) {
  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
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
      socket.send(
        JSON.stringify({
          id: ++nextId,
          method: "Page.handleJavaScriptDialog",
          params: { accept: true },
        }),
      );
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
  await send("Page.enable");
  await send("Runtime.enable");
  return {
    send,
    evaluate,
    problems,
    dialogs,
    close: () => socket.close(),
    resize: async (width, height = 900) => {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 768,
      });
    },
    load: async (url) => {
      const event = new Promise((resolve) => loaded.push(resolve));
      await send("Page.navigate", { url });
      await Promise.race([event, new Promise((resolve) => setTimeout(resolve, 40000))]);
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const ready = await evaluate(
          "document.readyState === 'complete' && !!document.querySelector('main')",
        );
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
  };
}

// ---------------------------------------------------------------------------
// Reading and clicking
// ---------------------------------------------------------------------------

export async function until(session, expression, what, timeout = 30000) {
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
 * nothing. A person clicks again; this does what the person does, and fails
 * only if it never takes.
 */
export async function clickUntil(session, findExpression, doneExpression, what, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await session.evaluate(doneExpression)) return true;
    await session.evaluate(findExpression);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`clicked for ${what} and nothing happened`);
}

/** Click a button by its exact visible text. */
export const clickButton = (label) =>
  `(() => { const b = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === ${q(label)}); if (b) { b.click(); return true; } return false; })()`;

/** Click a button whose visible text starts with a phrase. */
export const clickButtonStarting = (label) =>
  `(() => { const b = [...document.querySelectorAll('button')].find((el) => el.textContent.trim().startsWith(${q(label)})); if (b) { b.click(); return true; } return false; })()`;

/** Follow a link by its exact visible text. */
export const clickLink = (label) =>
  `(() => { const a = [...document.querySelectorAll('a')].find((el) => el.textContent.trim() === ${q(label)}); if (a) { a.click(); return true; } return false; })()`;

/** Tick every acknowledgement checkbox the review offers. */
export const tickAllAcknowledgements = `(() => {
  const boxes = [...document.querySelectorAll('input[type="checkbox"][name="ack"]')];
  let changed = 0;
  for (const box of boxes) { if (!box.checked) { box.click(); changed += 1; } }
  return { total: boxes.length, changed };
})()`;

export const ACK_STATE = `(() => {
  const boxes = [...document.querySelectorAll('input[type="checkbox"][name="ack"]')];
  return { total: boxes.length, checked: boxes.filter((b) => b.checked).length,
    codes: boxes.map((b) => b.value) };
})()`;

export const BODY = `document.body.innerText`;

export const PAGE_HEALTH = `(() => {
  const root = document.documentElement;
  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id).filter(Boolean);
  return {
    width: root.clientWidth,
    documentWidth: root.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
    errorBoundary: /No pudimos abrir esta parte del trabajo/i.test(document.body.innerText),
    status: document.title,
  };
})()`;

/** Every visible control smaller than the 44 px minimum, with the one exemption. */
export const SMALL_TARGETS = `(() => {
  const visible = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return !el.classList.contains('sr-only') && style.display !== 'none'
      && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const name = (el) => el.tagName.toLowerCase()
    + (typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  return [...document.querySelectorAll('a[href],button,summary,select,textarea,input:not([type="hidden"])')]
    .filter(visible)
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

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

export function createShooter({ directory, captions }) {
  return async function shoot(session, name, caption, reveal) {
    mkdirSync(directory, { recursive: true });
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
      /*
       * PREFIX FIRST, THEN CONTAINS.
       *
       * A caption names the thing it is evidence for in the words on screen,
       * and those words are usually the start of a heading — but not always:
       * "quedó desactualizada" is the end of "Esta revisión quedó
       * desactualizada". Falling back to a contains match means a caption can
       * name the distinctive part of a sentence rather than having to quote it
       * from its first character, and a shot still fails loudly when the thing
       * it claims to photograph is genuinely absent.
       */
      const found = await session.evaluate(`(() => {
        const nodes = [...document.querySelectorAll('h1, h2, h3, h4, h5, legend, p, span, li')];
        const heading = nodes.find((el) => el.textContent.trim().startsWith(${q(reveal)}))
          ?? nodes.find((el) => el.textContent.includes(${q(reveal)}));
        if (heading) heading.scrollIntoView({ block: "center" });
        return !!heading;
      })()`);
      if (!found) throw new Error(`no text “${reveal}” to photograph for ${name}`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const file = join(directory, `${name}.png`);
    const shot = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    captions.push({ file, caption });
    console.log(`  SHOT  ${file}`);
    console.log(`        ${caption}`);
    return file;
  };
}
