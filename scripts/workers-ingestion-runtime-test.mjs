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
//   [4] No module under src/ may resolve exceljs AT ALL — not even lazily.
//       The lazy `await import()` was the earlier fix; it is no longer enough.
//       Under workerd, ExcelJS's `xlsx.load` poisons the isolate: the first two
//       requests that reach it succeed and the THIRD never settles, so the
//       runtime cancels the request and answers HTTP 500. An operator saw that
//       as "confirmar" failing after analyze and preview had both worked, with
//       nothing written. XLSX is now read by src/lib/ingestion/xlsx-reader.ts.
//   [5] A real, prefixed-namespace XLSX round trips through the production
//       parseFile() FIVE times, asserting values, blank-cell alignment and a
//       stable ISO date — one round trip could not have caught the defect.
//
// Verified against real workerd (wrangler dev, nodejs_compat) while this gate
// was written: `exceljs/excel.js` throws the umask error there; ExcelJS's
// browser bundle loads but hangs from the third request onward, while a
// JSZip-only round trip over the same bytes succeeds on every request.
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

// ---- [4] ExcelJS must not be reachable from production source at all --------
// It used to be loaded lazily inside the XLSX branch. That is no longer allowed
// EITHER: under workerd, ExcelJS's `xlsx.load` poisons the isolate — the first
// two requests that call it succeed and the third never settles, so the runtime
// cancels the request and answers HTTP 500. XLSX is now read by
// src/lib/ingestion/xlsx-reader.ts (JSZip + string parsing), which was verified
// safe across requests on real workerd. ExcelJS remains a DEV dependency: the
// ingestion tests use it to AUTHOR fixture workbooks, which keeps the reader
// honest by reading bytes a different library wrote.
console.log("\n[4] ExcelJS is unreachable from src/, statically or lazily");
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const srcFiles = walk("src").filter((f) => !f.endsWith(".d.ts"));
// The MODULE SPECIFIER is what matters: prose naming the library in a comment
// is documentation, but a quoted "exceljs..." specifier is a real dependency.
const EXCELJS_SPECIFIER = /['"]exceljs[^'"]*['"]/;
const offenders = srcFiles.filter((f) => EXCELJS_SPECIFIER.test(readFileSync(f, "utf8")));
check(offenders.length === 0,
  `scanned ${srcFiles.length} files under src/ — no module resolves ExcelJS${offenders.length ? `: ${offenders.join(", ")}` : ""}`);

const parseSource = readFileSync("src/lib/ingestion/parse.ts", "utf8");
check(/from\s+['"]\.\/xlsx-reader['"]/.test(parseSource),
  "parse.ts reads XLSX through the project's own reader");

const readerSource = readFileSync("src/lib/ingestion/xlsx-reader.ts", "utf8");
check(!EXCELJS_SPECIFIER.test(readerSource), "the reader itself resolves no ExcelJS module");
check(/await import\(\s*['"]jszip['"]\s*\)/.test(readerSource),
  "the reader loads JSZip lazily, the only library it needs");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
check(!("exceljs" in (pkg.dependencies ?? {})),
  "exceljs is not a production dependency");
check("exceljs" in (pkg.devDependencies ?? {}),
  "exceljs stays a dev dependency so fixtures are authored by a different library");

// ---- [5] A real XLSX through the real parser, under the same runtime --------
// The reader must survive being called many times: the defect it replaces only
// appeared from the third call onwards, so a single round trip proves nothing.
console.log("\n[5] Real XLSX round trips through parseFile(), repeatedly");
if (parse) {
  const { default: JSZipLib } = await import("jszip");
  // A workbook written the way the real-world source files are written: the
  // `x:` namespace prefix, inline strings, an explicitly EMPTY cell in the
  // middle of the row, and a date-formatted cell.
  const sheet =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' +
    '<x:row r="1">' +
    '<x:c r="A1" t="str"><x:v>seg_nivel</x:v></x:c>' +
    '<x:c r="B1" t="str"><x:v>q_uno</x:v></x:c>' +
    '<x:c r="C1" t="str"><x:v>q_dos</x:v></x:c>' +
    '<x:c r="D1" t="str"><x:v>priv_fecha</x:v></x:c>' +
    "</x:row>" +
    '<x:row r="2">' +
    '<x:c r="A2" t="str"><x:v>primaria</x:v></x:c>' +
    '<x:c r="B2" s="1" />' +
    '<x:c r="C2" t="n"><x:v>7</x:v></x:c>' +
    '<x:c r="D2" s="2" t="n"><x:v>45992</x:v></x:c>' +
    "</x:row>" +
    "</x:sheetData></x:worksheet>";
  const zip = new JSZipLib();
  zip.file("xl/workbook.xml",
    '<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<x:sheets><x:sheet name="Datos" sheetId="1" r:id="R1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:sheets></x:workbook>');
  zip.file("xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="R1" /></Relationships>');
  zip.file("xl/worksheets/sheet1.xml", sheet);
  zip.file("xl/styles.xml",
    '<?xml version="1.0" encoding="utf-8"?><x:styleSheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<x:cellXfs count="3"><x:xf numFmtId="0" /><x:xf numFmtId="0" /><x:xf numFmtId="14" /></x:cellXfs></x:styleSheet>');
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  for (let attempt = 1; attempt <= 5; attempt++) {
    let out = null;
    try {
      out = await parse.parseFile("prefixed.xlsx", buffer.slice(0));
    } catch (e) {
      bad(`parseFile threw on attempt ${attempt}: ${e.message}`);
      break;
    }
    if (attempt === 1) {
      check(JSON.stringify(out.headers) === JSON.stringify(["seg_nivel", "q_uno", "q_dos", "priv_fecha"]),
        `prefixed-namespace headers read (got ${out.headers.join(",")})`);
      check(out.rows.length === 1, `one data row (got ${out.rows.length})`);
      check(out.rows[0]?.seg_nivel === "primaria", "string cell read");
      check(out.rows[0]?.q_uno === "", "an explicitly empty cell stays empty");
      check(out.rows[0]?.q_dos === "7",
        `the value AFTER the empty cell keeps its own column (got ${JSON.stringify(out.rows[0]?.q_dos)})`);
      check(out.rows[0]?.priv_fecha === "2025-12-01",
        `a date-formatted cell renders as a stable ISO date (got ${JSON.stringify(out.rows[0]?.priv_fecha)})`);
    }
    if (attempt === 5) ok("five consecutive parses all succeeded");
  }
}

// Restore the real runtime facts.
Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
process.umask = realUmask;

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s). GATE BLOCKED.`);
  process.exit(1);
}
console.log("RESULT: ingestion reads CSV and XLSX with the Node-only ExcelJS graph fatal. GATE PASSED.");
