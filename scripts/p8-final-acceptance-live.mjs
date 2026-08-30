/**
 * P8.5 rendered acceptance matrix.
 *
 * This is deliberately a geometry/accessibility probe, not a screenshot suite.
 * It signs fixture roles in outside the browser, attaches only their session
 * cookie to a loopback proxy, and visits the real product at the six supported
 * widths. Credentials never enter Chrome or the report.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";

const APP_ORIGIN = process.env.RESPONSIVE_APP_ORIGIN ?? "http://127.0.0.1:3000";
const WIDTHS = [320, 360, 390, 768, 1024, 1280];
const DEBUG_PORT = Number(process.env.P8_ACCEPTANCE_DEBUG_PORT ?? 9400 + Math.floor(Math.random() * 400));
const PROFILE = mkdtempSync(join(tmpdir(), "becommunity-p8-acceptance-"));

const CHROME = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean).find(existsSync);
assert.ok(CHROME, "Chrome or Edge is required for the rendered acceptance matrix");

const ROLES = [
  { name: "cliente A", email: "TEST_USER_A_EMAIL", password: "TEST_USER_A_PASSWORD", required: true, base: ["/dashboard", "/insights"], discover: "client" },
  { name: "cliente B", email: "TEST_USER_B_EMAIL", password: "TEST_USER_B_PASSWORD", required: false, base: ["/dashboard", "/insights"] },
  { name: "equipo interno", email: "TEST_INTERNAL_EMAIL", password: "TEST_INTERNAL_PASSWORD", required: false, base: ["/studio", "/studio/estudios", "/studio/clientes", "/studio/plantillas"], discover: "internal" },
];

const PROBE = `(() => {
  const root = document.documentElement;
  const visible = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return !el.classList.contains('sr-only') && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const clips = (el) => {
    const s = getComputedStyle(el);
    return s.overflowX !== 'visible' || s.overflowY !== 'visible';
  };
  const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  const outside = [];
  const clippedText = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (!visible(el)) return;
    const rect = el.getBoundingClientRect();
    if (rect.left < -0.5 || rect.right > root.clientWidth + 0.5) {
      let parent = el.parentElement;
      let contained = false;
      while (parent) { if (clips(parent)) { contained = true; break; } parent = parent.parentElement; }
      if (!contained) outside.push({ element: label(el), left: Math.round(rect.left), right: Math.round(rect.right) });
    }
    const style = getComputedStyle(el);
    if (el.children.length === 0 && !['svg','path','script','style','option'].includes(el.tagName.toLowerCase()) && style.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1) {
      clippedText.push({ element: label(el), text: (el.textContent || '').trim().slice(0, 70), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
  });
  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id).filter(Boolean);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const unnamedGraphics = [...document.querySelectorAll('svg[role="img"], [role="img"]')].filter((el) => !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.querySelector('title')).map(label);
  const imagesWithoutAlt = [...document.querySelectorAll('img:not([alt])')].map(label);
  const smallControls = [...document.querySelectorAll('button,summary,select,textarea,input:not([type="hidden"])')].filter(visible).flatMap((el) => {
    const target = (el.matches('input[type="checkbox"],input[type="radio"]') ? el.closest('label') : el) || el;
    const rect = target.getBoundingClientRect();
    return rect.width < 24 || rect.height < 24 ? [{ element: label(el), width: Math.round(rect.width), height: Math.round(rect.height) }] : [];
  });
  return {
    lang: document.documentElement.lang,
    title: document.title,
    main: !!document.querySelector('main#contenido'),
    skip: !!document.querySelector('a[href="#contenido"]'),
    clientWidth: root.clientWidth,
    documentWidth: root.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    outside: outside.slice(0, 8),
    clippedText: clippedText.slice(0, 8),
    duplicates,
    unnamedGraphics,
    imagesWithoutAlt,
    smallControls: smallControls.slice(0, 8),
  };
})()`;

async function signedInProxy(role) {
  const jar = new Map();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email: process.env[role.email], password: process.env[role.password] });
  if (error) throw new Error(`fixture sign-in failed for ${role.name}: ${error.message}`);
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
      const upstream = await fetch(new URL(request.url, APP_ORIGIN), { headers, redirect: "manual" });
      const outgoing = {};
      upstream.headers.forEach((value, key) => {
        if (!["content-encoding", "content-length", "set-cookie", "transfer-encoding"].includes(key)) outgoing[key] = value;
      });
      response.writeHead(upstream.status, outgoing);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.writeHead(502, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : "proxy error");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

async function connect() {
  const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const loaded = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const waiter = pending.get(message.id); pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
    } else if (message.method === "Page.loadEventFired") loaded.splice(0).forEach((resolve) => resolve());
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    close: () => socket.close(),
    evaluate: async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "page evaluation failed");
      return result.result.value;
    },
    load: async (url) => {
      const event = new Promise((resolve) => loaded.push(resolve));
      await send("Page.navigate", { url });
      await Promise.race([event, new Promise((resolve) => setTimeout(resolve, 30000))]);
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const ready = await send("Runtime.evaluate", { expression: "document.readyState === 'complete' && !!document.querySelector('main')", returnByValue: true });
        if (ready.result.value) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    },
  };
}

async function discoveredRoutes(session, origin, role) {
  const routes = [...role.base];
  if (role.discover === "client") {
    await session.load(`${origin}/insights`);
    const study = await session.evaluate(`document.querySelector('a[href^="/insights/e/"]')?.getAttribute('href') || null`);
    if (study) routes.push(study);
  }
  if (role.discover === "internal") {
    await session.load(`${origin}/studio/estudios`);
    const study = await session.evaluate(`document.querySelector('a[href^="/studio/e/"]')?.getAttribute('href') || null`);
    if (study) {
      const base = study.match(/^\/studio\/e\/[^/]+/)?.[0];
      if (base) {
        const studyId = base.split("/").at(-1);
        // `construccion` is the dashboard builder. It is internal, it is not
        // one of the study's process steps, and it is visited here because it
        // is the widest surface in Studio: a three-column editor that has to
        // collapse to one readable column on a 320 px phone.
        routes.push(base, `${base}/datos`, `${base}/categorias`, `${base}/indicadores`, `${base}/cualitativo`, `${base}/interpretacion`, `${base}/vista-cliente`, `${base}/publicar`, `${base}/construccion`, `/admin/preview/${studyId}`);
      }
    }
    await session.load(`${origin}/studio/clientes`);
    const client = await session.evaluate(`[...document.querySelectorAll('a[href^="/studio/clientes/"]')].map((a) => a.getAttribute('href')).find((href) => /^\\/studio\\/clientes\\/[^/]+$/.test(href)) || null`);
    if (client) routes.push(client);
  }
  return [...new Set(routes)];
}

const health = await fetch(new URL("/api/health", APP_ORIGIN)).catch(() => null);
assert.ok(health?.ok, `start the application at ${APP_ORIGIN} before running the live matrix`);

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
let session;
let views = 0;
let routes = 0;
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).catch(() => null);
    if (response?.ok) { ready = true; break; }
    if (chrome.exitCode != null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "headless browser did not start");
  session = await connect();
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  await session.send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await session.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  for (const role of ROLES) {
    if (process.env.P8_ACCEPTANCE_ROLE && role.name !== process.env.P8_ACCEPTANCE_ROLE) continue;
    if (!process.env[role.email] || !process.env[role.password]) {
      assert.ok(!role.required, `missing fixture credentials for ${role.name}`);
      console.log(`  - ${role.name}: omitted because this verifier has no fixture account`);
      continue;
    }
    const proxy = await signedInProxy(role);
    try {
      const discovered = await discoveredRoutes(session, proxy.origin, role);
      const roleRoutes = process.env.P8_ACCEPTANCE_PATH
        ? discovered.filter((path) => path === process.env.P8_ACCEPTANCE_PATH)
        : discovered;
      assert.ok(discovered.length >= role.base.length, `${role.name}: route discovery lost a required surface`);
      assert.ok(roleRoutes.length > 0, `${role.name}: the requested route filter matched nothing`);
      routes += roleRoutes.length;

      await session.load(`${proxy.origin}${roleRoutes[0]}`);
      const motion = await session.evaluate(`(() => { const el = document.createElement('div'); el.style.cssText = 'animation-duration:1s;transition-duration:1s'; document.body.append(el); const style = getComputedStyle(el); const result = { matches: matchMedia('(prefers-reduced-motion: reduce)').matches, animation: parseFloat(style.animationDuration), transition: parseFloat(style.transitionDuration) }; el.remove(); return result; })()`);
      assert.equal(motion.matches, true, `${role.name}: reduced-motion preference was not applied`);
      assert.ok(motion.animation <= 0.001 && motion.transition <= 0.001, `${role.name}: motion is not reduced (${JSON.stringify(motion)})`);

      await session.evaluate(`document.body.focus()`);
      await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      const firstFocus = await session.evaluate(`({ text: document.activeElement?.textContent?.trim(), href: document.activeElement?.getAttribute?.('href') })`);
      assert.equal(firstFocus.href, "#contenido", `${role.name}: the skip link is not the first keyboard stop (${JSON.stringify(firstFocus)})`);

      for (const path of roleRoutes) {
        for (const width of WIDTHS) {
          await session.send("Emulation.setDeviceMetricsOverride", { width, height: width < 768 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 768 });
          await session.load(`${proxy.origin}${path}`);
          const view = await session.evaluate(PROBE);
          const where = `${role.name} ${path} @ ${width}px`;
          assert.equal(view.lang, "es", `${where}: document language changed`);
          assert.equal(view.clientWidth, width, `${where}: viewport did not apply`);
          assert.equal(view.documentWidth, width, `${where}: document has horizontal overflow (${view.documentWidth}); ${JSON.stringify({ outside: view.outside, clippedText: view.clippedText })}`);
          assert.ok(view.bodyWidth <= width, `${where}: body has horizontal overflow (${view.bodyWidth})`);
          assert.equal(view.main, true, `${where}: named main content is missing`);
          assert.equal(view.skip, true, `${where}: skip link is missing`);
          assert.deepEqual(view.outside, [], `${where}: content escapes the viewport`);
          assert.deepEqual(view.clippedText, [], `${where}: text is clipped ${JSON.stringify(view.clippedText)}`);
          assert.deepEqual(view.duplicates, [], `${where}: duplicate DOM ids`);
          assert.deepEqual(view.unnamedGraphics, [], `${where}: graphic lacks an accessible name`);
          assert.deepEqual(view.imagesWithoutAlt, [], `${where}: image lacks alt text`);
          assert.deepEqual(view.smallControls, [], `${where}: control target is under 24px ${JSON.stringify(view.smallControls)}`);
          views += 1;
        }
      }
      console.log(`  - ${role.name}: ${roleRoutes.length} routes × ${WIDTHS.length} widths`);
    } finally {
      proxy.close();
    }
  }
} finally {
  session?.close();
  chrome.kill();
  if (chrome.exitCode == null) {
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

console.log(`P8.5 rendered acceptance: PASS (${views} views, ${routes} routes, ${WIDTHS.length} widths)`);
