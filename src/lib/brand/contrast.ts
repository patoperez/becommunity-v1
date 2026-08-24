/**
 * Tenant brand contrast resolver (P8.1 / audit F4).
 *
 * `brandSchema` accepts any `#rrggbb`. Before P8 the dashboard painted that raw
 * hex behind hardcoded white text, so a client who picked a light brand colour
 * got unreadable white-on-light. This module is the guard: a component never
 * receives a raw tenant hex, only a resolved set in which every pairing is
 * guaranteed to clear its contrast floor.
 *
 * Pure arithmetic (WCAG 2.x relative luminance and contrast ratio). No new
 * dependency, and safe on the Workers runtime.
 *
 * NOTE: this changes presentation only. It does not touch `brand_config`, its
 * Zod schema, storage, or the PDF's own palette use.
 */

import type { CSSProperties } from "react";

export const CONTRAST_AA_TEXT = 4.5;
export const CONTRAST_AA_LARGE = 3;

const FALLBACK = "#1b72b8";

/** Parse `#rrggbb` into 0-255 channels; falls back rather than throwing. */
export function parseHex(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  const hex = (match ? match[1] : FALLBACK.slice(1)).toLowerCase();
  return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as
    [number, number, number];
}

function toHex(channels: [number, number, number]): string {
  return `#${channels
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** WCAG relative luminance. */
export function relativeLuminance(value: string): number {
  const [r, g, b] = parseHex(value).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

/** Blend `color` onto `base` at `amount` (0 = base, 1 = color). */
export function mix(color: string, base: string, amount: number): string {
  const from = parseHex(base);
  const to = parseHex(color);
  const t = Math.max(0, Math.min(1, amount));
  return toHex([0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * t) as [number, number, number]);
}

/**
 * The readable foreground for a background: whichever of the product's two
 * extremes reads better. For any colour, at least one of them clears 4.5:1,
 * because the worst case (a mid grey) still reaches ~4.5 against one end.
 */
export function readableOn(background: string, light = "#ffffff", dark = "#0e2a45"): string {
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}

/**
 * Darken or lighten `color` until it clears `ratio` against `against`.
 * Deterministic, bounded, and returns the best attempt rather than looping.
 */
export function ensureContrast(
  color: string,
  against: string,
  ratio = CONTRAST_AA_TEXT,
): string {
  if (contrastRatio(color, against) >= ratio) return color;
  // Move away from the reference colour: toward black if the reference is
  // light, toward white if it is dark.
  const target = relativeLuminance(against) > 0.4 ? "#000000" : "#ffffff";
  let best = color;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(target, color, step / 20);
    best = candidate;
    if (contrastRatio(candidate, against) >= ratio) return candidate;
  }
  return best;
}

export type ResolvedBrand = {
  /** The accent as actually used for fills behind `accentOn` text. */
  accent: string;
  /** Guaranteed >= 4.5:1 against `accent`. */
  accentOn: string;
  /** A quiet tint of the accent, safe under body text. */
  accentSurface: string;
  /** A visible line derived from the accent. */
  accentLine: string;
  /** The accent adjusted to read as text on the page surface (>= 4.5:1). */
  accentQuiet: string;
  /** True when the tenant's own colour had to be adjusted to stay readable. */
  adjusted: boolean;
};

/**
 * Resolve a tenant hex into the study-accent set the product actually paints.
 *
 * `pageSurface` is the surface the quiet variant must be legible on.
 */
export function resolveBrand(
  primary: string,
  pageSurface = "#faf8f3",
): ResolvedBrand {
  const requested = toHex(parseHex(primary));
  // Pick the better foreground first, then move the FILL (not the text) until
  // the pairing is readable, so the tenant's hue survives the correction.
  const accent = ensureContrast(requested, readableOn(requested), CONTRAST_AA_TEXT);
  return {
    accent,
    accentOn: readableOn(accent),
    accentSurface: mix(accent, pageSurface, 0.1),
    accentLine: mix(accent, pageSurface, 0.32),
    accentQuiet: ensureContrast(requested, pageSurface, CONTRAST_AA_TEXT),
    adjusted: accent !== requested,
  };
}

/**
 * The inline custom properties a shell puts on its outermost element. Every
 * component below reads these, never a tenant hex.
 */
export function studyAccentVars(primary: string, pageSurface?: string): CSSProperties {
  const resolved = resolveBrand(primary, pageSurface);
  return {
    "--study-accent": resolved.accent,
    "--study-accent-on": resolved.accentOn,
    "--study-accent-surface": resolved.accentSurface,
    "--study-accent-line": resolved.accentLine,
    "--study-accent-quiet": resolved.accentQuiet,
  } as unknown as CSSProperties;
}
