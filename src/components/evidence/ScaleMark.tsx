/**
 * Visual evidence for a single result.
 *
 * WHY THIS IS NOT SVG ANY MORE. The previous marks drew a `<rect>` and a
 * `<circle>` inside `viewBox="0 0 100 12"` with `preserveAspectRatio="none"`.
 * Stretched to ~400 px wide that scales x by ~4 and y by 1, so every circle
 * became a wide ellipse and every rounded corner smeared — the fill's rounded
 * end and the value marker read as TWO pills, i.e. as two values. The geometry
 * was right and the rendering was lying about it.
 *
 * The marks are now plain CSS: a track, a fill positioned by percentage, and
 * one fixed-size marker. Percentages stretch; the marker does not. There is
 * exactly one marker per mark, and it is the same shape in all three, so "this
 * is the result" is learned once.
 *
 * Accessibility contract, unchanged:
 *  - the exact value is always real text next to the mark, so the drawing is
 *    never the only carrier of the number;
 *  - the drawing itself is `aria-hidden`; the scale anchors are real text;
 *  - position and length carry the quantity — never colour alone, never font
 *    size, and the marker is distinguishable by shape in greyscale.
 */

type Unit = "nps" | "percent" | "score";

/**
 * The domain a unit is read against — but ONLY for the two units that genuinely
 * have one. `nps` is defined from -100 to 100 and `percent` from 0 to 100, by
 * the definition of the measure itself.
 *
 * `score` returns null on purpose. The scale a study uses is the client's own
 * instrument: it may be 1-5, 1-10 or something else, and the sanitized
 * aggregate the browser receives does not carry it. An earlier draft assumed
 * 1-5, which pinned a 7.5 average at the far right of a full bar — a right
 * number under a wrong denominator. A score therefore gets no absolute track;
 * it is compared only against its own peers.
 */
