/**
 * A SAFE STARTING LAYOUT FOR A STUDY NOBODY HAS DESIGNED FOR YET.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL.
 *
 * `cuicuilco-approved.ts` is a layout somebody designed, approved and signed
 * off for ONE study's shape. Handing it to a different study would be inventing
 * structure: it names sixteen specific handles, partitions a journey group by
 * position into two routes, and writes copy about findings that study made.
 * Given a registry that does not publish those handles it throws, which is the
 * right answer — but "it throws" is not a screen an author can work in.
 *
 * So a study the approved layout does not fit gets THIS instead: a page built
 * out of what the registry actually publishes, and nothing else. Every block
 * here exists because an entry for it came back from the registry. There is no
 * Cuicuilco structure, no invented route, no copy about somebody else's
 * findings, and no handle written down by hand.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE CALLER SUPPLIES THE VARIANT LIST.
 *
 * `COMPATIBLE_CHART_VARIANTS` says which drawings would be HONEST for a
 * semantic. It does not know which of them a component exists for — that is a
 * fact about the React library, and this layer must not know facts about the
 * React library or the dependency runs the wrong way and cycles.
 *
 * So the caller passes what it can actually draw, and this file picks the
 * authority's first choice among them. A starting document therefore never
 * opens with a block the composer would immediately have to refuse.
 *
 * It passes a FUNCTION OF THE SEMANTIC, not one flat list, and that distinction
 * was bought the expensive way. A flat list is the union of everything the
 * build draws for ANY semantic, so intersecting it with what the authority
 * permits for a PARTICULAR semantic answers the wrong question: `bar_vertical`
 * is drawn — for a distribution — and is compatible with a retention series, so
 * the intersection chose it for one, and a series has no category rows, so the
 * block opened as a heading over a blank. Drawability belongs to the PAIR
 * (variant, payload shape) and cannot be flattened into a set of variants.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  COMPATIBLE_CHART_VARIANTS,
  METHODOLOGY_DISCLOSURE_LEVELS,
  type ChartVariant,
  type PresentationSemantic,
} from "../capabilities";
import type { RegistryEntry } from "../catalog";
import {
  DEFAULT_DISPLAY_FORMAT,
  DEFAULT_SAMPLE_POLICY,
  GRID_COLUMNS,
  PRESENTATION_DOCUMENT_KIND,
  PRESENTATION_DOCUMENT_SCHEMA_VERSION,
  type PresentationBlock,
  type PresentationDocument,
} from "../document";
import { PresentationError } from "../errors";
import type { PresentationHandle } from "../handles";
import type { CanonicalPresentationRegistry } from "../registry";

export type GenericBlueprintOptions = {
  /**
   * Which variants the calling surface genuinely draws FOR A GIVEN SEMANTIC.
   *
   * It is a function of the semantic and not one flat list, and that is the
   * whole correction. A flat list was the union of everything this build draws
   * for ANY semantic, so intersecting it with what the authority permits for a
   * PARTICULAR one let `bar_vertical` — drawn for a distribution, drawn for
   * nothing series-shaped — be chosen for a retention series, which then
   * rendered as a heading over a blank.
   *
   * Drawability is a property of the PAIR (variant, payload shape). The caller
   * owns that table because it owns the components; this module only asks.
   */
  drawableFor: (semantic: PresentationSemantic) => readonly ChartVariant[];
  /**
   * What a ROUTES block may be drawn as — a separate list, deliberately.
   *
   * A `journey_routes` block is not a result bound to a journey group. Its
   * payload is `routes` — the touchpoints somebody decided each route draws —
   * while a RESULT bound to the same group resolves to a label and a count.
   * The route map draws the first and cannot draw the second, which is why
   * the implemented list for `journey_group` is deliberately EMPTY.
   *
   * Asking that list for a routes block therefore answers `null`, and the
   * journey silently disappeared from every generic layout. It is the exact
   * confusion the editor already had to correct in `addBlock`, arriving here
   * by a different door.
   */
  drawableForRoutes: readonly ChartVariant[];
  /** The title the page carries. Display text the caller already has. */
  title: string;
};

/**
 * The order sections appear in, and the reason it is this order.
 *
 * It reads as a study is read: how many people, then what they think of the
 * whole, then what happens along the way, then what they said in their own
 * words, then what a person still has to write. It is not a ranking of
 * importance — no layer here is entitled to one.
 */
const SECTION_ORDER: readonly PresentationSemantic[] = [
  "population_total",
  "population_measured",
  "population_cohorts",
  "instrument_base",
  "recommendation_score",
  "recommendation_distribution",
  "renewal_index",
  "renewal_distribution",
  "retention_series",
  "performance_series",
  "journey_group",
  "qualitative_terms",
  "editorial_slot",
];

/** How wide a semantic wants to be. A layout decision, nothing more. */
const SECTION_SPAN: Partial<Record<PresentationSemantic, number>> = {
  population_total: 4,
  population_measured: 4,
  recommendation_score: 4,
  renewal_index: 4,
  population_cohorts: 12,
  instrument_base: 12,
  recommendation_distribution: 12,
  renewal_distribution: 12,
  retention_series: 12,
  performance_series: 12,
  journey_group: 12,
  qualitative_terms: 6,
  editorial_slot: 12,
};

