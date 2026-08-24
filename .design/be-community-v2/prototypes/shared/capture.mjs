/**
 * Screenshot harness for the P8 direction-comparison prototypes.
 *
 * WHY THIS EXISTS
 *   Chrome's `--window-size` will not go below roughly 400 px on Windows, so a
 *   `--screenshot` taken with `--window-size=375,…` lays the page out wider than
 *   375 CSS px and then crops the image to 375 — which looks exactly like a
 *   horizontal-overflow bug that is not there. This harness instead drives the
 *   DevTools Protocol and sets the viewport with `Emulation.setDeviceMetricsOverride`,
 *   so 375 means 375, and captures the full scrollable page in one shot.
 *
 * SAFETY
 *   · Isolated, disposable Chrome profile in the OS temp dir — never a real one.
 *   · Ephemeral debugging port (`--remote-debugging-port=0`); the actual port is
 *     read back from the profile's DevToolsActivePort file.
 *   · `--host-resolver-rules` maps every host except 127.0.0.1 to NOTFOUND, so
 *     the pages provably cannot reach the network during capture.
 *   · Zero dependencies: Node's built-in WebSocket only. No npm install, no
 *     package resolution into the repository's node_modules.
 *
 * USAGE
 *   1. python -m http.server 8391 --bind 127.0.0.1   (from the prototypes dir)
 *   2. node .design/be-community-v2/prototypes/shared/capture.mjs
 *
 * Produces exactly 18 PNGs in ../screenshots:
 *   <direction>--<surface>--<viewport>.png
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "..", "screenshots");

const ORIGIN = process.env.P8_ORIGIN || "http://127.0.0.1:8391";
const CHROME = process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const DIRECTIONS = ["informe-vivo", "mesa-de-trabajo", "recorrido"];
const SURFACES = ["entry", "studio", "story"];
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 375, height: 812 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- launch Chrome
const profile = join(tmpdir(), `p8-capture-${Date.now()}`);
mkdirSync(profile, { recursive: true });
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--hide-scrollbars",
  "--blink-settings=preferredColorScheme=1", // force the light palette
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

// ---------------------------------------------------------------- CDP client
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

// --------------------------------------------------------------------- main
const port = await devtoolsPort();
const meta = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const client = cdp(meta.webSocketDebuggerUrl);
await client.ready;

let captured = 0;
const report = [];

for (const direction of DIRECTIONS) {
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

      const url = `${ORIGIN}/${direction}/${surface}.html`;
      await client.send("Page.navigate", { url }, sessionId);
      await sleep(700);

      // Report the real layout width so a crop can never be mistaken for overflow.
      const probe = await client.send("Runtime.evaluate", {
        expression: `JSON.stringify({
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight
        })`,
        returnByValue: true,
      }, sessionId);
      const metrics = JSON.parse(probe.result.value);

      const shot = await client.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        optimizeForSpeed: false,
      }, sessionId);

      const file = join(OUT, `${direction}--${surface}--${name}.png`);
      writeFileSync(file, Buffer.from(shot.data, "base64"));
      await client.send("Target.closeTarget", { targetId });

      captured += 1;
      const overflow = metrics.scroll > metrics.client;
      report.push({ direction, surface, viewport: name, ...metrics, overflow });
      console.log(
        `${overflow ? "OVERFLOW" : "ok      "} ${direction}/${surface} ${name}` +
        ` — laid out at ${metrics.client}px, content ${metrics.scroll}px, height ${metrics.height}px`
      );
    }
  }
}

client.close();
chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }

const overflows = report.filter((r) => r.overflow);
console.log(`\nCaptured ${captured} screenshots into ${OUT}`);
console.log(`Files present: ${readdirSync(OUT).filter((f) => f.endsWith(".png")).length}`);
console.log(overflows.length
  ? `HORIZONTAL OVERFLOW in ${overflows.length} view(s): ` +
    overflows.map((o) => `${o.direction}/${o.surface}/${o.viewport}`).join(", ")
  : "No horizontal overflow in any of the 18 views.");
process.exit(captured === 18 && overflows.length === 0 ? 0 : 1);