export function domainFor(unit: Unit): { min: number; max: number; label: string } | null {
  if (unit === "nps") return { min: -100, max: 100, label: "de -100 a 100" };
  if (unit === "percent") return { min: 0, max: 100, label: "de 0 % a 100 %" };
  return null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * Geometry for a DIVERGING scale (recomendación, -100..100).
 *
 * Read from zero, not from the floor: a negative result extends LEFT of centre
 * and a positive result extends RIGHT. Exported so the deterministic gate can
 * assert the contract without rendering anything.
 */
export function divergingGeometry(
  value: number,
  min = -100,
  max = 100,
): { zeroPercent: number; fillLeftPercent: number; fillWidthPercent: number; markerPercent: number } {
  const span = max - min;
  const zero = clampPercent(((0 - min) / span) * 100);
  const marker = clampPercent(((value - min) / span) * 100);
  return {
    zeroPercent: zero,
    fillLeftPercent: Math.min(zero, marker),
    fillWidthPercent: Math.abs(marker - zero),
    markerPercent: marker,
  };
}

/** Geometry for a PROPORTIONAL track (0..100 %): one fill, one endpoint. */
export function proportionGeometry(
  value: number,
  min = 0,
  max = 100,
): { fillWidthPercent: number; markerPercent: number } {
  const marker = clampPercent(((value - min) / (max - min)) * 100);
  return { fillWidthPercent: marker, markerPercent: marker };
}

/**
 * Geometry for a PEER comparison: where a value sits between the lowest and
 * highest comparable result actually being shown. Returns null when the peers
 * do not span a range, because a single point cannot be positioned honestly.
 */
export function peerGeometry(
  value: number,
  min: number,
  max: number,
): { markerPercent: number } | null {
  if (!(max > min)) return null;
  return { markerPercent: clampPercent(((value - min) / (max - min)) * 100) };
}

/** The one marker shape, shared by all three marks. */
function Marker({ percent, fill }: { percent: number; fill: string }) {
  return (
    <span
      data-mark="marker"
      aria-hidden="true"
      className="absolute top-1/2 h-[1.35rem] w-[0.3rem] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--color-surface)]"
      style={{ left: `${percent}%`, backgroundColor: fill }}
    />
  );
}

function Anchors({ left, middle, right }: { left: string; middle?: string; right: string }) {
  return (
    <div className="tabular mt-1.5 flex items-baseline justify-between text-[0.7rem] text-muted">
      <span>{left}</span>
      {middle ? <span>{middle}</span> : null}
      <span>{right}</span>
    </div>
  );
}

const TRACK = "relative h-3 w-full rounded-full bg-surface-sunken";

/**
 * A value on its own declared, absolute scale. Only a measure with a real
 * domain may use this: `nps` diverges from zero, `percent` fills from zero.
 */
export function ScaleMark({
  value,
  unit,
  tone = "evidence",
}: {
  value: number;
  unit: "nps" | "percent";
  tone?: "evidence" | "accent";
}) {
  const domain = domainFor(unit);
  if (!domain) return null;
  const fill = tone === "accent" ? "var(--study-accent)" : "var(--color-evidence)";

  if (unit === "nps") {
    const geometry = divergingGeometry(value, domain.min, domain.max);
    return (
      <div data-mark-kind="diverging">
        <div className={TRACK}>
          {/* The neutral zero reference, drawn once and behind the fill. */}
          <span
            data-mark="zero"
            aria-hidden="true"
            className="absolute inset-y-[-0.2rem] w-px bg-line-strong"
            style={{ left: `${geometry.zeroPercent}%` }}
          />
          <span
            data-mark="fill"
            aria-hidden="true"
            className="absolute inset-y-0 rounded-full"
            style={{
              left: `${geometry.fillLeftPercent}%`,
              width: `${geometry.fillWidthPercent}%`,
              backgroundColor: fill,
            }}
          />
          <Marker percent={geometry.markerPercent} fill={fill} />
        </div>
        <Anchors left="−100" middle="0" right="+100" />
      </div>
    );
  }

  const geometry = proportionGeometry(value, domain.min, domain.max);
  return (
    <div data-mark-kind="proportion">
      <div className={TRACK}>
        <span
          data-mark="fill"
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${geometry.fillWidthPercent}%`, backgroundColor: fill }}
        />
        <Marker percent={geometry.markerPercent} fill={fill} />
      </div>
      <Anchors left="0 %" right="100 %" />
    </div>
  );
}

/**
 * A value placed against its own PEERS rather than against an absolute scale.
 *
 * This is what an average gets instead of a fabricated domain. There is no fill
 * — a fill would imply a zero baseline the product cannot claim — only the span
 * of the comparable results, its two ends labelled with the real numbers, and
 * the one marker showing where this result sits between them.
 */
export function PeerMark({
  value,
  min,
  max,
  tone = "evidence",
}: {
  value: number;
  min: number;
  max: number;
  tone?: "evidence" | "accent";
}) {
  const geometry = peerGeometry(value, min, max);
  if (!geometry) return null;
  const fill = tone === "accent" ? "var(--study-accent)" : "var(--color-evidence)";
  return (
    <div data-mark-kind="peer">
      <div className={TRACK}>
        {/* Both ends are real, measured results, so both are marked. */}
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-line-strong" />
        <span aria-hidden="true" className="absolute inset-y-0 right-0 w-0.5 rounded-full bg-line-strong" />
        <Marker percent={geometry.markerPercent} fill={fill} />
      </div>
      <Anchors left={`Más bajo · ${min}`} right={`Más alto · ${max}`} />
    </div>
  );
}

/**
 * The "no evidence yet" equivalent: a dashed empty track. Absence is drawn
 * rather than left blank, so a reader can tell "nothing measured here" from
 * "the section failed to load". It carries no marker, because there is no value.
 */
export function AbsentMark() {
  return (
    <div data-mark-kind="absent">
      <div
        aria-hidden="true"
        className="h-3 w-full rounded-full border border-dashed border-line-strong"
      />
    </div>
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
