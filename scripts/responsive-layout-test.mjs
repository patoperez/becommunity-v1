/**
 * Rendered-layout gate for the client portal (live).
 *
 * The narrow-mobile defect this guards against is geometric: an internally
 * scrollable component leaked its min-content width into the study grid track,
 * so the document grew wider than the viewport and the phone clipped whatever
 * sat past the edge. Source-string matching cannot see that, so this drives a
 * real headless Chrome over the real authenticated dashboard and measures it.
 *
 * Requires a running app (`npm run dev`, default http://localhost:3000), the
 * `.env.local` fixture accounts, and a local Chrome/Edge. Run it with:
 *   npm run test:responsive-live
 */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";

const APP_ORIGIN = process.env.RESPONSIVE_APP_ORIGIN ?? "http://localhost:3000";
const MOBILE_WIDTHS = [258, 320, 360, 375, 390, 414];
const DESKTOP_WIDTH = 1280;
const DEBUG_PORT = Number(process.env.RESPONSIVE_DEBUG_PORT ?? 9333);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const ROLES = [
  { name: "tenant A (data-rich)", email: "TEST_USER_A_EMAIL", password: "TEST_USER_A_PASSWORD", rich: true, required: true },
  { name: "internal", email: "TEST_INTERNAL_EMAIL", password: "TEST_INTERNAL_PASSWORD", rich: true, required: false },
  { name: "tenant B (empty)", email: "TEST_USER_B_EMAIL", password: "TEST_USER_B_PASSWORD", rich: false, required: false },
];

/** Measured inside the page: everything needed to judge the layout. */
const PROBE = `(() => {
  const de = document.documentElement;
  const clips = (el) => {
    const s = getComputedStyle(el);
    return s.overflowX !== 'visible' || s.overflowY !== 'visible';
  };
  const name = (el) => el.tagName.toLowerCase() + (el.className ? '.' + el.className.toString().trim().split(/\\s+/).slice(0, 3).join('.') : '');
  const outside = [];
  const clipped = [];
  const scrollers = [];
  document.querySelectorAll('*').forEach((el) => {
    const style = getComputedStyle(el);
    if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
      scrollers.push({ el: name(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.right > de.clientWidth + 0.5) {
      let parent = el.parentElement;
      let inScroller = false;
      while (parent) { if (clips(parent)) { inScroller = true; break; } parent = parent.parentElement; }
      if (!inScroller) outside.push({ el: name(el), right: Math.round(rect.right), width: Math.round(rect.width) });
    }
    if (el.children.length === 0 && style.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1) {
      clipped.push({ el: name(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, text: (el.textContent || '').trim().slice(0, 40) });
    }
  });
  const edge = (selector) => {
    const el = document.querySelector(selector);
    return el ? Math.round(el.getBoundingClientRect().right) : null;
  };
  return {
    clientWidth: de.clientWidth,
    docScrollWidth: de.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    headerRight: edge('header'),
    mainRight: edge('main'),
    hasLogout: !!document.querySelector('header form button'),
    studies: document.querySelectorAll('main section[id^="study-"]').length,
    tiles: document.querySelectorAll('main section[id^="study-"] .grid > div').length,
    journeyStages: document.querySelectorAll('main section[id^="study-"] button[aria-pressed]').length,
    selects: document.querySelectorAll('main select').length,
    outside: outside.slice(0, 6),
    clippedText: clipped.slice(0, 6),
    internalScrollers: scrollers.length,
  };
})()`;

function chromeBinary() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      "no Chrome/Edge binary found - set CHROME_PATH to run the rendered-layout gate",
    );
  }
  return found;
}

/**
 * Signs in with a fixture account and proxies the app with that session
 * attached, so the browser never has to be handed a password.
 */
async function startSignedInProxy(role) {
  const jar = new Map();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
      },
    },
  );
  const { error } = await supabase.auth.signInWithPassword({
    email: process.env[role.email],
    password: process.env[role.password],
  });
  if (error) throw new Error(`sign-in failed for ${role.name}: ${error.message}`);
  const cookie = [...jar.entries()].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");

  const server = http.createServer(async (request, response) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (["host", "connection", "cookie", "content-length", "accept-encoding"].includes(key)) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
      }
      headers.set("cookie", cookie);
      headers.set("accept-encoding", "identity");
      const upstream = await fetch(new URL(request.url, APP_ORIGIN), { headers, redirect: "manual" });
      const out = {};
      upstream.headers.forEach((value, key) => {
        if (["content-encoding", "content-length", "set-cookie", "transfer-encoding"].includes(key)) return;
        out[key] = value;
      });
      response.writeHead(upstream.status, out);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (proxyError) {
      response.writeHead(502, { "content-type": "text/plain" });
      response.end(String(proxyError.message));
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return { origin: `http://localhost:${server.address().port}`, close: () => server.close() };
}

