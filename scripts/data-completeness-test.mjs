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
// Paging by OFFSET fixed the count and left a quieter version of the same bug.
// `.range(1000, 1999)` asks for "rows 1000-1999" of a set whose order SQL never
// promised, so two requests may disagree about which rows those are — one row
// read twice, another never read. This gate now holds five lines:
//
//   [1] The pager itself: it pages, it stops on a short page, it REFUSES rather
//       than returning a partial set, and it rejects a page that is not in
//       keyset order instead of trusting it.
//   [2] loadStudyRows returns EVERY row of a study larger than one page, driven
//       against a stub that enforces the same 1000-row cap the API applies.
//   [3] No module under src/ reads a table that can exceed one page without
//       either paging it, counting it, or asking for a single row.
//   [4] Adversarial concurrency: rows inserted, deleted and updated between
//       pages, and an error on an intermediate page.
//   [5] Every page of a scoped read still carries its tenant/study scope.
//
// Fixtures are synthetic. No client, consultant or production data.
// =============================================================================

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { selectAllPages, keysetWindow, API_PAGE_SIZE } from "../src/lib/supabase/paginate.ts";
import { loadStudyRows } from "../src/lib/calc/load.ts";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => {
  console.error("  ✗ FAIL:", m);
  failures += 1;
};
const check = (condition, m) => (condition ? ok(m) : bad(m));

/** Zero-padded synthetic key: SQL and JavaScript order it identically, like a uuid. */
const key = (n) => "k" + String(n).padStart(8, "0");

/**
 * A stub that behaves like PostgREST for the operations the pager uses.
 *
 * It is deliberately hostile in one way: when the caller does NOT apply an
 * order, it returns rows in a different arbitrary order than the stored one —
 * which is precisely what an unordered SQL query is allowed to do, and what
 * makes offset paging unsound.
 */
