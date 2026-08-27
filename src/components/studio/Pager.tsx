import Link from "next/link";
import { pageCaption, pageHref, type PageWindow } from "@/lib/studio/paging";

/**
 * Visible paging for the operational lists (P8.2).
 *
 * The rule it exists to enforce: a list never truncates in silence. The caption
 * always states how many rows exist and which of them are on screen, so "these
 * are all of them" and "there are more" can never look the same — which is what
 * a hard `.limit(100)` with no indication used to do on the qualitative review.
 *
 * Pages are real links, not buttons, so the current page is bookmarkable,
 * shareable and reachable with the browser's own controls.
 */

const CONTROL =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-strong transition-colors duration-[var(--motion-state)] hover:bg-surface-sunken";
const CONTROL_OFF =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm font-semibold text-muted";

export function Pager({
  window: view,
  basePath,
  params,
  noun,
  label,
}: {
  window: PageWindow;
  basePath: string;
  /** The filters to carry across pages. `p` is added by `pageHref`. */
  params: Record<string, string | null | undefined>;
  noun: { one: string; many: string };
  /** Names this pager for a screen reader, e.g. "Paginación de observaciones". */
  label: string;
}) {
  const caption = pageCaption(view, noun);
  if (view.totalPages <= 1) {
    return (
      <p className="text-sm text-muted" role="status">
        {caption}
      </p>
    );
  }
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
    >
      <p className="text-sm text-muted" role="status">
        {caption}
      </p>
      <div className="flex items-center gap-2">
        {view.hasPrevious ? (
          <Link className={CONTROL} href={pageHref(basePath, params, view.page - 1)} rel="prev">
            <span aria-hidden="true">‹</span> Anterior
          </Link>
        ) : (
          <span className={CONTROL_OFF} aria-hidden="true">
            <span>‹</span> Anterior
          </span>
        )}
        {view.hasNext ? (
          <Link className={CONTROL} href={pageHref(basePath, params, view.page + 1)} rel="next">
            Siguiente <span aria-hidden="true">›</span>
          </Link>
        ) : (
          <span className={CONTROL_OFF} aria-hidden="true">
            Siguiente <span>›</span>
          </span>
        )}
      </div>
    </nav>
  );
}
