// =============================================================================
// P7 — sanitizing inspector for ORDINARY HTTP route-handler responses (PR 7).
// =============================================================================
// WHY THIS MODULE EXISTS, AND WHY IT IS NOT A HOLE IN THE HARNESS CONTRACT
//
// `docs/P7_HARNESS_DESIGN.md` §2.3 forbids the harness from parsing, decoding,
// snapshotting or classifying a **Server-Action / RSC response body or any
// framework transport payload**. That prohibition exists (R-7g) so the harness
// never couples itself to a PRIVATE, version-coupled serialization.
//
// Suites C1 and C4 must prove something that prohibition does not cover and
// cannot be proven any other way: that the application's own **public** output —
// a generated PDF, a documented JSON validation error — carries no executable
// action, no stack trace, no SQL fragment, no filesystem path, no secret and no
// framework internal. Those are product contracts, not framework transport.
//
// So the read is confined here, under five rules the self-test asserts (G11):
//
//   1. Exactly ONE body read exists in this repository, and it is in this file.
//   2. This module accepts only an ordinary HTTP request it issues itself. It
//      never touches a Server Action, an RSC payload or a browser context.
//   3. The body NEVER leaves this module: it is not returned, not stored, not
//      thrown, not logged. Only booleans, counts, categories and lengths are.
//   4. Callers pass an explicit `expect` describing what they are inspecting,
//      so an inspection is a declared intent rather than a generic body grab.
//   5. A caller-supplied needle is matched but never echoed back: the result
//      says WHETHER it appeared and how often, never what it was.
//
// Everything returned by this file is therefore safe to print by construction,
// exactly like `scripts/lib/secret-patterns.mjs` ("CATEGORY + COUNT only").
// =============================================================================

import { inflateRawSync, inflateSync } from "node:zlib";
import { scanText } from "./secret-patterns.mjs";

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Leak classes an application response must never contain. Each is a CATEGORY:
 * a hit is reported as the category name and a count, never as the matched
 * text, so a report can name the problem without republishing it.
 */
/* <detector-vocabulary> */
const LEAK_CLASSES = Object.freeze([
  ["stack_trace", /\n\s+at\s+[\w$.<>]+\s*\(|\bError:\s.*\n\s+at\s/],
  ["sql_fragment", /\b(select\s+.*\s+from\s+"?public"?\.|insert\s+into\s+"?public"?\.|pg_catalog|information_schema|relation\s+"[a-z_]+"\s+does\s+not\s+exist|permission denied for (table|relation))/i],
  ["postgrest_internals", /"(hint|details)"\s*:\s*"[^"]/],
  ["filesystem_path", /(\/home\/[a-z0-9._-]+\/|\/var\/task\/|[A-Za-z]:\\\\?(Users|dev)\\|\/usr\/src\/app\/|node_modules\/\.pnpm\/)/],
  ["framework_internals", /(\.next\/server\/|webpack-internal:|__webpack_require__|node:internal\/|next\/dist\/(server|compiled)\/)/],
  ["privileged_role_marker", /service_role|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/],
]);

/** Active constructs a PDF must not contain (C1). Names only — never offsets. */
const PDF_ACTIVE_CLASSES = Object.freeze([
  ["javascript", /\/JavaScript\b|\/JS\b/],
  ["open_action", /\/OpenAction\b/],
  ["additional_actions", /\/AA\b/],
  ["launch_action", /\/Launch\b/],
  ["uri_action", /\/URI\b/],
  ["submit_form", /\/SubmitForm\b/],
  ["embedded_file", /\/EmbeddedFile\b|\/Filespec\b/],
  ["rich_media", /\/RichMedia\b|\/Movie\b|\/Sound\b/],
]);

/** Markup that would make an echoed value executable if it were served as HTML. */
const ACTIVE_MARKUP = /<\s*(script|iframe|object|embed|svg)\b|\bon(error|load|click|focus|mouseover)\s*=/i;
/* </detector-vocabulary> */

