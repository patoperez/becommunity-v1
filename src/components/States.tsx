import type { ReactNode } from "react";

/**
 * The named state set (P8 contract C9).
 *
 * Before P8 six surfaces rendered `null` or an empty `<tbody>` to mean "nothing
 * to say", so a reader could not tell "no qualitative work was done" from
 * "nothing was found". Every state below says which it is, and every one offers
 * a way forward.
 */

type Tone = "quiet" | "caution" | "danger";

const TONE: Record<Tone, { box: string; title: string; body: string }> = {
  quiet: {
    box: "border-line bg-surface",
    title: "text-strong",
    body: "text-muted",
  },
  caution: {
    box: "border-caution-line bg-caution-surface",
    title: "text-caution",
    body: "text-caution",
  },
  danger: {
    box: "border-danger-line bg-danger-surface",
    title: "text-danger",
    body: "text-danger",
  },
};

export function StateBlock({
  tone = "quiet",
  title,
  children,
  action,
  compact = false,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  const style = TONE[tone];
  return (
    <div
      className={`rounded-lg border ${style.box} ${compact ? "px-4 py-3" : "px-5 py-5"}`}
    >
      <p className={`font-display text-base font-semibold ${style.title}`}>{title}</p>
      {children ? (
        <div className={`mt-1.5 text-sm leading-relaxed ${style.body}`}>{children}</div>
      ) : null}
      {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

/** A full-page state, for route boundaries. */
export function PageState({
  kicker,
  title,
  children,
  action,
}: {
  kicker?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <main
      id="contenido"
      className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-20"
    >
      {kicker ? (
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue">
          {kicker}
        </p>
      ) : null}
      <h1 className="mt-3 text-3xl">{title}</h1>
      <div className="mt-4 text-base leading-relaxed text-muted">{children}</div>
      {action ? <div className="mt-7 flex flex-wrap gap-3">{action}</div> : null}
    </main>
  );
}

/** A skeleton line, used only by `loading.tsx` boundaries. */
export function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-surface-sunken ${className}`}
    />
  );
}