async function connect(port) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const waiters = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method === "Page.loadEventFired") {
      waiters.splice(0).forEach((resolve) => resolve());
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      socket.send(JSON.stringify({ id: messageId, method, params }));
    });
  return {
    send,
    close: () => socket.close(),
    load: async (url) => {
      const loaded = new Promise((resolve) => waiters.push(resolve));
      await send("Page.navigate", { url });
      await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 30000))]);
      // A remote preview can still be streaming when the load event fires, so
      // wait for the page shell itself rather than for a fixed delay.
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const ready = await send("Runtime.evaluate", {
          expression: "document.readyState === 'complete' && !!document.querySelector('header')",
          returnByValue: true,
        });
        if (ready.result.value) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
    evaluate: async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
      return result.result.value;
    },
  };
}

const health = await fetch(new URL("/api/health", APP_ORIGIN)).catch(() => null);
if (!health?.ok) {
  throw new Error(`the app is not answering at ${APP_ORIGIN} - start it with "npm run dev" first`);
}

const chrome = spawn(chromeBinary(), [
  "--headless=new",
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "becommunity-layout-"))}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "about:blank",
], { stdio: "ignore" });

let session;
let checks = 0;
try {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const probe = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).catch(() => null);
    if (probe?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  session = await connect(DEBUG_PORT);
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  for (const role of ROLES) {
    if (!process.env[role.email] || !process.env[role.password]) {
      assert.ok(!role.required, `missing fixture credentials for ${role.name}`);
      console.log(`  - ${role.name}: skipped (no fixture credentials)`);
      continue;
    }
    const proxy = await startSignedInProxy(role);
    try {
      for (const width of [...MOBILE_WIDTHS, DESKTOP_WIDTH]) {
        await session.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 812,
          deviceScaleFactor: 1,
          mobile: width < 768,
        });
        await session.load(`${proxy.origin}/dashboard`);
        const view = await session.evaluate(PROBE);
        const where = `${role.name} @ ${width}px`;

        assert.equal(view.clientWidth, width, `${where}: viewport did not apply`);
        assert.equal(
          view.docScrollWidth,
          view.clientWidth,
          `${where}: document scrolls horizontally (${view.docScrollWidth} > ${view.clientWidth}); first offenders ${JSON.stringify(view.outside)}`,
        );
        assert.ok(
          view.bodyScrollWidth <= view.clientWidth,
          `${where}: body is wider than the viewport (${view.bodyScrollWidth})`,
        );
        assert.deepEqual(
          view.outside,
          [],
          `${where}: content sits past the viewport edge outside any scroll container`,
        );
        assert.deepEqual(
          view.clippedText,
          [],
          `${where}: text overflows its own box and becomes unreadable`,
        );
        assert.equal(view.headerRight, view.clientWidth, `${where}: header does not reach the viewport edge`);
        // Below `sm` the main column is full-bleed, so it must end exactly where
        // the header does - that shared boundary is what the defect broke. From
        // `sm` up the column is centred by max-width and only has to stay inside.
        if (width < 640) {
          assert.equal(view.mainRight, view.clientWidth, `${where}: main does not share the header's boundary`);
        } else {
          assert.ok(view.mainRight <= view.clientWidth, `${where}: main extends past the viewport`);
        }
        assert.ok(view.hasLogout, `${where}: the logout control disappeared`);

        if (role.rich) {
          // Guards against "fixing" the overflow by dropping content.
          assert.ok(view.studies >= 1, `${where}: the study card disappeared`);
          assert.ok(view.tiles >= 4, `${where}: metric tiles disappeared`);
          assert.ok(view.journeyStages >= 3, `${where}: journey stages disappeared`);
          assert.ok(view.selects >= 2, `${where}: filter controls disappeared`);
          if (width < 768) {
            assert.ok(
              view.internalScrollers >= 1,
              `${where}: nothing scrolls internally - wide content is being clipped rather than scrolled`,
            );
          }
        }
        checks += 1;
        console.log(`  - ${where}: scrollWidth=${view.docScrollWidth} clientWidth=${view.clientWidth} internalScrollers=${view.internalScrollers}`);
      }
    } finally {
      proxy.close();
    }
  }
} finally {
  session?.close();
  chrome.kill();
}

console.log(`rendered layout gate: ${checks} viewport checks, no document-level horizontal overflow`);
