/**
 * A SEMÁFORO AS A CHARACTERISTIC — "muéstrame solo los que están en rojo".
 *
 * THE PROBLEM THIS SOLVES, AND THE ONE IT REFUSES TO SOLVE.
 *
 * A study can record a performance SCORE and no performance CATEGORY. The real
 * one records `desempeño` as a number between 25 and 93 and contains no
 * "Verde" anywhere at all. So a filter offering Verde / Amarillo / Rojo needs a
 * rule for turning that number into a category — and there is exactly one
 * acceptable source for such a rule: a person wrote it down.
 *
 * A configured `BandScheme` IS that rule. Its bands are ordered, bounded,
 * labelled and given a meaning by somebody, and they are stored in the
 * document where they can be read, argued with and changed. When a scheme
 * names the result it classifies, this module turns it into an ordinary
 * filterable characteristic: the values are the band labels, and a
 * respondent's value is whichever band their own answer falls in.
 *
 * WHAT IS NEVER A SOURCE: the distribution. Un percentil, un tercil, "el tercio
 * más bajo" — every one of them is a property of who happened to answer rather
 * than of what good looks like, and a colour derived from one changes meaning
 * every time somebody new replies. A study with no configured scheme therefore
 * offers no performance filter at all, and the builder says so rather than
 * inventing one.
 *
 * HOW IT REACHES THE ENGINE. The rows the canonical layer already reads carry
 * one flattened column per characteristic. A derived characteristic is one more
 * such column, computed here, from a rule in the document. Nothing in
 * `src/lib/calc/**` changes, no aggregate is recomputed differently, and the
 * raw answers are untouched: the classification happens on the way out, which
 * is exactly where the category review's own alias folding happens.
 */

import type { LongRow } from "@/lib/calc/engine";

import { classify, schemeIsUsable, type BandScheme } from "./bands";
import type { ExperienceDefinitionV1 } from "./definition";
import type { RegistryKeyIndex } from "./data";
import type { SemanticDimension, SemanticRegistry } from "./registry";

/**
 * The column a derived characteristic occupies on a long row.
 *
 * Prefixed so it can never collide with an imported `seg_` column, and derived
 * from the scheme's own opaque id so two schemes over the same result stay two
 * characteristics.
 */
export function bandColumnKey(schemeId: string): string {
  return `band__${schemeId}`;
}

/** Every scheme in a document that is both usable and offered as a filter. */
export function filterableSchemes(definition: ExperienceDefinitionV1): BandScheme[] {
  return definition.bandSchemes.filter(
    (scheme) => scheme.filterMetricId !== null && schemeIsUsable(scheme),
  );
}

/**
 * The characteristics a document's schemes add to the study's own.
 *
 * `kind: "category"` because that is what they are: a documented classification
 * of a number, not a period and not an imported segment. It is also what keeps
 * them out of a block that declares it can only recompute over respondent
 * characteristics of the other kinds — the capability model reads it.
 */
export function derivedBandDimensions(
  definition: ExperienceDefinitionV1,
  registry: SemanticRegistry,
): SemanticDimension[] {
  return filterableSchemes(definition).map((scheme) => {
    const metric = registry.metrics.find((entry) => entry.id === scheme.filterMetricId);
    return {
      id: scheme.id,
      label: scheme.filterLabel ?? scheme.title,
      description: `Clasificación de “${metric?.label ?? "un resultado"}” según el semáforo “${scheme.title}”.`,
      source: "Bandas configuradas por el equipo en la construcción del dashboard.",
      kind: "category" as const,
      // The band labels, in the order the scheme lists them, so a control
      // reads best-to-worst the way the scheme was written.
      values: scheme.bands.map((band) => ({ value: band.label, label: band.label })),
      filterEligible: true,
      journeyEligible: false,
      publicationReady: true,
    };
  });
}

/** The registry a surface should use: the study's, plus what the document derives. */
export function registryWithDerivedBands(
  definition: ExperienceDefinitionV1,
  registry: SemanticRegistry,
): SemanticRegistry {
  const derived = derivedBandDimensions(definition, registry);
  if (derived.length === 0) return registry;
  return { ...registry, dimensions: [...registry.dimensions, ...derived] };
}

/** The handle-to-column index, plus one column per derived characteristic. */
export function indexWithDerivedBands(
  definition: ExperienceDefinitionV1,
  index: RegistryKeyIndex,
): RegistryKeyIndex {
  const derived = filterableSchemes(definition);
  if (derived.length === 0) return index;
  return {
    ...index,
    dimensions: {
      ...index.dimensions,
      ...Object.fromEntries(derived.map((scheme) => [scheme.id, bandColumnKey(scheme.id)])),
    },
  };
}

/**
 * The study's rows, with one extra column per derived characteristic.
 *
 * A RESPONDENT IS CLASSIFIED BY THEIR OWN ANSWER, once, and the label is
 * written onto EVERY row of that respondent — which is what makes filtering by
 * "Rojo" narrow all of their answers rather than only the one the score came
 * from. A respondent who never answered the classified result gets the empty
 * string, which is what every unanswered characteristic already looks like on a
 * long row, so they fall out of a narrowing rather than into a band.
 *
 * Pure, and it copies rather than mutating: the rows it is given are the ones
 * the canonical loader produced, and a surface that did not ask for derived
 * characteristics must see exactly those.
 */
export function withDerivedBandColumns(
  rows: readonly LongRow[],
  definition: ExperienceDefinitionV1,
  index: RegistryKeyIndex,
): readonly LongRow[] {
  const schemes = filterableSchemes(definition);
  if (schemes.length === 0) return rows;

  const resolved = schemes.flatMap((scheme) => {
    const metricKey = scheme.filterMetricId ? index.metrics[scheme.filterMetricId] : undefined;
    return metricKey ? [{ scheme, metricKey, column: bandColumnKey(scheme.id) }] : [];
  });
  if (resolved.length === 0) return rows;

  // One pass to read each respondent's own answer to each classified result.
  const byRespondent = new Map<string, Map<string, string>>();
  for (const row of rows) {
    for (const entry of resolved) {
      if (row.metric_key !== entry.metricKey) continue;
      const verdict = classify(entry.scheme, row.value);
      if (verdict.kind !== "band") continue;
      const forRespondent = byRespondent.get(String(row.respondent_id)) ?? new Map<string, string>();
      forRespondent.set(entry.column, verdict.band.label);
      byRespondent.set(String(row.respondent_id), forRespondent);
    }
  }

  return rows.map((row) => {
    const forRespondent = byRespondent.get(String(row.respondent_id));
    const extra: Record<string, string> = {};
    for (const entry of resolved) {
      extra[entry.column] = forRespondent?.get(entry.column) ?? "";
    }
    return { ...row, ...extra };
  });
}
