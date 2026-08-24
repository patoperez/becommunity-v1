/**
 * Screenshot harness for the provisional synthesis — SIX captures only.
 *
 * Identical technique to ../shared/capture.mjs: DevTools Protocol,
 * `Emulation.setDeviceMetricsOverride` for an exact viewport (Chrome's
 * --window-size will not honour anything below ~400px on Windows and silently
 * crops instead), full-page capture, and a clientWidth/scrollWidth report so
 * horizontal overflow is measured rather than judged.
 *
 * It lives here rather than extending ../shared/capture.mjs because this pass
 * may only write inside this folder and a small allow-list; the shared harness
 * is not in that list. The two should be consolidated into one parameterised
 * harness in a later pass — noted in ../README.md.
 *
 * SAFETY: isolated disposable profile in the OS temp dir, ephemeral debugging
 * port (`--remote-debugging-port=0`, read back from DevToolsActivePort), and
 * `--host-resolver-rules` so the page provably cannot reach the network.
 * Zero dependencies — Node's built-in WebSocket only.
 *
 * USAGE (with the loopback server already running):
 *   node .design/be-community-v2/prototypes/selected-informe-vivo-guiado/capture-selected.mjs
 *
 * Writes ../screenshots/selected--<surface>--<viewport>.png
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "..", "screenshots");

const ORIGIN = process.env.P8_ORIGIN || "http://127.0.0.1:8391";
const CHROME = process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const DIRECTORY = "selected-informe-vivo-guiado";
const LABEL = "selected";                       // the required filename prefix
const SURFACES = ["entry", "studio", "story"];
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 375, height: 812 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = join(tmpdir(), `p8-selected-${Date.now()}`);
mkdirSync(profile, { recursive: true });
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--hide-scrollbars",
  "--blink-settings=preferredColorScheme=1",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

async function devtoolsPort() {
  const file = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(file)) {
      const [port] = readFileSync(file, "utf8").split("\n");
      if (port && port.trim()) return Number(port.trim());
    }
    await sleep(100);
  }
  throw new Error("Chrome never reported a DevTools port");
}

function cdp(url) {
  const ws = new WebSocket(url);
  let next = 1;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", (e) => rej(e));
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject: no } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? no(new Error(JSON.stringify(msg.error))) : ok(msg.result);
    }
  });
  return {
    ready,
    send(method, params = {}, sessionId) {
      const id = next++;
      return new Promise((ok, no) => {
        pending.set(id, { resolve: ok, reject: no });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close: () => ws.close(),
  };
}

const port = await devtoolsPort();
const meta = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const client = cdp(meta.webSocketDebuggerUrl);
await client.ready;

let captured = 0;
const report = [];

for (const surface of SURFACES) {
  for (const [name, size] of Object.entries(VIEWPORTS)) {
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });

    await client.send("Page.enable", {}, sessionId);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: size.width,
      height: size.height,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);

    await client.send("Page.navigate", { url: `${ORIGIN}/${DIRECTORY}/${surface}.html` }, sessionId);
    await sleep(800); // let the narrow-screen collapse script settle

    const probe = await client.send("Runtime.evaluate", {
      expression: `JSON.stringify({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        openDetails: document.querySelectorAll('details[open]').length,
        totalDetails: document.querySelectorAll('details').length
      })`,
      returnByValue: true,
    }, sessionId);
    const m = JSON.parse(probe.result.value);

    const shot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      optimizeForSpeed: false,
    }, sessionId);

    writeFileSync(join(OUT, `${LABEL}--${surface}--${name}.png`), Buffer.from(shot.data, "base64"));
    await client.send("Target.closeTarget", { targetId });

    captured += 1;
    const overflow = m.scroll > m.client;
    report.push({ surface, viewport: name, ...m, overflow });
    console.log(
      `${overflow ? "OVERFLOW" : "ok      "} ${LABEL}/${surface} ${name}` +
      ` — laid out at ${m.client}px, content ${m.scroll}px, height ${m.height}px` +
      ` (${m.openDetails}/${m.totalDetails} disclosures open)`
    );
  }
}

client.close();
chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }

const overflows = report.filter((r) => r.overflow);
console.log(`\nCaptured ${captured} screenshots into ${OUT}`);
console.log(overflows.length
  ? `HORIZONTAL OVERFLOW in ${overflows.length} view(s): ` +
    overflows.map((o) => `${o.surface}/${o.viewport}`).join(", ")
  : "No horizontal overflow in either viewport.");
process.exit(captured === 6 && overflows.length === 0 ? 0 : 1);