// ---------------------------------------------------------------------------
// PDF display-text extraction (PR 7 review pass)
// ---------------------------------------------------------------------------
//
// C1.3 has to prove BOTH halves of "the hostile quote reached the report and is
// inert". Without the first half it would pass just as happily on a report the
// quote never reached, which is no proof at all.
//
// pdf-lib writes page content into Flate-compressed streams and encodes shown
// text as hex strings, so a raw byte search finds nothing even when the text is
// plainly on the page. This walks that structure with Node built-ins only — no
// dependency, no parser — and extracts ONLY the operands of the text-showing
// operators. Everything else in the file (names, metadata, object structure) is
// deliberately out of scope, so a marker occurring anywhere other than DISPLAYED
// TEXT cannot be counted.
//
// The extracted text never leaves this module: `countMarkerInPdfText` returns a
// count and a set of category flags, and nothing else.

/** Splits a PDF into its raw `stream … endstream` payloads. */
function pdfStreamSegments(buffer) {
  const segments = [];
  const hay = buffer.toString("latin1");
  let cursor = 0;
  for (;;) {
    const open = hay.indexOf("stream", cursor);
    if (open < 0) break;
    let start = open + "stream".length;
    if (hay[start] === "\r") start += 1;
    if (hay[start] === "\n") start += 1;
    const end = hay.indexOf("endstream", start);
    if (end < 0) break;
    segments.push(buffer.subarray(start, end));
    cursor = end + "endstream".length;
  }
  return segments;
}

/** Inflates a stream when it is compressed; returns null when it cannot. */
function decodeStream(raw) {
  for (const inflate of [inflateSync, inflateRawSync]) {
    try {
      return inflate(raw).toString("latin1");
    } catch {
      /* not this encoding; try the next, then fall through to raw */
    }
  }
  // An uncompressed content stream is already text.
  return raw.toString("latin1");
}

/** Unescapes a PDF literal string body: `\(`, `\)`, `\\`, `\ddd` octal. */
function unescapeLiteral(body) {
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== "\\") { out += ch; continue; }
    const next = body[i + 1];
    if (next === undefined) break;
    if (next >= "0" && next <= "7") {
      let digits = "";
      while (digits.length < 3 && body[i + 1] >= "0" && body[i + 1] <= "7") { digits += body[i + 1]; i += 1; }
      out += String.fromCharCode(parseInt(digits, 8));
      continue;
    }
    const escapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    out += escapes[next] ?? next;
    i += 1;
  }
  return out;
}

/** Decodes a PDF hex string body (`<48656c6c6f>`) to its characters. */
function decodeHexString(body) {
  const hex = body.replace(/[^0-9A-Fa-f]/g, "");
  const even = hex.length % 2 === 0 ? hex : `${hex}0`;
  let out = "";
  for (let i = 0; i < even.length; i += 2) out += String.fromCharCode(parseInt(even.slice(i, i + 2), 16));
  return out;
}

/**
 * The operands of the text-showing operators (`Tj`, `TJ`, `'`, `"`) in one
 * decoded content stream, as an array of displayed strings.
 */
