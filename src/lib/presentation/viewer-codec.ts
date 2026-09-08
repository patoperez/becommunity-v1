/**
 * THE VIEWER-STATE CODEC — a selection as one short, allowlisted string.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS FOR, AND WHAT IT IS NOT WIRED TO.
 *
 * A reader who has narrowed a study to «Generación X» and «Giro: servicios»
 * will eventually want to send that view to a colleague, and a link is how
 * people do that. This module is the encoding half of that feature: a selection
 * in, a compact string out, and the same selection back — or an explicit,
 * closed refusal.
 *
 * IT IS NOT CONNECTED TO ANY ROUTE. The production client route is not switched
 * in this unit and no page reads or writes this parameter yet. The codec exists,
 * is exercised offline, and refuses everything it should refuse BEFORE anything
 * depends on it — which is the only order in which a link format can be got
 * right cheaply.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ALLOWLIST IS THE WHOLE DESIGN.
 *
 * A URL is the most hostile input a product has: it is attacker-authored, it is
 * pasted into chat windows, it is crawled, and it arrives before any session
 * does. So the decoder never turns text into a query. It turns text into
 * CANDIDATE POSITIONS — a panel the document already contains, a dimension that
 * panel already offers, an ordinal the server already minted — and every one of
 * those is checked against the offer built from this study's own document and
 * registry. A name that is not on the list is not a filter; it is a refusal.
 *
 * There is therefore no way to express, in this format, a column, a table, a
 * study, a tenant, a comparison, a range, a wildcard or a free-text value. The
 * grammar cannot spell them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND A REFUSAL NEVER QUOTES WHAT IT REFUSED.
 *
 * Every failure returns a code and nothing else. An error that echoes the input
 * is a way to read a value back out of a system that had decided not to publish
 * one, and a link is exactly where somebody would try it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GRAMMAR.
 *
 *   state  := panel (";" panel)*
 *   panel  := panelId "~" dimension ("," dimension)*
 *   dim    := handle "=" token ("." token)*
 *
 * `;` `~` `,` `=` `.` appear in none of the three alphabets — a panel id is
 * `[a-z0-9_-]`, a handle is `facet:seg-seg`, a token is `o` followed by digits —
 * so the format needs no escaping and cannot be made ambiguous by a value.
 */

import {
  EMPTY_VIEWER_SELECTION,
  VIEWER_LIMITS,
  normalizeViewerSelection,
  validateViewerSelection,
  type ViewerOffer,
  type ViewerRefusalCode,
  type ViewerSelection,
} from "./viewer";

/** The query parameter a future client link would carry this in. */
export const VIEWER_STATE_PARAM = "v";

const PANEL_SEPARATOR = ";";
const PANEL_BODY_SEPARATOR = "~";
const DIMENSION_SEPARATOR = ",";
const OPTION_ASSIGNMENT = "=";
const OPTION_SEPARATOR = ".";

/**
 * Encode a selection.
 *
 * The selection is normalized first, so the same reader state always encodes to
 * the same bytes: a link is an identity, and two links that mean the same thing
 * and look different are two links somebody will treat as two views.
 *
 * A neutral selection encodes to the empty string, which a caller should omit
 * from a URL entirely rather than write as `?v=`.
 */
export function encodeViewerSelection(selection: ViewerSelection): string {
  const normalized = normalizeViewerSelection(selection);
  return normalized.panels
    .map((panel) => {
      const dimensions = panel.dimensions
        .map((dimension) => `${dimension.handle}${OPTION_ASSIGNMENT}${dimension.options.join(OPTION_SEPARATOR)}`)
        .join(DIMENSION_SEPARATOR);
      return `${panel.panelId}${PANEL_BODY_SEPARATOR}${dimensions}`;
    })
    .join(PANEL_SEPARATOR);
}

export type ViewerDecode =
  | { ok: true; selection: ViewerSelection }
  | { ok: false; code: ViewerRefusalCode };

/**
 * Decode one encoded viewer state against the offer this study actually makes.
 *
 * FAIL CLOSED. A malformed string, an unknown panel, a dimension the panel does
 * not offer or an option the dimension does not have all refuse the WHOLE state
 * rather than salvaging the part that parsed. A half-honoured link shows a
 * reader a view they did not ask for while their address bar insists they did.
 */