function fakeTable(store, options = {}) {
  const { onPage } = options;
  let requests = 0;
  const make = () => {
    const state = { cursor: null, ordered: false, size: API_PAGE_SIZE, scope: [] };
    const builder = {
      select: () => builder,
      eq: (column, value) => {
        state.scope.push(column + "=" + value);
        return builder;
      },
      in: (column, values) => {
        state.scope.push(column + " in " + values.join("|"));
        return builder;
      },
      gt: (_column, value) => {
        state.cursor = value;
        return builder;
      },
      order: () => {
        state.ordered = true;
        return builder;
      },
      limit: (n) => {
        state.size = n;
        return builder;
      },
      returns: () => builder,
      then: (resolve) => {
        const index = requests;
        requests += 1;
        const hook = onPage ? onPage({ index, cursor: state.cursor, scope: state.scope }) : null;
        if (hook && hook.error) {
          resolve({ data: null, error: hook.error });
          return;
        }
        let rows = store.rows.filter((row) => state.cursor === null || row.id > state.cursor);
        rows = state.ordered
          ? [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          : [...rows].reverse();
        resolve({ data: rows.slice(0, Math.min(state.size, API_PAGE_SIZE)), error: null });
      },
    };
    return builder;
  };
  return {
    make,
    get requests() {
      return requests;
    },
  };
}

/** The canonical shape of a paged read, exactly as production code writes it. */
const readAll = (label, table, maxRows) =>
  selectAllPages(
    label,
    (cursor, size) => keysetWindow(table.make(), { column: "id", cursor, size }),
    { maxRows, cursorOf: (row) => row.id },
  );

console.log("Be Community — data completeness gate");

// ---- [1] The pager ---------------------------------------------------------
console.log("\n[1] selectAllPages pages, stops, refuses and checks its order");
{
  const total = 2500;
  const store = { rows: Array.from({ length: total }, (_, i) => ({ id: key(i), i })) };
  const table = fakeTable(store);
  const rows = await readAll("stub", table, 100_000);
  check(rows.length === total, "read every row of a " + total + "-row set (got " + rows.length + ")");
  check(table.requests === 3, "issued 3 pages for " + total + " rows (got " + table.requests + ")");
  check(new Set(rows.map((r) => r.id)).size === total, "no row was returned twice");
  check(
    JSON.stringify(rows.map((r) => r.i)) === JSON.stringify(store.rows.map((r) => r.i)),
    "rows keep their key order with no gaps or repeats",
  );

  const short = await readAll("stub", fakeTable({ rows: [{ id: key(1), i: 1 }] }), 10_000);
  check(short.length === 1, "a short first page ends the read immediately");

  let threw = null;
  try {
    const big = { rows: Array.from({ length: 3000 }, (_, i) => ({ id: key(i) })) };
    await readAll("stub", fakeTable(big), 2000);
  } catch (e) {
    threw = e;
  }
  check(
    threw !== null && /exceeds 2000 rows/.test(threw.message),
    "refuses a set larger than the declared maximum instead of truncating (" +
      (threw ? "threw" : "returned quietly") + ")",
  );

  let propagated = null;
  try {
    await selectAllPages("stub", () => Promise.resolve({ data: null, error: { message: "boom" } }), {
      maxRows: 10,
      cursorOf: (row) => row.id,
    });
  } catch (e) {
    propagated = e;
  }
  check(propagated !== null && /boom/.test(propagated.message), "a page error is propagated, never swallowed");
}

// ---- [1b] An unordered or non-unique page is rejected, not trusted ----------
console.log("\n[1b] A page that is not in keyset order fails loudly");
{
  const store = { rows: Array.from({ length: 2500 }, (_, i) => ({ id: key(i) })) };
  const table = fakeTable(store);
  let threw = null;
  try {
    // The caller forgot the order. The stub answers in a legal-but-arbitrary
    // order, and the pager must refuse rather than derive a meaningless cursor.
    await selectAllPages(
      "unordered",
      (cursor, size) => {
        const q = table.make();
        return (cursor === null ? q : q.gt("id", cursor)).limit(size);
      },
      { maxRows: 100_000, cursorOf: (row) => row.id },
    );
  } catch (e) {
    threw = e;
  }
  check(
    threw !== null && /key order/.test(threw.message),
    "an unordered read is refused, not silently truncated (" + (threw ? "threw" : "returned quietly") + ")",
  );

  // A non-unique sort column: two rows share a cursor value. Paging on it can
  // straddle the page boundary, so it must be rejected too.
  let duplicate = null;
  try {
    await selectAllPages(
      "non-unique",
      () => Promise.resolve({ data: [{ id: key(1) }, { id: key(1) }], error: null }),
      { maxRows: 10, cursorOf: (row) => row.id },
    );
  } catch (e) {
    duplicate = e;
  }
  check(
    duplicate !== null && /key order/.test(duplicate.message),
    "a repeated cursor value is refused (" + (duplicate ? "threw" : "returned quietly") + ")",
  );

  let missing = null;
  try {
    await selectAllPages("no-cursor", () => Promise.resolve({ data: [{ id: "" }], error: null }), {
      maxRows: 10,
      cursorOf: (row) => row.id,
    });
  } catch (e) {
    missing = e;
  }
  check(missing !== null && /usable keyset cursor/.test(missing.message), "a row without a cursor value is refused");
}

// ---- [2] loadStudyRows over a study larger than one page --------------------
console.log("\n[2] loadStudyRows reads a whole study, not its first page");
{
  const RESPONDENTS = 60;
  const METRICS = 55;
  const respondents = Array.from({ length: RESPONDENTS }, (_, r) => ({
    id: key(r),
    segments: { nivel: r % 2 === 0 ? "primaria" : "secundaria" },
  }));
  const responses = [];
  let n = 0;
  for (let r = 0; r < RESPONDENTS; r++) {
    for (let m = 0; m < METRICS; m++) {
      responses.push({
        id: "q" + String(n++).padStart(8, "0"),
        respondent_id: respondents[r].id,
        metric_key: "m" + m,
        value: m + 1,
      });
    }
  }
  const total = responses.length;
  check(total > API_PAGE_SIZE, "the fixture is larger than one page (" + total + " responses)");

  const responseTable = fakeTable({ rows: responses });
  const respondentTable = fakeTable({ rows: respondents });
  const client = {
    from: (name) => (name === "quant_response" ? responseTable.make() : respondentTable.make()),
  };

  const rows = await loadStudyRows(client, "study-1");
  check(rows.length === total, "loadStudyRows returned every response (" + rows.length + " of " + total + ")");
  const distinctRespondents = new Set(rows.map((r) => r.respondent_id)).size;
  check(
    distinctRespondents === RESPONDENTS,
    "every respondent is represented (" + distinctRespondents + " of " + RESPONDENTS + ")",
  );
  const m0 = rows.filter((r) => r.metric_key === "m0");
  check(m0.length === RESPONDENTS, "one metric carries all " + RESPONDENTS + " answers (got " + m0.length + ")");
  const segmented = rows.filter((r) => r.nivel === "primaria" || r.nivel === "secundaria").length;
  check(segmented === total, "every row carries its respondent's segments");
}

// ---- [3] No unpaged read of a table that can outgrow one page ---------------
console.log("\n[3] Every read of a large table is paged, counted or single");
{
  const BIG_TABLES = ["quant_response", "qual_observation", "respondent", "study_period_snapshot"];
  const QUOTES = ['"', "'", String.fromCharCode(96)];
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
    // Named row ceilings declared in this file, for resolving a named .limit().
    const constants = new Map();
    for (const m of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d[\d_]*)/g)) {
      constants.set(m[1], Number(m[2].replaceAll("_", "")));
    }
    for (const table of BIG_TABLES) {
      for (const quote of QUOTES) {
        const needle = ".from(" + quote + table + quote + ")";
        let at = source.indexOf(needle);
        while (at !== -1) {
          // The window deliberately spans past the statement: a builder can be
          // held in a variable and ranged a few lines later.
          const chain = source.slice(at + needle.length, at + needle.length + 1200);
          const before = source.slice(Math.max(0, at - 400), at);
          const counted = /head:\s*true/.test(chain);
          const single = /\.(maybeSingle|single)\b/.test(chain);
          const ranged = /\.range\(/.test(chain);
          const mutation = /\.(insert|update|upsert|delete)\(/.test(chain);
          // A keyset read is complete BY CONSTRUCTION: keysetWindow applies the
          // order and the page size, and selectAllPages proves the order held.
          const keyset = before.includes("keysetWindow(") || chain.includes("keysetWindow(");
          // A .limit() counts as a complete read only when it is provably at or
          // below the API cap — a larger one is exactly the mistake this looks
          // for.
          const bounded = [...chain.matchAll(/\.limit\(\s*([A-Za-z_$][\w$]*|\d[\d_]*)\s*\)/g)].some((m) => {
            const token = m[1];
            const value = /^\d/.test(token) ? Number(token.replaceAll("_", "")) : constants.get(token);
            return value !== undefined && value <= API_PAGE_SIZE;
          });
          if (!(counted || single || ranged || bounded || mutation || keyset)) {
            offenders.push(file + ": " + table + " read is neither paged nor bounded");
          }
          at = source.indexOf(needle, at + 1);
        }
      }
    }
  }
  check(
    offenders.length === 0,
    "no unbounded read of " + BIG_TABLES.join(", ") +
      (offenders.length ? "\n      " + offenders.join("\n      ") : ""),
  );
}

