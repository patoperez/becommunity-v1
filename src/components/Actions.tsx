import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * The two link/button treatments this slice actually uses. Deliberately small:
 * P8-A is not the place to speculate a component library, and the audit found
 * six copy-pasted `primaryButton` / `secondaryButton` string constants defined
 * independently in four files, which is what these replace at the surfaces
 * P8-A touches.
 */

export const primaryAction =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-[var(--motion-state)] hover:bg-[#183b5c]";

export const secondaryAction =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong transition-colors duration-[var(--motion-state)] hover:bg-surface-sunken";

export const quietAction =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-blue underline-offset-4 transition-colors duration-[var(--motion-state)] hover:underline";

export function ActionLink({
  href,
  variant = "primary",
  children,
  ...rest
}: {
  href: string;
  variant?: "primary" | "secondary" | "quiet";
  children: ReactNode;
} & Omit<ComponentProps<typeof Link>, "href" | "children">) {
  const className =
    variant === "primary" ? primaryAction : variant === "secondary" ? secondaryAction : quietAction;
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}

/** A right-pointing chevron used to mark "this leads somewhere". */
export function Forward() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M6 3l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
