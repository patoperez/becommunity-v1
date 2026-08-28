// =============================================================================
// MANDATORY data-completeness gate
//   npx tsx scripts/data-completeness-test.mjs
// =============================================================================
// PostgREST caps every response at `max_rows` — 1000 for this project
// (supabase/config.toml). The cap is applied by the SERVER and it silently
// overrides a larger `.limit()`: a query written `.limit(200_000)` still comes
// back with 1000 rows, HTTP 200, and no error.
//
// A real study exposed the consequence. With 3 282 quantitative answers,
// `loadStudyRows` read the first 1 000 and the product aggregated those:
// `cri` was shown as 27.8 over 9 answers where the study actually holds 28
// answers averaging 33.04. Nothing failed, nothing warned, and every number the
// client would have seen was computed on roughly a third of the people.
//
// This gate holds three lines:
//
//   [1] The pager itself: it pages, it stops on a short page, and it REFUSES
//       (throws) rather than returning a partial set when the data exceeds the
//       caller's declared maximum.
//   [2] loadStudyRows returns EVERY row of a study larger than one page, driven
//       against a stub that enforces the same 1000-row cap the API applies.
//       This is the check that fails on the unfixed loader.
//   [3] No module under src/ reads a table that can exceed one page without
//       either paging it, counting it, or asking for a single row.
//
// Fixtures are synthetic. No client, consultant or production data.
// =============================================================================

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { selectAllPages, API_PAGE_SIZE } from "../src/lib/supabase/paginate.ts";
import { loadStudyRows } from "../src/lib/calc/load.ts";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => {
  console.error("  ✗ FAIL:", m);
  failures += 1;
};
const check = (condition, m) => (condition ? ok(m) : bad(m));

console.log("Be Community — data completeness gate");

// ---- [1] The pager ---------------------------------------------------------
console.log("\n[1] selectAllPages pages, stops and refuses");
{
  const total = 2500;
  const source = Array.from({ length: total }, (_, i) => ({ i }));
  const seen = [];
  const rows = await selectAllPages(
    "stub",
    (from, to) => {
      seen.push([from, to]);
      // Exactly what PostgREST does: never more than the cap, honouring range.
      return Promise.resolve({ data: source.slice(from, Math.min(to + 1, from + API_PAGE_SIZE)), error: null });
    },
    100_000,
  );
  check(rows.length === total, `read every row of a ${total}-row set (got ${rows.length})`);
  check(seen.length === 3, `issued 3 pages for ${total} rows (got ${seen.length})`);
  check(JSON.stringify(rows.map((r) => r.i)) === JSON.stringify(source.map((r) => r.i)), "rows keep their order with no gaps or repeats");

  const short = await selectAllPages("stub", (from) =>
    Promise.resolve({ data: from === 0 ? [{ i: 1 }] : [], error: null }), 10_000);
  check(short.length === 1, "a short first page ends the read immediately");

  let threw = null;
  try {
    await selectAllPages("stub", (from, to) =>
      Promise.resolve({ data: Array.from({ length: to - from + 1 }, () => ({})), error: null }), 2000);
  } catch (e) {
    threw = e;
  }
  check(threw !== null && /exceeds 2000 rows/.test(threw.message),
    `refuses a set larger than the declared maximum instead of truncating (${threw ? "threw" : "returned quietly"})`);

  let propagated = null;
  try {
    await selectAllPages("stub", () => Promise.resolve({ data: null, error: { message: "boom" } }), 10);
  } catch (e) {
    propagated = e;
  }
  check(propagated !== null && /boom/.test(propagated.message), "a page error is propagated, never swallowed");
}

