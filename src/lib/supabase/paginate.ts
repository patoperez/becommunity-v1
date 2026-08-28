/**
 * Reads an entire result set through the Data API, one page at a time.
 *
 * WHY THIS EXISTS. PostgREST caps every response at `max_rows` — 1000 for this
 * project (`supabase/config.toml`). That cap is applied by the SERVER and it
 * silently overrides a larger `.limit()`: a query written `.limit(200_000)`
 * still comes back with 1000 rows, HTTP 200, and no error. A study with 3 282
 * quantitative answers therefore aggregated only its first 1 000, and the
 * client was shown an average over roughly a third of the people who answered
 * it — with no indication that anything was missing.
 *
 * WHY IT IS A KEYSET, NOT AN OFFSET. Paging with `.range(from, to)` over a
 * query that declares no ORDER BY asks the database for "rows 1000-1999" of a
 * set whose order SQL never promised. PostgreSQL is free to return the rows of
 * two separate requests in two different orders, and it does once a plan
 * changes or a row is written between the requests. The observable result is
 * not an error: it is a row counted twice and another never read at all, which
 * lands in exactly the same place the 1000-row cap landed — a mean over the
 * wrong denominator that nothing reports. Ordering by the primary key and
 * asking for "the next 1000 rows AFTER this id" removes the question: each page
 * is a fresh, independently-ordered query whose window is defined by a value,
 * not by a position.
 *
 * THE CONSISTENCY CONTRACT, STATED HONESTLY. These are separate HTTP requests
 * and separate transactions. There is no snapshot across them, and this module
 * does not claim one. What a keyset over a unique, immutable primary key does
 * guarantee is:
 *
 *   - NO DUPLICATES. A row is returned at most once, because every page is
 *     strictly greater than the last id of the previous page.
 *   - NO SKIPPED PRE-EXISTING ROWS. A row that exists for the whole read and is
 *     not deleted is returned exactly once, whatever else is written meanwhile.
 *   - Rows INSERTED during the read are included only if their key sorts after
 *     the current cursor, and rows DELETED during the read are absent. Both are
 *     inherent to reading a moving table without a snapshot; neither can
 *     corrupt the rows that were actually read.
 *
 * A caller that needs a true point-in-time snapshot must read inside one
 * database transaction (an RPC), not through this helper.
 *
 * THREE RULES, ALL LOAD-BEARING:
 *
 *   - Never read a set that can exceed the cap with a single `.select()`.
 *     Page through it here instead.
 *   - Never silently stop. If a set is larger than the caller's declared
 *     maximum this THROWS, because a partial set that looks complete is how the
 *     defect above stayed invisible. A failed page is louder than a wrong mean.
 *   - Never trust the caller to have ordered the query. Every page is checked
 *     for strictly increasing keys, so a forgotten `.order()` fails loudly on
 *     the first page instead of quietly returning a set with holes in it.
 */

/** PostgREST's own page size for this project. Pages larger than this are capped. */
export const API_PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * The builder shape this helper needs, described structurally so that no
 * PostgREST type has to be imported here. A filter must be applied BEFORE an
 * order — which is also the only sequence the Supabase types allow, since
 * .order() returns a transform builder that no longer offers .gt().
 */
type KeysetQuery = {
  gt(column: string, value: string): KeysetQuery;
  order(column: string, options: { ascending: boolean }): KeysetQuery;
  limit(count: number): KeysetQuery;
};

/**
 * Apply the keyset window to an already-scoped query.
 *
 * The scope (`.eq("study_id", …)`, `.in("tenant_id", …)`, the RLS the client
 * carries) belongs to the caller and is applied before this call, so a window
 * can never widen one. This adds only: rows after the cursor, in key order, at
 * most `size` of them.
 */
export function keysetWindow<Q>(
  query: Q,
  options: { column: string; cursor: string | null; size: number },
): Q {
  const { column, cursor, size } = options;
  // The three calls narrow the builder class (filter -> transform) while every
  // member the caller then uses (.returns(), awaiting it) exists on both, so
  // the window is described by one type parameter and the class narrowing is
  // erased here rather than leaking into all thirteen call sites.
  const builder = query as unknown as KeysetQuery;
  const filtered = cursor === null ? builder : builder.gt(column, cursor);
  return filtered.order(column, { ascending: true }).limit(size) as unknown as Q;
}

export type SelectAllOptions<T> = {
  /**
   * Refusal threshold, not a page size. Reaching it throws: the set is larger
   * than this caller is willing to read in full, and a partial answer is worse
   * than no answer.
   */
  maxRows: number;
  /**
   * The keyset cursor for a row — the value of the column the page is ordered
   * by. It must be UNIQUE and IMMUTABLE for the rows being read; every table
   * this project pages uses its `uuid` primary key, whose SQL ordering and
   * JavaScript string ordering agree (fixed-width lowercase hex).
   */
  cursorOf: (row: T) => string;
};

export async function selectAllPages<T>(
  label: string,
  page: (cursor: string | null, size: number) => Page<T>,
  options: SelectAllOptions<T>,
): Promise<T[]> {
  const { maxRows, cursorOf } = options;
  if (!Number.isSafeInteger(maxRows) || maxRows <= 0) {
    throw new RangeError(`${label}: maxRows must be a positive integer`);
  }

  const rows: T[] = [];
  let cursor: string | null = null;

  while (rows.length < maxRows) {
    const size = Math.min(API_PAGE_SIZE, maxRows - rows.length);
    const { data, error } = await page(cursor, size);
    // An error on ANY page fails the whole read. There is no partial success
    // here: the caller asked for a complete set.
    if (error) throw new Error(`${label}: ${error.message}`);
    const batch = data ?? [];

    // Prove the page is ordered before trusting its last row as the next
    // cursor. An unordered page would make the cursor meaningless and silently
    // skip rows, which is the exact failure this helper exists to prevent.
    let previous: string | null = cursor;
    for (const row of batch) {
      const key = cursorOf(row);
      if (typeof key !== "string" || key === "") {
        throw new Error(`${label}: a row has no usable keyset cursor`);
      }
      if (previous !== null && key <= previous) {
        throw new Error(
          `${label}: rows came back out of key order, so the read cannot be proved ` +
            "complete; the query is missing its keyset ordering",
        );
      }
      previous = key;
    }

    rows.push(...batch);
    // A short page is the end of the set. A full page means there may be more.
    if (batch.length < size) return rows;
    cursor = previous;
  }

  throw new Error(
    `${label}: the result set exceeds ${maxRows} rows, so it cannot be read completely; ` +
      "refusing to continue with a partial set",
  );
}
