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
 * Two rules follow, and both are load-bearing:
 *
 *   - Never read a set that can exceed the cap with a single `.select()`.
 *     Page through it here instead.
 *   - Never silently stop. If a set is larger than the caller's declared
 *     maximum this THROWS, because a partial set that looks complete is how the
 *     defect above stayed invisible. A failed page is louder than a wrong mean.
 */

/** PostgREST's own page size for this project. Pages larger than this are capped. */
export const API_PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function selectAllPages<T>(
  label: string,
  page: (from: number, to: number) => Page<T>,
  maxRows: number,
): Promise<T[]> {
  if (!Number.isSafeInteger(maxRows) || maxRows <= 0) {
    throw new RangeError(`${label}: maxRows must be a positive integer`);
  }
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += API_PAGE_SIZE) {
    const size = Math.min(API_PAGE_SIZE, maxRows - from);
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    // A short page is the end of the set. A full page means there may be more.
    if (batch.length < size) return rows;
  }
  throw new Error(
    `${label}: the result set exceeds ${maxRows} rows, so it cannot be read completely; ` +
      "refusing to continue with a partial set",
  );
}
