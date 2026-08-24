import Link from "next/link";

/**
 * The one contextual "go up" control in Studio.
 *
 * It is an explicit `href` to a named parent, never `history.back()`. A
 * consultant reaches these pages from an emailed URL, a reload, a bookmark and
 * a new tab as often as from a click, and in every one of those cases the
 * browser's history has nothing useful in it — `history.back()` would either do
 * nothing or leave the product entirely. Browser Back keeps working normally,
 * because nothing here touches the history stack.
 *
 * It is rendered as a real link, so middle-click and open-in-new-tab behave the
 * way a link should.
 */

export type StudioParent = { href: string; label: string };

/** The parents the internal routes actually have, in one place. */
export const STUDIO_HOME: StudioParent = { href: "/dashboard", label: "Volver a Studio" };
export const STUDIES_LIST: StudioParent = {
  href: "/admin/studies",
  label: "Volver a Estudios y plantillas",
};

export function BackLink({ parent }: { parent: StudioParent }) {
  return (
    <Link
      href={parent.href}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-evidence underline-offset-4 hover:underline"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M10 3L5 8l5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {parent.label}
    </Link>
  );
}
