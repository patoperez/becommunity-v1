"use client";

import { useState } from "react";
import Link from "next/link";
import { STUDIES_LIST } from "./BackLink";

/**
 * The internal-preview notice.
 *
 * It is STICKY rather than fixed, so it participates in normal flow: it pushes
 * the page down instead of overlaying it, which means it can never cover
 * content and never needs a compensating offset. It wraps rather than scrolls
 * sideways, so a narrow phone gets three stacked rows instead of horizontal
 * overflow.
 *
 * Dismissal is component state and nothing else — no cookie, no preference, no
 * database write. Closing it applies to this mounted preview only; navigating
 * back into a preview brings it back. That is deliberate for this pass: the
 * `/admin/preview/...` route and the Studio identity around it are sufficient
 * to keep the context internal after the reviewer has read the notice once.
 */
export function PreviewNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <aside
      aria-label="Aviso de vista previa interna"
      className="sticky top-0 z-40 border-b border-caution-line bg-caution-surface"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-2.5 sm:px-6">
        <p className="min-w-0 text-sm font-semibold text-caution">
          Vista previa interna · el cliente no ve este estudio hasta publicarlo
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={STUDIES_LIST.href}
            className="inline-flex min-h-11 items-center rounded-lg px-2.5 text-sm font-semibold text-caution underline underline-offset-4"
          >
            {STUDIES_LIST.label}
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Cerrar aviso de vista previa"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-caution transition-colors duration-[var(--motion-state)] hover:bg-caution-line/40"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M4 4l8 8M12 4l-8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