/**
 * The first drawing that is BOTH permitted for this semantic and drawn for it.
 *
 * The authority's order is the preference order — `COMPATIBLE_CHART_VARIANTS`
 * lists the most faithful drawing first — so the first survivor of the
 * intersection is the one to start from.
 */
function firstDrawable(
  semantic: PresentationSemantic,
  drawableFor: (semantic: PresentationSemantic) => readonly ChartVariant[],
): ChartVariant | null {
  const compatible = COMPATIBLE_CHART_VARIANTS[semantic] ?? [];
  const drawn = drawableFor(semantic);
  for (const variant of compatible) if (drawn.includes(variant)) return variant;
  return null;
}

/**
 * A block id that is derived from the HANDLE, not from a counter.
 *
 * The handle is already unique within a registry and already respects the
 * identifier grammar apart from its colon, so replacing that one character is
 * the whole transformation. A counter would make the same registry produce
 * different documents on two runs, and this builder is asked to be
 * deterministic for the same reason the approved one is: a gate has to be able
 * to write the answer down.
 */
function blockIdFor(handle: PresentationHandle): string {
  return handle.replace(":", "-");
}

export function buildGenericStartingBlueprint(
  registry: CanonicalPresentationRegistry,
  options: GenericBlueprintOptions,
): PresentationDocument {
  const bySemantic = new Map<PresentationSemantic, RegistryEntry[]>();
  for (const entry of registry.entries) {
    const bucket = bySemantic.get(entry.semantic);
    if (bucket) bucket.push(entry);
    else bySemantic.set(entry.semantic, [entry]);
  }

  const blocks: PresentationBlock[] = [];
  const common = (order: number, span: number) => ({
    copy: { title: null as string | null, description: null, annotation: null },
    placement: {
      order,
      span: { desktop: span, tablet: GRID_COLUMNS, mobile: GRID_COLUMNS },
      responsive: "reflow" as const,
    },
    visible: true,
    connectedFilterPanelIds: [] as string[],
    // Null everywhere: a starting document inherits the document's `show_all`
    // and its disclosure level. Stamping either onto every block would make a
    // decision nobody made, and a suppressing default is the exact behaviour
    // the legacy adapter had and the contract forbids.
    samplePolicy: null,
    methodologyDisclosure: null,
    displayFormat: DEFAULT_DISPLAY_FORMAT,
  });

  for (const semantic of SECTION_ORDER) {
    const entries = bySemantic.get(semantic) ?? [];
    const span = SECTION_SPAN[semantic] ?? 6;

    for (const entry of entries) {
      if (semantic === "editorial_slot") {
        blocks.push({
          ...common(blocks.length, span),
          kind: "editorial",
          id: blockIdFor(entry.handle),
          copy: { title: entry.label, description: null, annotation: null },
          slot: entry.handle,
          // Empty on purpose. The contract says this content is supplied by a
          // person or by configuration; filling it here would be this file
          // writing somebody else's paragraph.
          content: null,
        });
        continue;
      }

      if (semantic === "journey_group") {
        const variant = options.drawableForRoutes[0] ?? null;
        if (variant === null) continue;
        blocks.push({
          ...common(blocks.length, span),
          kind: "journey_routes",
          id: blockIdFor(entry.handle),
          copy: { title: entry.label, description: null, annotation: null },
          chartVariant: variant,
          // ONE route per SOURCE group, carrying exactly the touchpoints the
          // source placed in it, in the source's own order. That is the only
          // route a layer with no design brief is entitled to propose:
          // repartitioning a group into two is a presentation decision, and
          // nobody has made one for this study.
          routes: [
            {
              id: blockIdFor(entry.handle),
              title: entry.label,
              order: 0,
              sourceGroup: entry.handle,
              touchpoints: entry.members.slice(),
            },
          ],
        });
        continue;
      }

      const variant = firstDrawable(semantic, options.drawableFor);
      if (variant === null) continue;
      blocks.push({
        ...common(blocks.length, span),
        kind: "result",
        id: blockIdFor(entry.handle),
        copy: { title: entry.label, description: null, annotation: null },
        binding: entry.handle,
        chartVariant: variant,
      });
    }
  }

  if (blocks.length === 0) {
    throw new PresentationError(
      "unknown_handle",
      "este estudio no publica todavía ningún resultado que una presentación pueda nombrar.",
    );
  }

  return {
    schemaVersion: PRESENTATION_DOCUMENT_SCHEMA_VERSION,
    documentKind: PRESENTATION_DOCUMENT_KIND,
    registryVersion: registry.registryVersion,
    // Unbound, exactly like the approved blueprint. A layout is a layout; which
    // registry it answers for is the caller's explicit act.
    binding: null,
    id: "inicio-generico",
    title: options.title,
    locale: "es-MX",
    samplePolicy: DEFAULT_SAMPLE_POLICY,
    methodologyDisclosure: METHODOLOGY_DISCLOSURE_LEVELS[1] ?? METHODOLOGY_DISCLOSURE_LEVELS[0],
    pages: [{ id: "panorama", title: "Panorama del estudio", order: 0, blocks }],
  };
}
