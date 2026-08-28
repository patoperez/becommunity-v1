// =============================================================================
// MANDATORY XLSX hardening gate
//   npx tsx scripts/xlsx-hardening-test.mjs
// =============================================================================
// The ingestion reader parses SpreadsheetML itself (src/lib/ingestion/xlsx-reader.ts)
// because ExcelJS hangs the third request in a Worker. Owning the parser means
// owning its edge cases and its refusals.
//
// TWO KINDS OF CASE.
//
//   STRUCTURE — shapes real exporters actually emit, each of which silently
//   corrupts a study if read wrongly. A dropped blank cell shifts every later
//   column and files an answer under the wrong metric; a mis-scaled date moves
//   a membership start by a day; a namespace prefix makes the whole file
//   unreadable. The workbooks this product ingests are written by ClosedXML and
//   carry `x:` prefixes on every element.
//
//   REFUSAL — a .xlsx declares its expanded size only after you have expanded
//   it. Ten megabytes of upload can claim gigabytes of XML, and this parser runs
//   in a Worker that is killed rather than slowed. Every ceiling must produce a
//   sentence an operator can act on, and must be reached BEFORE any database
//   write: the import commits in one transaction after parsing succeeds, so a
//   refusal here leaves nothing behind.
//
// Every fixture is BUILT HERE. No client workbook is committed to this repo.
// =============================================================================

import { readXlsx, XLSX_LIMITS, XlsxLimitError } from "../src/lib/ingestion/xlsx-reader.ts";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => {
  console.error("  ✗ FAIL:", m);
  failures += 1;
};
const check = (c, m) => (c ? ok(m) : bad(m));

const { default: JSZip } = await import("jszip");
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * Build a workbook. `prefix` reproduces the `x:` element prefixes real
 * exporters emit; `relsFirst` puts Target before Id, which some writers do.
 */
async function build({
  sheet,
  shared = null,
  styles = null,
  prefix = "",
  date1904 = false,
  relsTargetFirst = false,
  absoluteTarget = false,
  omitWorkbook = false,
  omitSheet = false,
} = {}) {
  const zip = new JSZip();
  const p = prefix ? prefix + ":" : "";
  const xmlns = prefix ? ` xmlns:${prefix}="${NS}"` : ` xmlns="${NS}"`;

  if (!omitWorkbook) {
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0"?><${p}workbook${xmlns}${date1904 ? ' date1904="1"' : ""}>` +
        `<${p}sheets><${p}sheet name="Datos" sheetId="1" r:id="rId1" xmlns:r="${REL}"/></${p}sheets>` +
        `</${p}workbook>`,
    );
  }
  const target = absoluteTarget ? "/xl/worksheets/sheet1.xml" : "worksheets/sheet1.xml";
  const relAttrs = relsTargetFirst
    ? `Type="${REL}/worksheet" Target="${target}" Id="rId1"`
    : `Id="rId1" Type="${REL}/worksheet" Target="${target}"`;
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="${REL}/package"><Relationship ${relAttrs}/></Relationships>`,
  );
  if (!omitSheet) {
    zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><${p}worksheet${xmlns}><${p}sheetData>${sheet}</${p}sheetData></${p}worksheet>`);
  }
  if (shared) zip.file("xl/sharedStrings.xml", `<?xml version="1.0"?><${p}sst${xmlns}>${shared}</${p}sst>`);
  if (styles) zip.file("xl/styles.xml", `<?xml version="1.0"?><${p}styleSheet${xmlns}>${styles}</${p}styleSheet>`);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

const row = (n, cells) => `<row r="${n}">${cells}</row>`;
const str = (ref, text) => `<c r="${ref}" t="str"><v>${text}</v></c>`;

async function refusal(promiseFactory) {
  try {
    await promiseFactory();
    return null;
  } catch (error) {
    return error;
  }
}

console.log("Be Community — XLSX hardening gate");

// ---- [1] Namespace prefixes and relationship shapes ------------------------
console.log("\n[1] The shapes real exporters emit are readable");
{
  const sheet = row(1, str("A1", "q_uno") + str("B1", "q_dos")) + row(2, str("A2", "1") + str("B2", "2"));
  const plain = await readXlsx(await build({ sheet }));
  check(plain.headers.join(",") === "q_uno,q_dos", "an unprefixed workbook reads");

  const prefixed = await readXlsx(await build({ sheet, prefix: "x" }));
  check(prefixed.headers.join(",") === "q_uno,q_dos", "an x: prefixed workbook reads (the real files are written this way)");
  check(prefixed.rows.length === 1 && prefixed.rows[0].q_dos === "2", "its values survive the prefix");

  const reordered = await readXlsx(await build({ sheet, prefix: "x", relsTargetFirst: true }));
  check(reordered.headers.length === 2, "a relationship with Target before Id still resolves");

  const absolute = await readXlsx(await build({ sheet, prefix: "x", absoluteTarget: true }));
  check(absolute.headers.length === 2, "an absolute /xl/... relationship target still resolves");
}

