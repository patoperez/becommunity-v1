// =============================================================================
// P7 adversarial harness — browser mechanism (docs/P7_HARNESS_DESIGN.md §4, §7).
// =============================================================================
// Raw CDP over the WebSocket the runtime already provides. No Playwright, no
// Puppeteer, no new dependency (§7.5).
//
// Three properties this file exists to guarantee:
//   - the OS assigns the debug port, so two runs can never collide (§7.3);
//   - each actor gets its own browser context, so auth storage cannot leak (§7.4);
//   - every wait is event-driven and doubly bounded — a monotonic deadline AND an
//     explicit event cap (§4.4.1). Nothing here polls an application endpoint.
//
// Controls are located ONLY by accessible name, label text, or form-field name
// (§4.1). No generated class, no hash, no framework hidden field is ever read:
// where a form must be submitted, the browser submits its own DOM.
// =============================================================================

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

/** Hard caps for the CDP message pump (§4.4.1). */
const MAX_EVENTS_PER_WAIT = 5000;
const HANDSHAKE_MS = 20_000;
const NAV_MS = 30_000;
const DOM_MS = 20_000;

const now = () => Number(process.hrtime.bigint() / 1_000_000n);

export function findBrowserBinary() {
  return CHROME_CANDIDATES.find((path) => existsSync(path)) ?? null;
}

/** Ask the OS for a free port, then hand it to Chrome. Never a fixed default. */
function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Bounded readiness check on a process we started ourselves — not application
 * state, and not an application request (§4.3).
 */
async function waitForDevTools(port, deadline) {
  let lastError = null;
  while (now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`browser DevTools endpoint never answered: ${lastError?.message ?? "timeout"}`);
}

/** Flat-session CDP client: one socket, sessionId routing, bounded waits. */
function createCdp(socket) {
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`CDP ${message.error.message}`));
      else resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });

  function send(method, params = {}, sessionId) {
    const id = ++nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify(payload));
    });
  }

  /**
   * The one loop the design permits (§4.4.1): it consumes messages the browser
   * pushes, never issues an application request, and is bounded by BOTH a
   * monotonic deadline and an explicit event cap. Exhausting either is a
   * recorded failure, never a retry.
   */
  function waitForEvent(predicate, { timeoutMs, maxEvents = MAX_EVENTS_PER_WAIT, what }) {
    const deadline = now() + timeoutMs;
    return new Promise((resolve, reject) => {
      let seen = 0;
      const finish = (fn, value) => {
        listeners.delete(listener);
        clearTimeout(timer);
        fn(value);
      };
      const listener = (message) => {
        seen += 1;
        if (seen > maxEvents) {
          finish(reject, new Error(`CDP event cap (${maxEvents}) exhausted waiting for ${what}`));
          return;
        }
        if (now() > deadline) {
          finish(reject, new Error(`CDP deadline exhausted waiting for ${what}`));
          return;
        }
        if (predicate(message)) finish(resolve, message);
      };
      const timer = setTimeout(
        () => finish(reject, new Error(`timeout after ${timeoutMs}ms waiting for ${what}`)),
        timeoutMs,
      );
      listeners.add(listener);
    });
  }

  return { send, waitForEvent, close: () => socket.close() };
}

/** In-page readiness: a MutationObserver resolves it; Node never polls (§4.3). */
const WAIT_FOR_DOM = (predicateSource, timeoutMs) => `
new Promise((resolve, reject) => {
  const test = ${predicateSource};
  const check = () => { try { return !!test(); } catch { return false; } };
  if (check()) { resolve(true); return; }
  const observer = new MutationObserver(() => {
    if (check()) { observer.disconnect(); clearTimeout(timer); resolve(true); }
  });
  const timer = setTimeout(() => { observer.disconnect(); reject(new Error("dom-condition-timeout")); }, ${timeoutMs});
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
})`;

