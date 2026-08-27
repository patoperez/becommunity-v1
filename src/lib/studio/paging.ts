/**
 * Bounded paging and list filters for Studio (P8.2).
 *
 * Two operational lists in this product used to render whatever the database
 * returned, capped by a silent `.limit()`: the qualitative review truncated at
 * 100 rows and said nothing, and the import history showed the newest 30 across
 * every client. A consultant could not tell "these are all of them" from "there
 * are more and you cannot see them", which is the worst possible thing for a
 * surface whose job is deciding what to publish.
 *
 * These helpers are pure so the rules can be proved without a database:
 *
 *  - a page number is a positive integer inside the range the data allows,
 *    and anything else becomes page 1 rather than an error page;
 *  - a page SIZE is chosen from a fixed list, never taken from the URL as a
 *    number, so no request can ask the server for an unbounded read;
 *  - a filter value is only ever accepted when it is one of the values the
 *    server itself offered, so a hand-typed query cannot widen a query.
 *
 * The tenant/study scope is NOT expressed here. Scope is applied by the caller
 * with an explicit `.eq()` on the query, because a scope carried inside a
 * generic "filter" object is a scope that can be forgotten.
 */

/** The only page sizes the server will honour. */
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

/** Never read more than this in one request, whatever the URL says. */
export const MAX_PAGE = 500;

export type PageRequest = { page: number; size: PageSize };

export function parsePageSize(raw: unknown): PageSize {
  const value = Number(String(raw ?? "").trim());
  return (PAGE_SIZES as readonly number[]).includes(value)
    ? (value as PageSize)
    : DEFAULT_PAGE_SIZE;
}

/**
 * A page number from an untrusted query string. Anything that is not a positive
 * integer — a float, a negative, a word, an array, an enormous number — becomes
 * page 1, because a malformed page is a mistyped link, not an error worth
 * showing a consultant.
 */
export function parsePage(raw: unknown): number {
  const text = String(raw ?? "").trim();
  if (!/^[0-9]{1,4}$/.test(text)) return 1;
  const value = Number(text);
  if (value < 1) return 1;
  return Math.min(value, MAX_PAGE);
}

export function parsePageRequest(query: { p?: unknown; por?: unknown }): PageRequest {
  return { page: parsePage(query.p), size: parsePageSize(query.por) };
}

export type PageWindow = {
  page: number;
  size: PageSize;
  total: number;
  totalPages: number;
  /** Inclusive range for a PostgREST `.range(from, to)` call. */
  from: number;
  to: number;
  /** 1-based inclusive range of items on this page, for the readable caption. */
  firstItem: number;
  lastItem: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

/**
 * Resolve a requested page against the number of rows that actually exist.
 *
 * Asking for page 9 of a 2-page list lands on page 2 rather than on an empty
 * table: the row a consultant was looking for is on the last page, and an empty
 * screen would read as "the observations are gone".
 */
export function resolvePage(request: PageRequest, total: number): PageWindow {
  const size = request.size;
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const totalPages = Math.max(1, Math.ceil(safeTotal / size));
  const page = Math.min(Math.max(1, request.page), totalPages);
  const from = (page - 1) * size;
  const to = from + size - 1;
  const firstItem = safeTotal === 0 ? 0 : from + 1;
  const lastItem = Math.min(from + size, safeTotal);
  return {
    page,
    size,
    total: safeTotal,
    totalPages,
    from,
    to,
    firstItem,
    lastItem,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  };
}

/** The caption every paged list shows, so truncation is never silent. */
export function pageCaption(window: PageWindow, noun: { one: string; many: string }): string {
  if (window.total === 0) return `Sin ${noun.many}`;
  if (window.totalPages === 1) {
    return window.total === 1 ? `1 ${noun.one}` : `${window.total} ${noun.many}`;
  }
  return `${window.firstItem}-${window.lastItem} de ${window.total} ${noun.many} · página ${window.page} de ${window.totalPages}`;
}

/**
 * A filter value is accepted only when the server itself offered it.
 *
 * This is the whole rule. `allowed` is built from the data the request is
 * already authorized to see, so a value typed into the URL can only ever narrow
 * the query to something already reachable, never widen it.
 */
export function parseChoice<T extends string>(
  raw: unknown,
  allowed: readonly T[],
): T | null {
  const value = String(raw ?? "").trim();
  if (value === "") return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Build a list URL that keeps the filters and moves only the page. */
export function pageHref(
  basePath: string,
  params: Record<string, string | null | undefined>,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") search.set(key, value);
  }
  if (page > 1) search.set("p", String(page));
  else search.delete("p");
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