// ---- [2] Strings ------------------------------------------------------------
console.log("\n[2] Shared strings, split runs and inline strings");
{
  const shared = "<si><t>q_uno</t></si><si><t>Pri</t><t>mera</t></si>";
  const sheet =
    row(1, `<c r="A1" t="s"><v>0</v></c>`) +
    row(2, `<c r="A2" t="s"><v>1</v></c>`);
  const parsed = await readXlsx(await build({ sheet, shared, prefix: "x" }));
  check(parsed.headers[0] === "q_uno", "a shared-string header resolves");
  check(parsed.rows[0].q_uno === "Primera", "a string split into runs is joined, not truncated");

  const inline = await readXlsx(await build({
    sheet: row(1, `<c r="A1" t="inlineStr"><is><t>q_inline</t></is></c>`) +
      row(2, `<c r="A2" t="inlineStr"><is><t>valor</t></is></c>`),
    prefix: "x",
  }));
  check(inline.headers[0] === "q_inline" && inline.rows[0].q_inline === "valor", "inline strings read");

  const escaped = await readXlsx(await build({
    sheet: row(1, str("A1", "q_x")) + row(2, str("A2", "a &amp; b &lt;c&gt; &#233;")),
    prefix: "x",
  }));
  check(escaped.rows[0].q_x === "a & b <c> é", "XML entities decode, including numeric ones");
}

// ---- [3] Blank cells keep every later column in place ----------------------
console.log("\n[3] A gap is a gap, not a shift");
{
  const parsed = await readXlsx(await build({
    prefix: "x",
    sheet:
      row(1, str("A1", "q_a") + str("B1", "q_b") + str("C1", "q_c")) +
      // B2 is written as a self-closing empty cell between two values.
      row(2, str("A2", "1") + `<c r="B2"/>` + str("C2", "3")),
  }));
  check(parsed.rows[0].q_a === "1", "the first value stays in its column");
  check(parsed.rows[0].q_b === "", "the empty cell stays empty");
  check(parsed.rows[0].q_c === "3", "the value after the gap is NOT pulled left onto the wrong metric");

  const skipped = await readXlsx(await build({
    prefix: "x",
    sheet: row(1, str("A1", "q_a") + str("B1", "q_b") + str("C1", "q_c")) +
      // The exporter omits B entirely rather than writing it empty.
      row(2, str("A2", "1") + str("C2", "3")),
  }));
  check(skipped.rows[0].q_c === "3" && skipped.rows[0].q_b === "", "an omitted cell also leaves later columns in place");
}

// ---- [4] Dates and formulas -------------------------------------------------
console.log("\n[4] Dates are deterministic and formulas use their cached value");
{
  const styles =
    "<numFmts><numFmt numFmtId=\"164\" formatCode=\"dd/mm/yyyy\"/><numFmt numFmtId=\"165\" formatCode=\"&quot;day&quot;#,##0\"/></numFmts>" +
    "<cellXfs><xf numFmtId=\"0\"/><xf numFmtId=\"14\"/><xf numFmtId=\"164\"/><xf numFmtId=\"165\"/></cellXfs>";
  const sheet =
    row(1, str("A1", "q_num") + str("B1", "f_builtin") + str("C1", "f_custom") + str("D1", "f_money")) +
    row(2,
      `<c r="A2" s="0"><v>7</v></c>` +
      `<c r="B2" s="1"><v>45000</v></c>` +
      `<c r="C2" s="2"><v>45000</v></c>` +
      `<c r="D2" s="3"><v>45000</v></c>`);
  const parsed = await readXlsx(await build({ sheet, styles, prefix: "x" }));
  check(parsed.rows[0].q_num === "7", "a plain number stays a number");
  check(parsed.rows[0].f_builtin === "2023-03-15", "a built-in date format becomes an ISO date");
  check(parsed.rows[0].f_custom === "2023-03-15", "a custom dd/mm/yyyy format becomes the same ISO date");
  check(parsed.rows[0].f_money === "45000", "a currency format whose literal contains 'day' is NOT read as a date");

  const shifted = await readXlsx(await build({ sheet, styles, prefix: "x", date1904: true }));
  check(shifted.rows[0].f_builtin === "2027-03-16", "the 1904 date system shifts the same serial correctly");

  const formula = await readXlsx(await build({
    prefix: "x",
    sheet: row(1, str("A1", "q_total")) + row(2, `<c r="A2"><f>SUM(B1:B9)</f><v>42</v></c>`),
  }));
  check(formula.rows[0].q_total === "42", "a formula cell yields its cached result, not its formula");

  const uncached = await readXlsx(await build({
    prefix: "x",
    sheet: row(1, str("A1", "q_total")) + row(2, `<c r="A2"><f>SUM(B1:B9)</f></c>`),
  }));
  check(uncached.rows.length === 0, "a formula with no cached value contributes nothing rather than a wrong number");
}