export function extractDisplayedStrings(contentStream) {
  const shown = [];
  // Each match is a string operand immediately followed (allowing an array
  // wrapper and numeric kerning) by a text-showing operator.
  const pattern = /(\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]*>)(?=(?:[^A-Za-z]{0,40})(?:Tj|TJ|'|"))/g;
  let match;
  while ((match = pattern.exec(contentStream)) !== null) {
    const token = match[1];
    shown.push(token[0] === "(" ? unescapeLiteral(token.slice(1, -1)) : decodeHexString(token.slice(1, -1)));
  }
  return shown;
}

/**
 * Counts a marker in a PDF's DISPLAYED TEXT only.
 *
 * Fails closed by construction: a malformed PDF, an undecodable stream or a
 * marker that appears only outside displayed text all yield `count: 0`, and the
 * caller treats that as a failure. The marker itself, the surrounding text and
 * the PDF bytes never cross this boundary — only counts and flags do.
 */
export function countMarkerInPdfText(buffer, marker) {
  const result = {
    count: 0,
    streams: 0,
    decodedStreams: 0,
    displayedStrings: 0,
    /** Present in the raw bytes but NOT in displayed text — never counted. */
    rawOnlyOccurrence: false,
    wellFormed: false,
  };
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !marker) return result;
  const head = buffer.subarray(0, 8).toString("latin1");
  const tail = buffer.subarray(Math.max(0, buffer.length - 64)).toString("latin1");
  result.wellFormed = head.startsWith("%PDF-") && tail.trimEnd().endsWith("%%EOF");
  if (!result.wellFormed) return result;

  const segments = pdfStreamSegments(buffer);
  result.streams = segments.length;
  for (const raw of segments) {
    const decoded = decodeStream(raw);
    if (decoded === null) continue;
    result.decodedStreams += 1;
    const strings = extractDisplayedStrings(decoded);
    result.displayedStrings += strings.length;
    for (const shown of strings) result.count += shown.split(marker).length - 1;
  }
  if (result.count === 0 && buffer.toString("latin1").includes(marker)) result.rawOnlyOccurrence = true;
  return result;
}
export const INSPECTION_KINDS = Object.freeze(["pdf", "json", "text"]);

function classify(text, classes) {
  const hits = [];
  for (const [name, pattern] of classes) if (pattern.test(text)) hits.push(name);
  return hits;
}

/**
 * Counts non-overlapping occurrences of a literal needle. The needle itself is
 * supplied by the caller (its own random fixture marker) and is NEVER returned:
 * only the count crosses the boundary.
 */
function countLiteral(haystack, needle) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/**
 * Issues ONE ordinary HTTP request and returns a sanitized classification.
 *
 * @param {object} options
 * @param {string} options.url        absolute URL of an ordinary route handler
 * @param {string} [options.cookie]   the caller's own Cookie header, used and discarded
 * @param {Record<string,string>} [options.headers]
 * @param {"pdf"|"json"|"text"} options.expect  declared response shape
 * @param {string[]} [options.needles] literal markers to COUNT, never to echo
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} booleans, counts, categories and lengths only
 */
