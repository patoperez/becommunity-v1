/**
 * THE AUTHORED JOURNEY-PAIN CONTENT — what a person decided, turned into what a
 * client is drawn.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS CONFIGURATION AND NOT A CALCULATION.
 *
 * The approved dashboard shows a cloud of journey pain phrases and a badge on
 * each touchpoint that carries one. Neither is derivable. The canonical layer
 * holds fifty curated `pain_point` rows, each attached to a curated JOURNEY
 * STAGE, and the client's journey is drawn from measured TOUCHPOINTS — and the
 * two vocabularies do not correspond:
 *
 *   * of the eighteen curated stage labels, ZERO match a canonical
 *     `survey_item.label`, SIX match the workbook's short label row, and FIVE
 *     match the bracketed text inside the prompt. Three defensible readings,
 *     three different answers;
 *   * «Reunión semanal presencial/en línea» is ONE stage over TWO touchpoints;
 *   * «BNI Connect» is ambiguous between the web platform and the phone app,
 *     and «App celular» names that same app.
 *
 * A rule that produces three answers from three readings of the same sources is
 * not an authority. So nothing in this file infers a mapping from a string, a
 * position, a workbook order or an alias table. Every relation here was chosen
 * by a named person and arrives already decided.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COUNTING HAPPENS HERE, WHICH IS TO SAY ON THE SERVER.
 *
 * `resolvePresentation` runs on the server and calls this; the render model it
 * produces carries finished numbers and finished phrases. The React components
 * lay them out and count nothing. That is contract C1 — the frontend performs
 * no aggregation, deduplication, classification or phrase counting — and it is
 * why this module exists rather than a `useMemo` in a component.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE PHRASE OVER MANY POINTS IS ONE PHRASE.
 *
 * A reviewer may legitimately map one approved phrase to several touchpoints —
 * one source stage covering two of them is the documented case. The cloud is a
 * cloud of PHRASES, so such an item contributes ONE to the cloud total and
 * appears on every point it was mapped to. Counting it once per point would
 * inflate the headline figure by a reviewer's mapping decision, which is
 * exactly the kind of number that gets quoted and cannot be reproduced.
 */

import type { PresentationHandle } from "./handles";

/**
 * One approved source item, as a person left it.
 *
 * `phrase` is the PUBLIC phrase the reviewer approved — possibly edited by them
 * — and never the source row's own text. `touchpoints` is what they chose, in
 * their own order, and is never empty for an approved item.
 */
export type AuthoredPainMapping = {
  phrase: string;
  touchpoints: readonly PresentationHandle[];
};

/** Everything the reviewer approved for one study, in their own order. */
export type AuthoredJourneyPain = {
  mappings: readonly AuthoredPainMapping[];
};

/** One phrase in the cloud, counted. */
export type JourneyPainTerm = {
  label: string;
  /** Approved source items carrying this phrase. Never multiplied by points. */
  count: number;
};

/** What one touchpoint carries, as a badge draws it. */
export type JourneyPainAtTouchpoint = {
  /** Distinct approved phrases mapped here, in first-approval order. */
  phrases: readonly string[];
  /** Approved source items mapped here. Never smaller than `phrases.length`. */
  count: number;
};

/**
 * The finished content: a cloud, and a per-touchpoint index.
 *
 * Both are derived from the same list in one pass, so the badge on a point and
 * the term in the cloud can never disagree about what a person approved.
 */
export type JourneyPainContent = {
  terms: readonly JourneyPainTerm[];
  /** Approved source items, counted once each. The cloud's own base. */
  total: number;
  byTouchpoint: ReadonlyMap<PresentationHandle, JourneyPainAtTouchpoint>;
};

/**
 * Turn approved decisions into finished content.
 *
 * Deterministic and total: the same list always produces the same bytes, and
 * an empty list produces empty content rather than a refusal — «nobody approved
 * anything yet» is a state the preflight reports, not an error this computes.
 *
 * TERMS ARE ORDERED BY COUNT AND THEN ALPHABETICALLY, never by the order they
 * happened to be reviewed in. A cloud whose order depended on the sequence a
 * person worked through their queue would redraw itself when somebody revisited
 * one item, and a reader would read that as the study changing.
 */
export function buildJourneyPainContent(authored: AuthoredJourneyPain): JourneyPainContent {
  const counts = new Map<string, number>();
  const byTouchpoint = new Map<PresentationHandle, { phrases: string[]; count: number }>();

  for (const mapping of authored.mappings) {
    counts.set(mapping.phrase, (counts.get(mapping.phrase) ?? 0) + 1);
    // A DUPLICATE POINT INSIDE ONE ITEM IS NOT TWO MAPPINGS. The editor cannot
    // produce one and the store refuses one, but a defensive dedup here means a
    // badge can never claim a person chose the same point twice.
    const seen = new Set<PresentationHandle>();
    for (const handle of mapping.touchpoints) {
      if (seen.has(handle)) continue;
      seen.add(handle);
      let entry = byTouchpoint.get(handle);
      if (!entry) {
        entry = { phrases: [], count: 0 };
        byTouchpoint.set(handle, entry);
      }
      entry.count += 1;
      if (!entry.phrases.includes(mapping.phrase)) entry.phrases.push(mapping.phrase);
    }
  }

  const terms = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => (a.count !== b.count ? b.count - a.count : a.label < b.label ? -1 : 1));

  return {
    terms,
    // THE SUM OF THE TERM COUNTS, which is the number of approved items — not
    // the number of (item, point) pairs. See the header.
    total: authored.mappings.length,
    byTouchpoint,
  };
}