export function decodeViewerSelection(encoded: string, offer: ViewerOffer): ViewerDecode {
  if (typeof encoded !== "string") return { ok: false, code: "viewer_selection_malformed" };
  if (encoded.length === 0) return { ok: true, selection: EMPTY_VIEWER_SELECTION };
  if (encoded.length > VIEWER_LIMITS.encodedLength) {
    return { ok: false, code: "viewer_selection_malformed" };
  }

  const panels = [];
  const panelParts = encoded.split(PANEL_SEPARATOR);
  if (panelParts.length > VIEWER_LIMITS.panels) return { ok: false, code: "viewer_selection_malformed" };

  for (const panelPart of panelParts) {
    const split = panelPart.indexOf(PANEL_BODY_SEPARATOR);
    if (split <= 0) return { ok: false, code: "viewer_selection_malformed" };
    const panelId = panelPart.slice(0, split);
    const body = panelPart.slice(split + PANEL_BODY_SEPARATOR.length);
    if (body.length === 0) return { ok: false, code: "viewer_selection_malformed" };
    // A second `~` in one panel means the string was built by something that
    // does not know this grammar. It is refused rather than read up to the
    // first separator, because reading past a surprise is how a parser invents
    // a value.
    if (body.includes(PANEL_BODY_SEPARATOR)) return { ok: false, code: "viewer_selection_malformed" };

    const dimensionParts = body.split(DIMENSION_SEPARATOR);
    if (dimensionParts.length > VIEWER_LIMITS.dimensionsPerPanel) {
      return { ok: false, code: "viewer_selection_malformed" };
    }
    const dimensions = [];
    for (const dimensionPart of dimensionParts) {
      const assign = dimensionPart.indexOf(OPTION_ASSIGNMENT);
      if (assign <= 0) return { ok: false, code: "viewer_selection_malformed" };
      const handle = dimensionPart.slice(0, assign);
      const optionText = dimensionPart.slice(assign + OPTION_ASSIGNMENT.length);
      if (optionText.length === 0) return { ok: false, code: "viewer_selection_malformed" };
      if (optionText.includes(OPTION_ASSIGNMENT)) return { ok: false, code: "viewer_selection_malformed" };
      const options = optionText.split(OPTION_SEPARATOR);
      if (options.length > VIEWER_LIMITS.optionsPerDimension) {
        return { ok: false, code: "viewer_selection_malformed" };
      }
      dimensions.push({ handle, options });
    }
    panels.push({ panelId, dimensions });
  }

  // The SAME validator the Server Action uses. A link and a form post are two
  // transports for one question, and two validators would eventually answer it
  // two ways.
  const validated = validateViewerSelection({ panels }, offer);
  if (!validated.ok) return { ok: false, code: validated.code };
  return { ok: true, selection: validated.selection };
}

/**
 * What a route would do with a whole query string, said explicitly.
 *
 * `discarded` names the parameters that were ignored — NAMES ONLY, never their
 * values, because a query string is where somebody would put an email address
 * to see whether the product echoes it back. An unknown parameter is not an
 * error: links are pasted with tracking parameters attached every day, and
 * refusing a whole view because a `utm_source` came along would be a product
 * that cannot be shared.
 *
 * The viewer parameter itself is the opposite: it is the thing being asked for,
 * so an invalid one refuses.
 */
export function readViewerStateParams(
  params: Readonly<Record<string, string | string[] | undefined>>,
  offer: ViewerOffer,
): { decoded: ViewerDecode; discarded: string[] } {
  const discarded = Object.keys(params)
    .filter((name) => name !== VIEWER_STATE_PARAM)
    .sort();
  const raw = params[VIEWER_STATE_PARAM];
  if (raw === undefined) return { decoded: { ok: true, selection: EMPTY_VIEWER_SELECTION }, discarded };
  // Repeated parameters arrive as an array. Two viewer states in one URL is not
  // a view; it is two, and choosing one of them for the reader would be the
  // product deciding what they meant.
  if (Array.isArray(raw)) {
    return { decoded: { ok: false, code: "viewer_selection_malformed" }, discarded };
  }
  return { decoded: decodeViewerSelection(raw, offer), discarded };
}