// ---- [5] Malformed and unsupported workbooks refuse readably ---------------
console.log("\n[5] A file this reader cannot use says so in a sentence");
{
  const notAZip = await refusal(() => readXlsx(new TextEncoder().encode("esto no es un xlsx").buffer));
  check(notAZip instanceof Error, "a non-ZIP input throws an Error rather than crashing the request");
  check(
    Boolean(notAZip) && /no es un \.xlsx válido/.test(notAZip.message),
    "and the message is one an operator can act on",
  );

  const noWorkbook = await refusal(() => readXlsx(build({ sheet: "", omitWorkbook: true })));
  check(noWorkbook instanceof Error, "a workbook part that is missing is refused");

  const missingWorkbook = await refusal(async () => readXlsx(await build({ sheet: "", omitWorkbook: true })));
  check(
    Boolean(missingWorkbook) && /libro legible/.test(missingWorkbook.message),
    "a missing xl/workbook.xml names the problem",
  );

  const missingSheet = await refusal(async () => readXlsx(await build({ sheet: "", omitSheet: true })));
  check(
    Boolean(missingSheet) && /no tiene hojas/.test(missingSheet.message),
    "a relationship pointing at a worksheet that is not there names the problem",
  );

  // Malformed XML must not crash and must not invent data. An unreadable sheet
  // yields nothing, and the adapter above refuses a file with no metric columns.
  const truncated = await readXlsx(await build({
    prefix: "x",
    sheet: `<row r="1"><c r="A1" t="str"><v>q_uno</v></c` ,
  }));
  check(truncated.headers.length === 0 && truncated.rows.length === 0,
    "a truncated sheet yields no headers and no rows rather than partial ones");
}

// ---- [6] Ceilings ----------------------------------------------------------
console.log("\n[6] A hostile or accidental monster is refused before it runs");
{
  const wide =
    row(1, str("A1", "q_a")) +
    // A cell far beyond the column ceiling. Excel itself stops at 16 384.
    row(2, `<c r="ZZZ2" t="str"><v>1</v></c>`);
  const tooWide = await refusal(async () => readXlsx(await build({ sheet: wide, prefix: "x" })));
  check(tooWide instanceof XlsxLimitError, "a cell past the column ceiling is refused");
  check(
    Boolean(tooWide) && tooWide.message.includes("columnas"),
    "the refusal names columns (" + (tooWide ? tooWide.message.slice(0, 48) : "") + "…)",
  );

  const tall = row(1, str("A1", "q_a")) + `<row r="${XLSX_LIMITS.rows + 1}">${str("A" + (XLSX_LIMITS.rows + 1), "1")}</row>`;
  const tooTall = await refusal(async () => readXlsx(await build({ sheet: tall, prefix: "x" })));
  check(tooTall instanceof XlsxLimitError, "a row past the row ceiling is refused");
  check(Boolean(tooTall) && tooTall.message.includes("filas"), "the refusal names rows");

  // A ZIP that declares far more expanded XML than the reader will allocate.
  // The declaration is checked BEFORE decompression, so the isolate is never
  // asked for the memory.
  const padding = "<!--" + "a".repeat(XLSX_LIMITS.partBytes + 1024) + "-->";
  const bomb = await refusal(async () =>
    readXlsx(await build({ prefix: "x", sheet: row(1, str("A1", "q_a")) + padding })),
  );
  check(bomb instanceof XlsxLimitError, "a part that expands past the ceiling is refused");
  check(
    Boolean(bomb) && /demasiado grande al descomprimirse/.test(bomb.message),
    "the refusal explains that the problem is the expanded size",
  );

  // Nothing above reached a database: readXlsx is pure, and the import commits
  // in one transaction only after parsing returns.
  const reader = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/ingestion/xlsx-reader.ts", "utf8"),
  );
  check(
    !/supabase|createClient|insert\(|rpc\(/i.test(reader),
    "the reader touches no database, so a refusal cannot leave a partial write",
  );
}

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error("RESULT: " + failures + " failure(s). GATE BLOCKED.");
  process.exit(1);
}
console.log("RESULT: the reader handles what exporters emit and refuses what it cannot. GATE PASSED.");
