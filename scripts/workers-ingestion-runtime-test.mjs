// =============================================================================
// MANDATORY Workers ingestion-runtime gate
//   npx tsx scripts/workers-ingestion-runtime-test.mjs
// =============================================================================
// ExcelJS's Node entry pulls in unzipper -> fstream, and fstream/lib/writer.js
// evaluates `process.umask()` at MODULE LOAD time:
//
//     var umask = process.platform === 'win32' ? 0 : process.umask()
//
// On Cloudflare Workers `process.platform` is "linux" and unenv's `process.umask`
// throws, so a STATIC `import ExcelJS from "exceljs"` in the ingestion parser
// made the whole ingestion Server Action module impossible to evaluate — CSV
// uploads included, and even with no file attached. Production returned HTTP 500
// with `[unenv] process.umask is not implemented yet!`.
//
// This gate reproduces that runtime faithfully and proves the fix holds:
//
//   [1] Simulation fidelity — the two facts that matter on workerd are forced
//       here (platform "linux", throwing process.umask), and a POSITIVE CONTROL
//       asserts the simulation really is fatal for the offending graph.
//   [2] The production ingestion parser IMPORTS cleanly under that runtime.
//   [3] A synthetic, data-bearing CSV parses through the REAL production
//       parseFile(), with headers, row count and cell values asserted.
//   [4] No module under src/ may STATICALLY import exceljs; the lazy
//       `await import(...)` inside the XLSX branch is what keeps CSV alive.
//
// Verified against real workerd (wrangler dev, nodejs_compat) while this gate
// was written: `exceljs/excel.js` throws the umask error there, while
// `exceljs/dist/exceljs.min.js` loads and parses a real .xlsx.
//
// Fixtures are synthetic. No client, consultant or production data.
// =============================================================================

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function ok(message) {
  console.log("  ✓", message);
}
function bad(message) {
  console.error("  ✗ FAIL:", message);
  failures += 1;
}
function check(condition, message) {
  if (condition) {
    ok(message);
  } else {
    bad(message);
  }
}

console.log("Be Community — Workers ingestion runtime gate");

// ---- [1] Force the Workers-runtime facts, then prove the simulation bites ----
const realPlatform = process.platform;
const realUmask = process.umask;
Object.defineProperty(process, "platform", { value: "linux", configurable: true });
process.umask = () => {
  throw new Error("[unenv] process.umask is not implemented yet!");
};

console.log("\n[1] Simulation fidelity (workerd: platform=linux, process.umask throws)");
check(process.platform === "linux", `process.platform forced to "linux" (was "${realPlatform}")`);
let umaskThrew = false;
try {
  process.umask();
} catch (e) {
  umaskThrew = /process\.umask is not implemented/.test(e.message);
}
check(umaskThrew, "process.umask() throws the unenv error");

// ---- [2] The production parser must import under that runtime ---------------
// Deliberately FIRST: a control import that throws would otherwise poison the
// module registry and mask a genuine static-import regression here.
console.log("\n[2] Production ingestion parser imports with the Node-only graph fatal");
let parse = null;
let importError = null;
try {
  parse = await import("../src/lib/ingestion/parse.ts");
} catch (e) {
  importError = e;
}
if (importError) {
  bad(`importing src/lib/ingestion/parse.ts threw: ${importError.message}`);
} else {
  ok("src/lib/ingestion/parse.ts evaluated successfully");
  check(typeof parse.parseFile === "function", "parseFile is exported");
  check(typeof parse.parseCsv === "function", "parseCsv is exported");
  check(typeof parse.XLSX_UNAVAILABLE_MESSAGE === "string" && parse.XLSX_UNAVAILABLE_MESSAGE.length > 0,
    "a user-facing Spanish message exists for an unavailable XLSX reader");
}