export async function inspectHttpResponse({ url, cookie, headers = {}, expect, needles = [], signal }) {
  if (!INSPECTION_KINDS.includes(expect)) {
    throw new Error(`inspectHttpResponse: "expect" must be one of ${INSPECTION_KINDS.join("/")}`);
  }
  const requestHeaders = { ...headers };
  if (cookie) requestHeaders.cookie = cookie;

  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      headers: requestHeaders,
      redirect: "manual",
      signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
    });
  } catch {
    return {
      transportError: true, status: null, contentType: null, byteLength: 0,
      leakClasses: [], secretClasses: [], needleCounts: [], activeMarkup: false,
      contentTypeClass: "none", nosniff: false, pdf: null, shapeMatchesExpectation: false,
    };
  }

  const contentType = response.headers.get("content-type");
  // The single body read in this repository. `bytes` is a local binding that is
  // never returned, stored beyond this function, logged or thrown.
  const bytes = new Uint8Array(await response.arrayBuffer());
  // `latin1` keeps PDF byte structure intact while still allowing literal
  // matching; a UTF-8 decode would mangle a binary stream.
  const text = Buffer.from(bytes).toString("latin1");

  const isPdf = bytes.length > 4 && text.startsWith("%PDF-");
  const pdf = expect === "pdf" && isPdf
    ? {
        header: true,
        trailer: text.trimEnd().endsWith("%%EOF"),
        activeClasses: classify(text, PDF_ACTIVE_CLASSES),
        objectCount: (text.match(/\bobj\b/g) ?? []).length,
        // Positive control: each needle counted in DISPLAYED TEXT only, so a
        // report the hostile quote never reached cannot pass as "inert".
        displayed: needles.map((needle) => countMarkerInPdfText(Buffer.from(bytes), needle)),
      }
    : null;

  const contentTypeClass = contentType?.includes("application/pdf") ? "pdf"
    : contentType?.includes("application/json") ? "json"
      : contentType?.includes("text/html") ? "html"
        : contentType ? "other" : "none";

  const shapeMatchesExpectation =
    expect === "pdf" ? isPdf && contentTypeClass === "pdf"
      : expect === "json" ? contentTypeClass === "json"
        : true;

  return {
    transportError: false,
    status: response.status,
    contentType,
    byteLength: bytes.length,
    /** Category names only — the matched text never crosses this boundary. */
    leakClasses: classify(text, LEAK_CLASSES),
    /** The repository's existing secret-class scanner, category+count only. */
    secretClasses: scanText(text).map((hit) => hit.id),
    /** Per-needle occurrence counts, positionally aligned with `needles`. */
    needleCounts: needles.map((needle) => countLiteral(text, needle)),
    /**
     * True when the body contains markup that WOULD execute if this response
     * were served as HTML. It is reported together with `contentTypeClass` and
     * `nosniff`, because an echoed value in a JSON error under
     * `X-Content-Type-Options: nosniff` is inert, while the same echo in an
     * HTML document is not. The caller decides; this only observes.
     */
    activeMarkup: ACTIVE_MARKUP.test(text),
    contentTypeClass,
    nosniff: (response.headers.get("x-content-type-options") ?? "").toLowerCase() === "nosniff",
    pdf,
    shapeMatchesExpectation,
  };
}

/** Offline cases so the classifier is proven before any live inspection. */
export const INSPECTOR_CASES = Object.freeze([
  { what: "a Node stack trace", text: 'Error: boom\n    at handler (/app/x.js:1:1)', expect: ["stack_trace"] },
  { what: "a PostgREST hint", text: '{"error":"x","hint":"try again","details":"row 3"}', expect: ["postgrest_internals"] },
  { what: "a SQL relation error", text: 'relation "study" does not exist', expect: ["sql_fragment"] },
  { what: "a build path", text: "at /var/task/.next/server/app/page.js", expect: ["filesystem_path", "framework_internals"] },
  // Built at runtime, never written as a literal: this file is itself scanned
  // for credential markers, exactly as `secret-patterns.mjs` builds its own
  // positive controls at runtime for the same reason.
  { what: "a privileged role marker", text: `role=${["service", "role"].join("_")}`, expect: ["privileged_role_marker"] },
  { what: "an ordinary validation message", text: '{"error":"Filtros invalidos"}', expect: [] },
]);

export function selfTestInspector() {
  const failures = [];
  for (const testCase of INSPECTOR_CASES) {
    const got = classify(testCase.text, LEAK_CLASSES).sort();
    const want = [...testCase.expect].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`${testCase.what}: expected [${want.join(",")}], got [${got.join(",")}]`);
    }
  }
  // The PDF and markup classifiers are proven on the same footing.
  const inertPdf = classify("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF", PDF_ACTIVE_CLASSES);
  if (inertPdf.length) failures.push(`an inert PDF was flagged as ${inertPdf.join(",")}`);
  const activePdf = classify("%PDF-1.7\n<< /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> >>", PDF_ACTIVE_CLASSES).sort();
  if (JSON.stringify(activePdf) !== JSON.stringify(["javascript", "open_action"])) {
    failures.push(`an active PDF classified as [${activePdf.join(",")}]`);
  }
  if (!ACTIVE_MARKUP.test("<img src=x onerror=alert(1)>")) failures.push("active markup went undetected");
  if (ACTIVE_MARKUP.test("Valor no permitido para 'nivel'.")) failures.push("an ordinary message was called active markup");
  if (countLiteral("aXbXc", "X") !== 2) failures.push("literal counting is wrong");
  return failures;
}