export async function launchBrowser() {
  const binary = findBrowserBinary();
  if (!binary) {
    const error = new Error(
      "no supported Chrome/Edge binary found — set CHROME_PATH. A browser is MANDATORY for the harness self-test (design §3.2, S0)",
    );
    error.code = "NO_BROWSER";
    throw error;
  }
  const port = await ephemeralPort();
  const profileDir = mkdtempSync(join(tmpdir(), "becommunity-harness-"));
  const child = spawn(
    binary,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const version = await waitForDevTools(port, now() + HANDSHAKE_MS);
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("browser websocket did not open")), HANDSHAKE_MS);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", (event) => { clearTimeout(timer); reject(new Error(`browser websocket error: ${event?.message ?? "unknown"}`)); }, { once: true });
  });

  const cdp = createCdp(socket);
  const contexts = [];

  /** One isolated browser context per actor (§7.4). */
  async function createContext({ label, javaScript = true }) {
    const { browserContextId } = await cdp.send("Target.createBrowserContext", {
      disposeOnDetach: false,
    });
    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
      browserContextId,
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    if (!javaScript) await cdp.send("Emulation.setScriptExecutionDisabled", { value: true }, sessionId);

    const context = {
      label,
      javaScript,
      browserContextId,
      targetId,
      sessionId,

      async navigate(url) {
        const loaded = cdp.waitForEvent(
          (m) => m.sessionId === sessionId && m.method === "Page.loadEventFired",
          { timeoutMs: NAV_MS, what: `page load of ${label}` },
        );
        await cdp.send("Page.navigate", { url }, sessionId);
        await loaded;
        return context.location();
      },

      /** Evaluates in the page. JS-disabled contexts get a dedicated world. */
      async evaluate(expression, { awaitPromise = false } = {}) {
        const result = await cdp.send(
          "Runtime.evaluate",
          {
            expression,
            returnByValue: true,
            awaitPromise,
            ...(javaScript ? {} : { contextId: undefined, allowUnsafeEvalBlockedByCSP: false }),
          },
          sessionId,
        );
        if (result.exceptionDetails) {
          throw new Error(
            result.exceptionDetails.exception?.description?.split("\n")[0] ?? "evaluate failed",
          );
        }
        return result.result.value;
      },

      location: () => context.evaluate("location.pathname + location.search"),

      /** Event-driven DOM wait; bounded in-page and by the CDP deadline. */
      waitForDom(predicateSource, timeoutMs = DOM_MS) {
        return context.evaluate(WAIT_FOR_DOM(predicateSource, timeoutMs), { awaitPromise: true });
      },

      /**
       * Waits for the navigation a submission causes (§4.3). Two shapes exist
       * and both are legitimate outcomes of the same Server Action:
       *   - JavaScript disabled: a full document load (`Page.loadEventFired`);
       *   - JavaScript enabled: the framework's own client-side navigation,
       *     which updates history rather than reloading the document.
       * Racing them keeps the wait event-driven for both mechanisms.
       */
      async submitAndWait(clickExpression) {
        const NAV_EVENTS = new Set([
          "Page.loadEventFired",
          "Page.navigatedWithinDocument",
          "Page.frameNavigated",
        ]);
        const navigated = cdp.waitForEvent(
          (m) => m.sessionId === sessionId && NAV_EVENTS.has(m.method),
          { timeoutMs: NAV_MS, what: `submission navigation of ${label}` },
        );
        await context.evaluate(clickExpression);
        await navigated;
        return context.location();
      },

      /** Cookies for this context only — values never leave the harness (§5.2). */
      async cookies(origin) {
        const { cookies } = await cdp.send("Network.getCookies", { urls: [origin] }, sessionId);
        return cookies.map(({ name, value }) => ({ name, value }));
      },

      async clearCookies() {
        await cdp.send("Network.clearBrowserCookies", {}, sessionId);
      },

      async setCookies(origin, entries) {
        const { hostname } = new URL(origin);
        for (const { name, value } of entries) {
          await cdp.send(
            "Network.setCookie",
            { name, value, domain: hostname, path: "/" },
            sessionId,
          );
        }
      },

      async dispose() {
        await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
        await cdp.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
      },
    };
    contexts.push(context);
    return context;
  }

  async function close() {
    for (const context of contexts) await context.dispose().catch(() => {});
    cdp.close();
    child.kill();
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* the OS reclaims the temp dir; never fail a run on this */
    }
  }

  return { createContext, close, port, binary };
}

/**
 * Semantic locators, evaluated in the page. Every one keys on an accessible
 * name, a label, or a form-field `name` the Server Action itself reads (§4.1).
 * None of them reads a framework hidden field.
 */
export const PAGE = {
  /** The page's own landmark — the render-completeness signal (§4.2). */
  landmark: "!!document.querySelector('header') && document.readyState === 'complete'",

  /** Locates a form by the accessible name of its submit control. */
  formBySubmit: (label) => `
    (() => {
      const forms = [...document.querySelectorAll('form')];
      return forms.findIndex((form) => [...form.querySelectorAll('button, input[type=submit]')]
        .some((control) => (control.textContent || control.value || '').trim() === ${JSON.stringify(label)}));
    })()`,

  /** Sets a named field the way a user would, so React sees a real change. */
  setField: (formIndex, name, value) => `
    (() => {
      const form = document.querySelectorAll('form')[${formIndex}];
      if (!form) return 'no-form';
      const field = form.querySelector('[name=' + ${JSON.stringify(JSON.stringify(name))} + ']');
      if (!field) return 'no-field';
      const proto = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`,

  clickSubmit: (formIndex) => `
    (() => {
      const form = document.querySelectorAll('form')[${formIndex}];
      if (!form) return 'no-form';
      const control = form.querySelector('button:not([type=button]), input[type=submit]');
      if (!control) return 'no-submit';
      control.click();
      return 'ok';
    })()`,

  /** Selects an option by its visible text and returns the option's value. */
  optionValueByText: (selectName, text) => `
    (() => {
      const select = document.querySelector('select[name=' + ${JSON.stringify(JSON.stringify(selectName))} + ']');
      if (!select) return null;
      const option = [...select.options].find((item) => item.textContent.trim() === ${JSON.stringify(text)});
      return option ? option.value : null;
    })()`,
};