// ---- [3] A data-bearing synthetic CSV through the real production parser -----
console.log("\n[3] Synthetic data-bearing CSV through the real parseFile()");
const CSV = [
  "seg_genero,seg_nivel,q_nps,q_sat_general",
  "F,primaria,10,9",
  "F,secundaria,8,8",
  "M,primaria,6,7",
  "M,secundaria,9,10",
  "M,secundaria,5,6",
].join("\n") + "\n";
const EXPECTED_HEADERS = ["seg_genero", "seg_nivel", "q_nps", "q_sat_general"];

if (parse) {
  let parsed = null;
  try {
    parsed = await parse.parseFile("acceptance-gate.csv", new TextEncoder().encode(CSV).buffer);
  } catch (e) {
    bad(`parseFile threw on a valid CSV: ${e.message}`);
  }
  if (parsed) {
    check(JSON.stringify(parsed.headers) === JSON.stringify(EXPECTED_HEADERS),
      `headers = ${EXPECTED_HEADERS.join(",")} (got ${parsed.headers.join(",")})`);
    check(parsed.rows.length === 5, `row count = 5 (got ${parsed.rows.length})`);
    check(parsed.rows[0]?.seg_genero === "F" && parsed.rows[0]?.q_nps === "10",
      "first row carries real values (seg_genero=F, q_nps=10)");
    check(parsed.rows[4]?.seg_nivel === "secundaria" && parsed.rows[4]?.q_sat_general === "6",
      "last row carries real values (seg_nivel=secundaria, q_sat_general=6)");
    const allPopulated = parsed.rows.every((r) => EXPECTED_HEADERS.every((h) => typeof r[h] === "string" && r[h] !== ""));
    check(allPopulated, "every cell of every row is populated (the gate is not passing on empty output)");
  }
}

// POSITIVE CONTROL — the offending graph must actually be fatal under this
// simulation. Without this, a green gate could mean nothing at all.
let fstreamError = null;
try {
  await import("fstream");
} catch (e) {
  fstreamError = e;
}
check(
  fstreamError !== null && /process\.umask is not implemented/.test(fstreamError.message),
  `positive control: importing "fstream" is fatal here (${fstreamError ? fstreamError.message.slice(0, 60) : "it loaded — simulation is vacuous"})`,
);

let nodeEntryError = null;
try {
  await import("exceljs/excel.js");
} catch (e) {
  nodeEntryError = e;
}
check(
  nodeEntryError !== null && /process\.umask is not implemented/.test(nodeEntryError.message),
  `positive control: ExcelJS Node entry "exceljs/excel.js" is fatal here (${nodeEntryError ? "throws" : "loaded — regression would be missed"})`,
);

// ---- [4] ExcelJS must never become a static import in production source -----
console.log("\n[4] No module under src/ statically imports ExcelJS");
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
// Matches `import ... from "exceljs..."` and `require("exceljs...")`, but NOT
// `await import("exceljs...")`, which is the whole point of the fix.
const STATIC_IMPORT = /(^|\n)\s*import\s[^;]*?from\s*['"]exceljs[^'"]*['"]|(^|[^.\w])require\(\s*['"]exceljs[^'"]*['"]\s*\)/;
const srcFiles = walk("src").filter((f) => !f.endsWith(".d.ts"));
const offenders = srcFiles.filter((f) => STATIC_IMPORT.test(readFileSync(f, "utf8")));
check(offenders.length === 0,
  `scanned ${srcFiles.length} files under src/ — zero static ExcelJS imports${offenders.length ? `: ${offenders.join(", ")}` : ""}`);

// The parser must still reach ExcelJS lazily, or XLSX support is silently gone.
const parseSource = readFileSync("src/lib/ingestion/parse.ts", "utf8");
check(/await\s+import\(\s*['"]exceljs[^'"]*['"]\s*\)/.test(parseSource),
  "parse.ts still loads ExcelJS lazily inside the XLSX branch");

// Restore the real runtime facts.
Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
process.umask = realUmask;

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s). GATE BLOCKED.`);
  process.exit(1);
}
console.log("RESULT: ingestion parses CSV with the Node-only ExcelJS graph fatal. GATE PASSED.");