// ---- [2] loadStudyRows over a study larger than one page --------------------
console.log("\n[2] loadStudyRows reads a whole study, not its first page");
{
  const RESPONDENTS = 60;
  const METRICS = 55;
  const responses = [];
  for (let r = 0; r < RESPONDENTS; r++) {
    for (let m = 0; m < METRICS; m++) {
      responses.push({ respondent_id: `r${r}`, metric_key: `m${m}`, value: m + 1 });
    }
  }
  const respondents = Array.from({ length: RESPONDENTS }, (_, r) => ({
    id: `r${r}`,
    segments: { nivel: r % 2 === 0 ? "primaria" : "secundaria" },
  }));
  const total = responses.length;
  check(total > API_PAGE_SIZE, `the fixture is larger than one page (${total} responses)`);

  // A stub that behaves like the Data API: it NEVER returns more than the cap,
  // whether or not the caller asked for a range.
  const table = (rows) => {
    const state = { from: 0, to: API_PAGE_SIZE - 1, ranged: false };
    const builder = {
      select: () => builder,
      eq: () => builder,
      range: (from, to) => {
        state.from = from;
        state.to = to;
        state.ranged = true;
        return builder;
      },
      returns: () => builder,
      then: (resolve) => {
        const size = Math.min(state.to - state.from + 1, API_PAGE_SIZE);
        resolve({ data: rows.slice(state.from, state.from + size), error: null });
      },
    };
    return builder;
  };
  const client = {
    from: (name) => (name === "quant_response" ? table(responses) : table(respondents)),
  };

  const rows = await loadStudyRows(client, "study-1");
  check(rows.length === total, `loadStudyRows returned every response (${rows.length} of ${total})`);
  const distinctRespondents = new Set(rows.map((r) => r.respondent_id)).size;
  check(distinctRespondents === RESPONDENTS, `every respondent is represented (${distinctRespondents} of ${RESPONDENTS})`);
  const m0 = rows.filter((r) => r.metric_key === "m0");
  check(m0.length === RESPONDENTS, `one metric carries all ${RESPONDENTS} answers (got ${m0.length})`);
  const segmented = rows.filter((r) => r.nivel === "primaria" || r.nivel === "secundaria").length;
  check(segmented === total, "every row carries its respondent's segments");
}

// ---- [3] No unpaged read of a table that can outgrow one page ---------------
console.log("\n[3] Every read of a large table is paged, counted or single");
{
  const BIG_TABLES = ["quant_response", "qual_observation", "respondent", "study_period_snapshot"];
  function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }
  const offenders = [];
  for (const file of walk("src")) {
    const source = readFileSync(file, "utf8");
    for (const table of BIG_TABLES) {
      // The window deliberately spans past the statement: a builder can be held
      // in a variable and ranged a few lines later (the qualitative pager does).
      const pattern = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)([\\s\\S]{0,1200})`, "g");
      for (const match of source.matchAll(pattern)) {
        const chain = match[1];
        const counted = /head:\s*true/.test(chain);
        const single = /\.(maybeSingle|single)\b/.test(chain);
        const ranged = /\.range\(/.test(chain);
        // A `.limit()` counts as a complete read only when it is provably at or
        // below the API cap — a larger one is exactly the mistake this looks
        // for. Named constants are resolved from the same file.
        const bounded = [...chain.matchAll(/\.limit\(\s*([A-Za-z_$][\w$]*|\d[\d_]*)\s*\)/g)].some((m) => {
          const token = m[1];
          const literal = /^\d/.test(token)
            ? token
            : source.match(new RegExp(`const\\s+${token}\\s*=\\s*(\\d[\\d_]*)`))?.[1];
          return literal !== undefined && Number(String(literal).replaceAll("_", "")) <= API_PAGE_SIZE;
        });
        const mutation = /\.(insert|update|upsert|delete)\(/.test(chain);
        if (counted || single || ranged || bounded || mutation) continue;
        offenders.push(`${file}: ${table} read is neither paged nor bounded`);
      }
    }
  }
  check(offenders.length === 0, `no unbounded read of ${BIG_TABLES.join(", ")}${offenders.length ? `\n      ${offenders.join("\n      ")}` : ""}`);
}

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s). GATE BLOCKED.`);
  process.exit(1);
}
console.log("RESULT: study reads are complete, not first-page. GATE PASSED.");
