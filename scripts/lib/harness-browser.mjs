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
      // DevTools /json/version handshake — browser control, never application data.
      if (response.ok) return await response.json(); // /json/ endpoint, not an app body
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
  let closed = null;

  /**
   * Terminating the browser must make in-flight browser work REJECT rather than
   * hang, so a cancelled run can settle before cleanup begins.
   */
  function failAll(reason) {
    closed = reason;
    for (const [, entry] of pending) entry.reject(reason);
    pending.clear();
    for (const listener of [...listeners]) listener({ __cdpClosed: reason });
  }
  socket.addEventListener("close", () => failAll(new Error("CDP socket closed (browser terminated)")), { once: true });

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
    if (closed) return Promise.reject(closed);
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
        if (message.__cdpClosed) { finish(reject, message.__cdpClosed); return; }
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

  /**
   * A persistent subscription, used for exactly one thing: answering the
   * browser's own modal dialogs (§ PR 7). It consumes pushed messages and never
   * issues an application request, so it is not a poller (§4.4.1).
   */
  function on(handler) {
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  return { send, waitForEvent, on, close: () => socket.close() };
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

    // The import-rollback control asks for confirmation through `window.confirm`
    // (UploadForm.tsx:208). A headless page blocks on that dialog until it is
    // answered, so the context answers it the way the user who clicked the
    // control would. Nothing else is automated: the dialog is the browser's own
    // event, and accepting it neither adds authority nor changes a request.
    let dialogsAccepted = 0;
    cdp.on((message) => {
      if (message.sessionId !== sessionId || message.method !== "Page.javascriptDialogOpening") return;
      dialogsAccepted += 1;
      cdp.send("Page.handleJavaScriptDialog", { accept: true }, sessionId).catch(() => {});
    });

    const context = {
      label,
      javaScript,
      browserContextId,
      targetId,
      sessionId,
      dialogsAccepted: () => dialogsAccepted,

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

      /**
       * Attaches a real file to a real `<input type=file>`, the way a user's
       * file picker does. The browser reads the bytes itself; the harness never
       * builds a multipart body and never touches the framework's transport.
       * The input is located by the accessible text of its own `<label>` (§4.1).
       */
      async setFileInput(labelPrefix, absolutePaths) {
        // The index is derived from the label the product renders; nothing is
        // added to the page. No `data-*` test attribute is ever introduced
        // here or in application source (§4.1).
        const index = await context.evaluate(`
          (() => {
            const fields = [...document.querySelectorAll('input[type=file]')];
            const label = [...document.querySelectorAll('label')]
              .find((item) => item.textContent.trim().startsWith(${JSON.stringify(labelPrefix)}));
            const field = label && label.querySelector('input[type=file]');
            return field ? fields.indexOf(field) : -1;
          })()`);
        if (index < 0) return "no-control";
        // The DOM domain is enabled lazily, here and nowhere else. Enabling it
        // for every context would make the browser push a DOM mutation event
        // for every node of every page into the same message pump that waits
        // for navigation, for no benefit on the surfaces that never upload.
        await cdp.send("DOM.enable", {}, sessionId);
        const { root } = await cdp.send("DOM.getDocument", { depth: -1 }, sessionId);
        const { nodeIds } = await cdp.send(
          "DOM.querySelectorAll",
          { nodeId: root.nodeId, selector: "input[type=file]" },
          sessionId,
        );
        const nodeId = nodeIds?.[index];
        if (!nodeId) return "no-node";
        await cdp.send("DOM.setFileInputFiles", { files: absolutePaths, nodeId }, sessionId);
        return "ok";
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

  /**
   * Locates one form among several identical ones by the VALUE of a field the
   * Server Action itself reads (`formData.get("template_id")`). This is §4.1
   * rule 3 — a server contract, not a framework hidden field — and it is what
   * stops a destructive submission from landing on the neighbouring object's
   * form when a page renders one form per tenant, user or template.
   */
  formByFieldValue: (name, value, label) => `
    (() => {
      const forms = [...document.querySelectorAll('form')];
      return forms.findIndex((form) => {
        const field = form.querySelector('[name=' + ${JSON.stringify(JSON.stringify(name))} + ']');
        if (!field || field.value !== ${JSON.stringify(value)}) return false;
        return [...form.querySelectorAll('button, input[type=submit]')]
          .some((control) => (control.textContent || control.value || '').trim() === ${JSON.stringify(label)});
      });
    })()`,

  /** Ticks every checkbox inside ONE located form, the way a user would. */
  checkAllInForm: (formIndex) => `
    (() => {
      const form = document.querySelectorAll('form')[${formIndex}];
      if (!form) return -1;
      const boxes = [...form.querySelectorAll('input[type=checkbox]')];
      for (const box of boxes) if (!box.checked) box.click();
      return boxes.length;
    })()`,

  /** Ticks every checkbox of one NAME inside one located form. */
  checkAllInFormNamed: (formIndex, name) => `
    (() => {
      const form = document.querySelectorAll('form')[${formIndex}];
      if (!form) return -1;
      const boxes = [...form.querySelectorAll('input[type=checkbox][name=' + ${JSON.stringify(JSON.stringify(name))} + ']')];
      for (const box of boxes) if (!box.checked) box.click();
      return boxes.length;
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

  /**
   * The application's own wrong-role denial page (§1.8 AM4). `/admin/upload`
   * answers a `client` caller with HTTP 200 and this rendered panel instead of
   * a redirect, so "not a successful render of the upload UI" is read from the
   * product's own user-visible heading — a stable UX contract, not a class name.
   */
  deniedPanel: `
    (() => {
      const headings = [...document.querySelectorAll('h1, h2')];
      return headings.some((node) => (node.textContent || '').trim() === 'Acceso denegado');
    })()`,

  /**
   * The app's own error region for an imperative Server Action, as a BOOLEAN.
   * `UploadForm` marks it `role="alert"` (`:270`, `:432`); the dashboard's
   * `StudyCard` and `PivotExplorer` render their `{ ok: false }` error text in
   * an unmarked panel instead, which is why `actionOutcomeKind` below also
   * consults the application's own fixed error constants.
   */
  alertPresent: `
    (() => [...document.querySelectorAll('[role="alert"]')]
      .some((node) => (node.textContent || '').trim().length > 0))()`,

  /**
   * Classifies an imperative action's rendered outcome into the closed
   * vocabulary, WITHOUT letting any product text escape: it returns one of
   * "denial" / "validation" / "none" and nothing else.
   *
   * Design §5.3 sanctions exactly this — `denied_wrong_role` is recognized by
   * "an action result carrying the app's fixed denial string". The two lists
   * below are application CONSTANTS read from `upload/actions.ts:78-93` and
   * `dashboard/data-actions.ts:33-46`, not user data and not framework
   * internals, and the DENIAL list is tested first so an authorization refusal
   * can never be reported as a mere validation rejection.
   *
   * A `role="alert"` region carrying anything else is still a refusal — it is
   * the product's own error region — so it classifies as "validation" rather
   * than as success. Silence classifies as "none", which the outcome
   * classifier turns into `unclassified` and which fails the run.
   */
  actionOutcomeKind: `
    (() => {
      const body = document.body.innerText || '';
      const denials = [
        'No autenticado.',
        'Acceso denegado',
        'Estudio no disponible',
      ];
      if (denials.some((marker) => body.includes(marker))) return 'denial';
      const validations = [
        'Solicitud invalida',
        'Filtros no permitidos',
        'No fue posible recalcular el estudio',
        'No fue posible calcular el cruce',
        'Dimensión de filtro no permitida',
        'Valor no permitido para',
        'El archivo supera el límite',
        'Formato no soportado',
        'Adjunta un archivo CSV o Excel',
        'No se pudo leer el archivo',
        'El cliente seleccionado no existe.',
        'El mapeo no contiene JSON válido.',
        'Mapeo inválido',
        'Cliente inválido.',
        'Estudio inválido.',
        'Dimensión de fila no permitida',
        'Dimensión de columna no permitida',
        'Métrica no permitida',
        'Agregación no permitida',
        'Una dimensión no puede ser fila y columna',
        'Selecciona al menos una',
      ];
      if (validations.some((marker) => body.includes(marker))) return 'validation';
      const alerted = [...document.querySelectorAll('[role="alert"]')]
        .some((node) => (node.textContent || '').trim().length > 0);
      return alerted ? 'validation' : 'none';
    })()`,

  /** True when a named control is present and enabled — a readiness condition. */
  controlEnabled: (label) => `
    (() => {
      const control = [...document.querySelectorAll('button, input[type=submit]')]
        .find((node) => (node.textContent || node.value || '').trim() === ${JSON.stringify(label)});
      return Boolean(control) && !control.disabled;
    })()`,

  /** Clicks a control located by its accessible name anywhere on the page. */
  clickByName: (label) => `
    (() => {
      const control = [...document.querySelectorAll('button, input[type=submit]')]
        .find((node) => (node.textContent || node.value || '').trim() === ${JSON.stringify(label)});
      if (!control) return 'no-control';
      if (control.disabled) return 'disabled';
      control.click();
      return 'ok';
    })()`,

  /**
   * Ticks the one checkbox whose own `<label>` text starts with `prefix`. Used
   * where the product labels a confirmation in prose rather than with an
   * `aria-label`, and deliberately narrow: ticking a neighbouring checkbox can
   * reset unrelated state the user never touched.
   */
  checkByLabelTextPrefix: (prefix) => `
    (() => {
      const labels = [...document.querySelectorAll('label')]
        .filter((item) => item.textContent.trim().startsWith(${JSON.stringify(prefix)}));
      if (labels.length === 0) return 'no-control';
      if (labels.length > 1) return 'ambiguous';
      const box = labels[0].querySelector('input[type=checkbox]');
      if (!box) return 'no-checkbox';
      if (!box.checked) box.click();
      return box.checked ? 'ok' : 'not-checked';
    })()`,

  /** Checks a checkbox located by its `aria-label` — the product's own contract. */
  checkByAriaLabel: (label) => `
    (() => {
      const box = document.querySelector('input[type=checkbox][aria-label=' + ${JSON.stringify(JSON.stringify(label))} + ']');
      if (!box) return 'no-control';
      if (!box.checked) box.click();
      return 'ok';
    })()`,

  /** Checks every observation checkbox the selected study rendered. */
  checkAllByFieldName: (name) => `
    (() => {
      const boxes = [...document.querySelectorAll('input[type=checkbox][name=' + ${JSON.stringify(JSON.stringify(name))} + ']')];
      for (const box of boxes) if (!box.checked) box.click();
      return boxes.length;
    })()`,

  /** Reads a labelled control's surrounding panel text — a stable DOM signal. */
  panelTextByLabel: (labelPrefix) => `
    (() => {
      const label = [...document.querySelectorAll('label')]
        .find((item) => item.textContent.trim().startsWith(${JSON.stringify(labelPrefix)}));
      if (!label) return null;
      const panel = label.closest('div') && label.closest('div').parentElement;
      return panel ? panel.innerText.trim().slice(0, 400) : null;
    })()`,

  /** Changes a labelled select the way a user would, so React sees it. */
  changeSelectByLabel: (labelPrefix) => `
    (() => {
      const label = [...document.querySelectorAll('label')]
        .find((item) => item.textContent.trim().startsWith(${JSON.stringify(labelPrefix)}));
      const select = label && label.querySelector('select');
      if (!select) return 'no-control';
      const target = [...select.options].find((option) => option.value !== select.value);
      if (!target) return 'no-alternative';
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, target.value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`,

  /**
   * Changes a select located by the PREFIX of its own `aria-label`. The study
   * filters are bare `<select aria-label="Filtrar por nivel">` controls with no
   * `<label>` wrapper, so `changeSelectByLabel` cannot see them.
   */
  changeSelectByAriaLabel: (prefix) => `
    (() => {
      const select = [...document.querySelectorAll('select')]
        .find((node) => (node.getAttribute('aria-label') || '').startsWith(${JSON.stringify(prefix)}));
      if (!select) return 'no-control';
      const target = [...select.options].find((option) => option.value !== select.value);
      if (!target) return 'no-alternative';
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, target.value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`,

  /**
   * Inserts a value the server never offered into the product's own control and
   * selects it — the visible-client-state tampering case. The framework still
   * builds the request; only the value is hostile.
   */
  forgeSelectValueByAriaLabel: (prefix, value) => `
    (() => {
      const select = [...document.querySelectorAll('select')]
        .find((node) => (node.getAttribute('aria-label') || '').startsWith(${JSON.stringify(prefix)}));
      if (!select) return 'no-control';
      const option = document.createElement('option');
      option.value = ${JSON.stringify(value)};
      option.textContent = 'forged';
      select.appendChild(option);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, option.value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`,

  /**
   * Selects, in whichever `<select>` offers it, the option whose visible text
   * starts with `prefix`. For controls the product renders without a label
   * wrapper or a `name`, the option's own text is the stable user-visible
   * contract (§4.1 rule 4). Exactly one match is required: two would mean the
   * run's namespace is ambiguous, and guessing which is ours is how a test
   * writes to the wrong object.
   */
  selectOptionByTextPrefix: (prefix) => `
    (() => {
      const hits = [];
      for (const select of document.querySelectorAll('select')) {
        for (const option of select.options) {
          if ((option.textContent || '').trim().startsWith(${JSON.stringify(prefix)})) hits.push([select, option]);
        }
      }
      if (hits.length === 0) return 'no-option';
      if (hits.length > 1) return 'ambiguous';
      const [select, option] = hits[0];
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, option.value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`,

  /**
   * The forged-value tamper for a select the product wraps in a `<label>` —
   * the shape `PivotExplorer` renders ("Filas", "Columnas", "Métrica",
   * "Agregación"). Its aria-label counterpart above serves the dashboard
   * filters, which carry no wrapper.
   */
  forgeSelectValueByLabel: (labelPrefix, value) => `
    (() => {
      const label = [...document.querySelectorAll('label')]
        .find((item) => item.textContent.trim().startsWith(${JSON.stringify(labelPrefix)}));
      const select = label && label.querySelector('select');
      if (!select) return 'no-control';
      const option = document.createElement('option');
      option.value = ${JSON.stringify(value)};
      option.textContent = 'forged';
      select.appendChild(option);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, option.value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
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

  /**
   * The same read, matched on a run-prefix rather than an exact label, for the
   * lists whose option text decorates the name it carries (the template
   * selector renders 'Sobrescribir "<name>" (vN)'). Returns exactly one value
   * or null: two matches mean the run's namespace is ambiguous and the caller
   * must fail rather than guess which object it owns.
   */
  onlyOptionValueContaining: (selectName, needle) => `
    (() => {
      const select = document.querySelector('select[name=' + ${JSON.stringify(JSON.stringify(selectName))} + ']');
      if (!select) return null;
      const matches = [...select.options].filter((item) => item.textContent.includes(${JSON.stringify(needle)}));
      return matches.length === 1 ? matches[0].value : null;
    })()`,
};

// ---------------------------------------------------------------------------
// Reviewed browser drivers for imperative Server Actions (design §1.7, §2.1)
// ---------------------------------------------------------------------------
//
// Imperative actions have no form binding, so the framework must construct the
// request from the application's own client runtime. Each driver therefore
// drives REAL controls and reports a stable rendered-DOM outcome. No driver
// builds, reads, parses or classifies a Server-Action / RSC transport payload.
//
// The dispatch is static and keyed by the frozen operation catalogue: a suite
// cannot improvise a driver, and an operation without a reviewed driver fails
// explicitly rather than being reported as anything.

/** Thrown when a catalogue operation has no reviewed driver yet. */
export class UnsupportedDriverError extends Error {
  constructor(operationName) {
    super(
      `no reviewed browser driver for "${operationName}" — not implemented in PR 5; ` +
        "a later suite must add and review one",
    );
    this.name = "UnsupportedDriverError";
    this.code = "UNSUPPORTED_DRIVER";
  }
}

const PIVOT_LABEL = "Agregación";

/** The pivot result panel, as a plain in-page expression the driver reuses. */
const PIVOT_PANEL_EXPR = `(() => {
  const label = [...document.querySelectorAll('label')]
    .find((item) => item.textContent.trim().startsWith(${JSON.stringify(PIVOT_LABEL)}));
  if (!label) return null;
  const panel = label.closest('div') && label.closest('div').parentElement;
  return panel ? panel.innerText.trim().slice(0, 400) : null;
})()`;

/** The dashboard's own settled-result signal (StudyCard.tsx:57's live region). */
const DASHBOARD_STATUS_EXPR = `(() => {
  const node = [...document.querySelectorAll('[aria-live="polite"]')]
    .find((n) => /unidades de respuesta|Muestra insuficiente|Actualizando/.test(n.textContent || ''));
  return node ? (node.textContent || '').trim() : '';
})()`;

/**
 * Settles an imperative action on the application's own rendered outcome: its
 * error region, or a caller-supplied success predicate. Returns the outcome as
 * a CATEGORY, never as rendered text (§2.3).
 */
async function settleImperative(context, PAGE, successPredicate, timeoutMs) {
  const settled = await context
    .waitForDom(`() => {
      const outcome = ${PAGE.actionOutcomeKind};
      const success = (${successPredicate})();
      return outcome !== 'none' || success;
    }`, timeoutMs)
    .catch(() => false);
  if (!settled) return { status: 200, domSignal: "none" };
  // A refusal is read FIRST: an action that both rendered an error and left an
  // earlier success panel on screen was refused, and reporting it as a success
  // would be exactly the false pass the classifier exists to prevent.
  const outcome = await context.evaluate(PAGE.actionOutcomeKind);
  if (outcome !== "none") return { status: 200, domSignal: outcome };
  const success = await context.evaluate(`(${successPredicate})()`);
  return { status: 200, domSignal: success ? "success" : "none" };
}

/** Selects the option whose value equals `value`, under a labelled control. */
const selectByValue = (labelPrefix, value) => `
  (() => {
    const label = [...document.querySelectorAll('label')]
      .find((item) => item.textContent.trim().startsWith(${JSON.stringify(labelPrefix)}));
    const select = label && label.querySelector('select');
    if (!select) return 'no-control';
    const option = [...select.options].find((item) => item.value === ${JSON.stringify(value)});
    if (!option) return 'no-option';
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, option.value);
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`;

/** The upload screen's own "analysis is ready" signal (UploadForm.tsx:272). */
const UPLOAD_READY = "() => /filas detectadas/.test(document.body.innerText)";
/** The preview screen's own "preview is ready" signal (its confirm control). */
const PREVIEW_READY =
  "() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('Confirmar importaci'))";
/** The confirm stage's own success signal (UploadForm renders the batch id). */
const CONFIRM_DONE = "() => /importaci[oó]n\\s+(confirmada|completada)|filas importadas|lote\\s+creado/i.test(document.body.innerText)";
/** The rollback control's own settled signal. */
const ROLLBACK_DONE = "() => /revertid/i.test(document.body.innerText)";

/**
 * The `upload.*` stages share one sequence, so each driver assumes the previous
 * stage already ran IN THE SAME CONTEXT — exactly as a real user's session
 * does. `params.file` is an absolute path to a run-owned temporary file; the
 * BROWSER reads it, so no multipart body is ever constructed here.
 */
async function selectUploadSource({ context, params }) {
  const tenant = await context.evaluate(selectByValue("Cliente", params.tenant_id));
  if (tenant !== "ok") return { status: 200, domSignal: "none", note: `tenant-${tenant}` };
  const attached = await context.setFileInput("Archivo CSV o Excel", [params.file]);
  if (attached !== "ok") return { status: 200, domSignal: "none", note: `file-${attached}` };
  return null;
}

export const BROWSER_DRIVERS = Object.freeze({
  /**
   * `computeStudyPivot` — fired by the dashboard's own pivot controls. The
   * observable outcome is the rendered result panel changing; that is the
   * application telling us the round-trip completed. The "before" snapshot is
   * kept in the page rather than interpolated back into a predicate, so no
   * rendered text is ever spliced into generated source.
   *
   * No driver navigates: `run()` has already navigated and classified the
   * page-level outcome, so a denial can never be misread as "no panel".
   */
  "dashboard.pivot": async ({ context, PAGE }) => {
    const before = await context.evaluate(
      `(() => { const value = ${PIVOT_PANEL_EXPR}; window.__harnessPivotBefore = value; return value; })()`,
    );
    if (before === null) return { status: 200, domSignal: "none" };
    const driven = await context.evaluate(PAGE.changeSelectByLabel(PIVOT_LABEL));
    if (driven !== "ok") return { status: 200, domSignal: "none" };
    const changed = await context
      .waitForDom(
        `() => { const value = ${PIVOT_PANEL_EXPR}; return value !== null && value !== window.__harnessPivotBefore; }`,
      )
      .catch(() => false);
    return { status: 200, domSignal: changed ? "success" : "none" };
  },

  /**
   * `refreshStudyDashboard` — fired by a study's own segment filter. The
   * settled signal is the live region StudyCard renders, which stops saying
   * "Actualizando…" once the server has answered.
   */
  "dashboard.refresh": async ({ context, PAGE, params }) => {
    const before = await context.evaluate(
      `(() => { const v = ${DASHBOARD_STATUS_EXPR}; window.__harnessDashboardBefore = v; return v; })()`,
    );
    if (before === "") return { status: 200, domSignal: "none" };
    // The study's segment filters are `<select>` elements carrying their own
    // `aria-label` ("Filtrar por <dimension>"), not `<label>` wrappers — the
    // same locator `scripts/suite-a-isolation.mjs` already uses.
    //
    // `forgedValue` is the visible-client-state tampering case (Suite B3): a
    // value the server never offered is inserted into the product's own filter
    // control and then selected, exactly as a user with developer tools would.
    // The framework still constructs the request; only the value is hostile.
    const prefix = params.dimension ?? "Filtrar por";
    const driven = await context.evaluate(
      params.forgedValue === undefined
        ? PAGE.changeSelectByAriaLabel(prefix)
        : PAGE.forgeSelectValueByAriaLabel(prefix, String(params.forgedValue)),
    );
    if (driven !== "ok") return { status: 200, domSignal: "none", note: `control-${driven}` };
    // The settled signal is EITHER a refused outcome the product rendered, or a
    // changed live region. StudyCard renders its `{ ok: false }` error in an
    // unmarked panel rather than a `role="alert"` region, so the refusal half
    // must be read through `actionOutcomeKind`, which also consults the app's
    // own fixed error constants.
    const settled = await context
      .waitForDom(
        `() => {
          const v = ${DASHBOARD_STATUS_EXPR};
          const refused = ${PAGE.actionOutcomeKind} !== 'none';
          return refused || (v !== '' && v !== window.__harnessDashboardBefore && !/Actualizando/.test(v));
        }`,
      )
      .catch(() => false);
    if (!settled) return { status: 200, domSignal: "none" };
    const outcome = await context.evaluate(PAGE.actionOutcomeKind);
    return { status: 200, domSignal: outcome === "none" ? "success" : outcome };
  },

  /** `analyzeImportFile` — a real file attached to the real file control. */
  "upload.analyze": async ({ context, PAGE, params }) => {
    const blocked = await selectUploadSource({ context, params });
    if (blocked) return blocked;

    // `dispatch: false` selects the source and then deliberately does NOT
    // click. It is how the pre-dispatch boundary is measured: the product must
    // have refused the source on selection, so the analyze control must be
    // unavailable and no Server Action may have been invoked at all. The note
    // carries that control state as fixed tokens, never rendered text.
    if (params.dispatch === false) {
      const settled = await context
        .waitForDom(`() => ${PAGE.actionOutcomeKind} !== 'none'`, params.settleTimeoutMs)
        .catch(() => false);
      const outcome = settled ? await context.evaluate(PAGE.actionOutcomeKind) : "none";
      const enabled = await context.evaluate(PAGE.controlEnabled("Analizar"));
      return {
        status: 200,
        domSignal: outcome,
        note: `predispatch dispatched=false analyzeEnabled=${enabled}`,
        dispatched: false,
        controlEnabled: enabled,
      };
    }

    const clicked = await context.evaluate(PAGE.clickByName("Analizar"));
    if (clicked !== "ok") return { status: 200, domSignal: "none", note: `analyze-${clicked}` };
    // `settleTimeoutMs` is a wider BOUND, never a retry: a large source is
    // megabytes of body that must be transferred and buffered before the action
    // can answer, and the default 20s bound is about a rendered page.
    const settled = await settleImperative(context, PAGE, UPLOAD_READY, params.settleTimeoutMs);
    return { ...settled, dispatched: true };
  },

  /** `previewImportFile` — the staged validation pass; it writes nothing. */
  "upload.preview": async ({ context, PAGE }) => {
    const clicked = await context.evaluate(PAGE.clickByName("Generar vista previa"));
    if (clicked !== "ok") return { status: 200, domSignal: "none", note: `preview-${clicked}` };
    return settleImperative(context, PAGE, PREVIEW_READY);
  },

  /** `confirmImportFile` — the only upload stage that writes. */
  "upload.confirm": async ({ context, PAGE, params }) => {
    // Step 3's destination control is a bare `<select>` with no label wrapper
    // and no `name`, so it is located by the visible text of the option the
    // user would pick — the study's own name, which carries the run prefix.
    if (params.study_option) {
      const chosen = await context.evaluate(PAGE.selectOptionByTextPrefix(params.study_option));
      if (chosen !== "ok") return { status: 200, domSignal: "none", note: `study-${chosen}` };
    }
    // Tick EXACTLY the product's own confirmation checkbox, located by its own
    // label text. Ticking every checkbox on the page also toggles the mapping
    // controls, and those call `updateMapping`, which clears the preview and
    // unmounts the confirm step — the control then legitimately disappears.
    const boxes = await context.evaluate(PAGE.checkByLabelTextPrefix("Confirmo que"));
    if (boxes !== "ok") return { status: 200, domSignal: "none", note: `confirm-checkbox-${boxes}` };
    // Let React settle before reading the submit control: `canConfirm` is
    // derived at render time, so reading it in the same turn would observe the
    // state as it was before the change.
    const enabled = await context
      .waitForDom(`() => ${PAGE.controlEnabled("Confirmar importación")}`, 5000)
      .catch(() => false);
    const clicked = enabled ? await context.evaluate(PAGE.clickByName("Confirmar importación")) : "disabled";
    if (clicked !== "ok") {
      // The note carries control-state tokens, counts and booleans only —
      // never a rendered message and never product data.
      const state = await context.evaluate(`
        (() => {
          const boxes = [...document.querySelectorAll('input[type=checkbox]')];
          const selects = [...document.querySelectorAll('select')];
          return [
            'checked=' + boxes.filter((b) => b.checked).length + '/' + boxes.length,
            'selects=' + selects.length,
            'selectsWithValue=' + selects.filter((s) => s.value !== '').length,
            'confirmStepPresent=' + /Revisa y confirma/.test(document.body.innerText),
          ].join(' ');
        })()`);
      return { status: 200, domSignal: "none", note: `confirm-${clicked} ${state}` };
    }
    return settleImperative(context, PAGE, CONFIRM_DONE);
  },

  /**
   * `rollbackLatestImport` — takes a bare string, so no form can express it.
   * Its control asks `window.confirm` first; the context answers that dialog
   * exactly as the user who clicked it would (see `dialogsAccepted`).
   */
  "upload.rollback": async ({ context, PAGE }) => {
    const clicked = await context.evaluate(PAGE.clickByName("Revertir último lote"));
    if (clicked !== "ok") return { status: 200, domSignal: "none", note: `rollback-${clicked}` };
    return settleImperative(context, PAGE, ROLLBACK_DONE);
  },
});

/** Static: does this catalogue operation have a reviewed driver? */
export function hasBrowserDriver(operationName) {
  return Object.prototype.hasOwnProperty.call(BROWSER_DRIVERS, operationName);
}

export function browserDriverFor(operationName) {
  const driver = BROWSER_DRIVERS[operationName];
  if (!driver) throw new UnsupportedDriverError(operationName);
  return driver;
}
