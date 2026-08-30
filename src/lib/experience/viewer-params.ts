/**
 * The reader's current choices, in a URL.
 *
 * WHY THIS EXISTS. An internal preview somebody can refresh, bookmark and send
 * to a colleague is worth far more than one whose state dies with the tab —
 * "look at what happens when you pick this generation" has to survive being
 * pasted into a message.
 *
 * WHAT IS IN IT, AND WHAT IS NOT.
 *
 *   In:  a composer FILTER ID, which is an opaque hash the composer minted,
 *        and SEGMENT VALUES the study imported — the same words that are
 *        already printed as category labels on the charts the URL points at.
 *
 *   Not: a respondent, an answer, a quote, a canonical metric key, a column
 *        name, a tenant or anything derived from one. A filter id names a
 *        control; it is not a key, and it resolves only inside the one study
 *        it was minted for. A link that leaks into the wrong hands still lands
 *        on a route that runs `requireInternal()` before it reads anything.
 *
 * `f.` is the same prefix the client dashboard's own filters already use
 * (`src/lib/dashboard/filters.ts`), so the shape is one a reader of this
 * codebase has already met.
 *
 * EVERYTHING IS BOUNDED AND REJECT-BY-DEFAULT. A parameter naming a filter the
 * document does not declare is dropped, a value the study does not carry is
 * dropped, and the counts are capped — a URL is untrusted input like any
 * other, and this is the boundary that treats it as one.
 */

import { EXPERIENCE_LIMITS } from "./limits";
import type { ExperienceDefinitionV1 } from "./definition";
import type { SemanticRegistry } from "./registry";
import type { ViewerSelection } from "./data";

const PREFIX = "f.";
/** Values inside one parameter. `|` cannot occur in a stored segment value. */
const SEPARATOR = "|";

/** No more parameters than an experience can declare filters. */
const MAX_FILTERS = EXPERIENCE_LIMITS.filterDefinitions;
/** No more chosen values than a control may pre-select. */
const MAX_VALUES = EXPERIENCE_LIMITS.defaultValuesPerFilter;

type RawParams = Record<string, string | string[] | undefined>;

/**
 * Read a selection out of URL parameters, keeping only what this exact
 * document and this exact study can account for.
 */
export function parseViewerSelection(
  params: RawParams,
  definition: ExperienceDefinitionV1,
  registry: SemanticRegistry,
): ViewerSelection {
  const declared = new Map(definition.filterDefinitions.map((filter) => [filter.id, filter]));
  const valuesByDimension = new Map(
    registry.dimensions.map((dimension) => [
      dimension.id,
      new Set(dimension.values.map((entry) => entry.value)),
    ]),
  );

  const selection: Record<string, string[]> = {};
  let used = 0;

  for (const [name, raw] of Object.entries(params)) {
    if (!name.startsWith(PREFIX)) continue;
    if (used >= MAX_FILTERS) break;

    const filterId = name.slice(PREFIX.length);
    const filter = declared.get(filterId);
    if (!filter) continue;

    const known = valuesByDimension.get(filter.dimensionId);
    if (!known) continue;

    const text = Array.isArray(raw) ? raw.join(SEPARATOR) : (raw ?? "");
    const chosen: string[] = [];
    for (const candidate of text.split(SEPARATOR)) {
      const value = candidate.trim();
      if (value === "" || !known.has(value)) continue;
      if (chosen.includes(value)) continue;
      chosen.push(value);
      if (chosen.length >= MAX_VALUES) break;
    }
    if (chosen.length === 0) continue;

    // A single-choice control carries one value however many the URL named.
    selection[filterId] = filter.control === "single_select" ? [chosen[0]] : chosen;
    used += 1;
  }

  return selection;
}

/**
 * The query string for a selection. Deterministic — filters in the document's
 * own order — so the same choices always produce the same link.
 */
export function viewerSelectionToQuery(
  selection: ViewerSelection,
  definition: ExperienceDefinitionV1,
): string {
  const params = new URLSearchParams();
  for (const filter of definition.filterDefinitions) {
    const values = selection[filter.id];
    if (!values || values.length === 0) continue;
    params.set(`${PREFIX}${filter.id}`, values.join(SEPARATOR));
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
