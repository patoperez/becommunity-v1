/**
 * Visual evidence for a single result.
 *
 * One chart, one point, and the point is written above it. Every mark is
 * hand-written SVG — the established pattern in this codebase, compatible with
 * the Workers runtime and the strict CSP, and it adds no dependency.
 *
 * Accessibility contract, applied to every mark here:
 *  - the exact value is always present as real text next to the mark, so the
 *    drawing is never the only carrier of the number;
 *  - the mark itself is `aria-hidden`, because repeating the number to a screen
 *    reader in a second voice adds nothing;
 *  - position and length carry the quantity — never colour alone, and never
 *    font size.
 */

type Unit = "nps" | "percent" | "score";

/**
 * The domain a unit is read against — but ONLY for the two units that genuinely
 * have one. `nps` is defined from -100 to 100 and `percent` from 0 to 100, by
 * the definition of the measure itself.
 *
 * `score` returns null on purpose. The scale a study uses is the client's own
 * instrument: it may be 1-5, 1-10 or something else, and the sanitized
 * aggregate the browser receives does not carry it. An earlier draft of this
 * file assumed 1-5, which pinned a 7.5 average at the far right of a full bar —
 * a right number under a wrong denominator. A score therefore gets no absolute
 * track; it is shown as a number, and compared only against its own peers.
 */
export function domainFor(unit: Unit): { min: number; max: number; label: string } | null {
  if (unit === "nps") return { min: -100, max: 100, label: "de -100 a 100" };
  if (unit === "percent") return { min: 0, max: 100, label: "de 0 % a 100 %" };
  return null;
}

function ratio(value: number, min: number, max: number): number {
  if (!(max > min)) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * A value placed on its own declared scale. The full track is always drawn, so
 * the reader can see how much of the scale the result occupies rather than a
 * bar that fills whatever space is available.
 */
export function ScaleMark({
  value,
  unit,
  tone = "evidence",
  height = 12,
}: {
  value: number;
  /** Only a unit with a real, defined domain may be drawn on an absolute scale. */
  unit: "nps" | "percent";
  tone?: "evidence" | "accent";
  height?: number;
}) {
  const domain = domainFor(unit);
  if (!domain) return null;
  const { min, max } = domain;
  const position = ratio(value, min, max);
  const fill = tone === "accent" ? "var(--study-accent)" : "var(--color-evidence)";
  // NPS is a diverging scale: it is read from zero, not from the floor.
  const zero = unit === "nps" ? ratio(0, min, max) : 0;
  const left = Math.min(position, zero);
  const width = Math.abs(position - zero);

  return (
    <svg
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      style={{ height, width: "100%" }}
    >
      <rect x="0" y="4" width="100" height="4" rx="2" fill="var(--color-surface-sunken)" />
      <rect
        x={left * 100}
        y="2.5"
        width={Math.max(width * 100, 0.8)}
        height="7"
        rx="3.5"
        fill={fill}
      />
      {unit === "nps" ? (
        <line x1={zero * 100} y1="0" x2={zero * 100} y2="12" stroke="var(--color-line-strong)" strokeWidth="1" />
      ) : null}
      <circle cx={position * 100} cy="6" r="4" fill={fill} stroke="var(--color-surface)" strokeWidth="1.5" />
      <title>{`${value} en una escala de ${min} a ${max}`}</title>
    </svg>
  );
}

/**
 * A value placed against its own PEERS rather than against an absolute scale.
 *
 * This is what a score gets instead of a fabricated domain: the track spans the
 * lowest and highest of the comparable results actually being shown, and the
 * caption has to say so. It answers "compared with the others" honestly and
 * never implies a denominator the product does not know.
 */
export function PeerMark({
  value,
  min,
  max,
  tone = "evidence",
  height = 12,
}: {
  value: number;
  min: number;
  max: number;
  tone?: "evidence" | "accent";
  height?: number;
}) {
  if (!(max > min)) return null;
  const position = ratio(value, min, max);
  const fill = tone === "accent" ? "var(--study-accent)" : "var(--color-evidence)";
  return (
    <svg
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      style={{ height, width: "100%" }}
    >
      <rect x="0" y="4" width="100" height="4" rx="2" fill="var(--color-surface-sunken)" />
      <circle
        cx={position * 100}
        cy="6"
        r="4"
        fill={fill}
        stroke="var(--color-surface)"
        strokeWidth="1.5"
      />
      <title>{`${value}, entre ${min} y ${max} en los resultados comparables`}</title>
    </svg>
  );
}

/**
 * The "no evidence yet" equivalent of a mark: a dashed empty track. Absence is
 * drawn rather than left blank, so a reader can tell "nothing measured here"
 * from "the section failed to load".
 */
export function AbsentMark({ height = 12 }: { height?: number }) {
  return (
    <svg
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      style={{ height, width: "100%" }}
    >
      <rect
        x="0.5"
        y="4"
        width="99"
        height="4"
        rx="2"
        fill="none"
        stroke="var(--color-line-strong)"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
    </svg>
  );
}

/**
 * A ranked list of counts as bars. Used for themes, where quantity must be
 * carried by bar length and a written count — never by font size, which is the
 * pattern this replaces (audit §6, `QualitativeInsights.tsx:22`).
 */
export function RankedBars({
  items,
  max,
}: {
  items: { label: string; count: number; caution?: boolean }[];
  max: number;
}) {
  const ceiling = Math.max(max, 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
          <span className="truncate text-sm font-medium text-strong">{item.label}</span>
          <span className="tabular text-sm text-muted">
            {item.count === 1 ? "1 comentario" : `${item.count} comentarios`}
          </span>
          <span className="col-span-2 mt-1 block h-2 w-full rounded-full bg-surface-sunken">
            <span
              className="block h-2 rounded-full"
              style={{
                width: `${Math.max(4, (item.count / ceiling) * 100)}%`,
                backgroundColor: item.caution
                  ? "var(--color-caution-line)"
                  : "var(--color-voice)",
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