// ---- [4] Adversarial concurrency -------------------------------------------
console.log("\n[4] Rows written between pages cannot corrupt the rows that were read");
{
  // INSERT between pages, AFTER the cursor: the new row is included, and no
  // existing row is duplicated or lost.
  {
    const store = { rows: Array.from({ length: 2200 }, (_, i) => ({ id: key(i * 10) })) };
    const table = fakeTable(store, {
      onPage: ({ index }) => {
        if (index === 0) store.rows.push({ id: key(999_999) });
        return null;
      },
    });
    const rows = await readAll("insert", table, 100_000);
    const ids = rows.map((r) => r.id);
    check(new Set(ids).size === ids.length, "an insert between pages produces no duplicate");
    check(ids.includes(key(999_999)), "a row inserted after the cursor is included");
    check(rows.length === 2201, "every pre-existing row was still read (" + rows.length + " of 2201)");
  }

  // INSERT between pages, BEFORE the cursor: it is simply not seen. That is
  // inherent to reading without a snapshot and must not corrupt anything.
  {
    const store = { rows: Array.from({ length: 2200 }, (_, i) => ({ id: key(i * 10 + 5) })) };
    const table = fakeTable(store, {
      onPage: ({ index }) => {
        if (index === 1) store.rows.push({ id: key(1) });
        return null;
      },
    });
    const rows = await readAll("insert-behind", table, 100_000);
    check(rows.length === 2200, "a row inserted behind the cursor is absent, not duplicated (" + rows.length + ")");
    check(new Set(rows.map((r) => r.id)).size === rows.length, "still no duplicates");
  }

  // DELETE between pages: the deleted row is absent; every surviving row is read.
  {
    const store = { rows: Array.from({ length: 2200 }, (_, i) => ({ id: key(i) })) };
    const table = fakeTable(store, {
      onPage: ({ index }) => {
        if (index === 0) store.rows = store.rows.filter((row) => row.id !== key(2100));
        return null;
      },
    });
    const rows = await readAll("delete", table, 100_000);
    check(rows.length === 2199, "a row deleted mid-read is absent and nothing else is lost (" + rows.length + ")");
    check(!rows.some((r) => r.id === key(2100)), "the deleted row is not returned");
  }

  // UPDATE to a NON-cursor column between pages: completeness is unaffected.
  {
    const store = { rows: Array.from({ length: 2200 }, (_, i) => ({ id: key(i), label: "before" })) };
    const table = fakeTable(store, {
      onPage: ({ index }) => {
        if (index === 0) for (const row of store.rows) row.label = "after";
        return null;
      },
    });
    const rows = await readAll("update", table, 100_000);
    check(rows.length === 2200, "updating a non-key column mid-read loses nothing (" + rows.length + ")");
  }

  // ERROR on an INTERMEDIATE page: the whole read fails. It must never return
  // the pages it did manage to read as if they were the complete set.
  {
    const store = { rows: Array.from({ length: 3200 }, (_, i) => ({ id: key(i) })) };
    const table = fakeTable(store, {
      onPage: ({ index }) => (index === 2 ? { error: { message: "connection reset" } } : null),
    });
    let threw = null;
    let returned = null;
    try {
      returned = await readAll("mid-error", table, 100_000);
    } catch (e) {
      threw = e;
    }
    check(
      threw !== null && /connection reset/.test(threw.message),
      "an error on page 3 fails the read (" +
        (returned ? "returned " + returned.length + " rows" : "threw") + ")",
    );
  }
}

// ---- [5] Scope travels with every page -------------------------------------
console.log("\n[5] Every page carries the caller's tenant/study scope");
{
  const store = { rows: Array.from({ length: 2500 }, (_, i) => ({ id: key(i) })) };
  const scopes = [];
  const table = fakeTable(store, {
    onPage: ({ scope }) => {
      scopes.push(scope.join(","));
      return null;
    },
  });
  await selectAllPages(
    "scoped",
    (cursor, size) =>
      keysetWindow(table.make().select("id").eq("study_id", "study-1"), { column: "id", cursor, size }),
    { maxRows: 100_000, cursorOf: (row) => row.id },
  );
  check(scopes.length === 3, "the read took " + scopes.length + " pages");
  check(
    scopes.every((s) => s === "study_id=study-1"),
    "every page was scoped to the same study — a later page cannot widen the read",
  );
}

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error("RESULT: " + failures + " failure(s). GATE BLOCKED.");
  process.exit(1);
}
console.log("RESULT: study reads are complete, ordered and scoped. GATE PASSED.");
