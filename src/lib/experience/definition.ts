/**
 * `ExperienceDefinitionV1` — everything a composed client experience IS.
 *
 * WHAT THIS DOCUMENT MAY CONTAIN: pages, sections, blocks, layout, chart
 * choices, filters, connections, journeys, authored copy, and references — by
 * opaque id — to results and characteristics the server already knows about.
 *
 * WHAT IT MAY NEVER CONTAIN, AND WHY THE SCHEMA IS BUILT THE WAY IT IS:
 *
 *  - No SQL, no JavaScript, no HTML, no CSS, no template expression. Every
 *    authored string passes `src/lib/experience/text.ts`, which refuses the
 *    syntax of all four rather than trusting the renderer to neutralize it.
 *  - No database key. A block references a REGISTRY HANDLE, and a handle is
 *    accepted only when it is present in the registry the server built for that
 *    exact study of that exact tenant. The mapping from handle to canonical
 *    metric key never leaves the server and is never part of this document.
 *  - No colour, size or spacing expressed as CSS. Colour is a role from a
 *    closed set; width is a column count on a fixed grid.
 *  - No respondent. Not an id, not an answer, not a quote. A definition
 *    describes how to ASK for numbers; it never carries them, so a definition
 *    can be copied between studies without carrying anybody's data with it.
 *  - No unknown field, anywhere. Every object is strict, so a document that
 *    grew a property somewhere is rejected rather than silently half-read.
 *
 * The schema is the boundary, and it runs ON THE SERVER. A composer that
 * validated only in the browser would be a composer whose rules an attacker
 * skips by posting the document directly.
 */

import { z } from "zod";

import { BLOCK_SPECS, BLOCK_TYPES, type BlockType } from "./blocks";
import { CHART_PALETTES, CHART_VARIANTS, type ChartVariant } from "./charts";
import { BAND_COLOR_ROLES, BAND_SHAPES, BAND_SOURCES } from "./bands";
import { isExperienceId, type IdKind } from "./ids";
import { BREAKPOINTS, type ResponsiveLayout } from "./layout";
import { EXPERIENCE_LIMITS } from "./limits";
import { AGGREGATIONS, METRIC_FAMILIES, type Aggregation, type MetricFamily, type NumberFormat } from "./registry";
import {
  APPROVAL_INVALIDATION_REASONS,
  REVIEW_STATUSES,
  type ExperiencePublication,
  type ExperienceReview,
} from "./review";
import {
  SAMPLE_POLICY_MODES,
  SAMPLE_POLICY_VERSION,
  type SamplePolicyOverride,
  type SampleVisibilityPolicy,
} from "./sample-policy";
import { isSafeAuthoredText, isSafeStoredValue } from "./text";

/** The only schema version this build writes. See `migrate.ts` for the rest. */
export const EXPERIENCE_SCHEMA_VERSION = 3;

const L = EXPERIENCE_LIMITS;

// ---------------------------------------------------------------------------
// The three kinds of string a definition may hold
// ---------------------------------------------------------------------------

/** An identifier the composer minted. Opaque, fixed shape, one exact kind. */
const identifier = (kind: IdKind) =>
  z.string().refine((value) => isExperienceId(value, kind), {
    message: `must be a ${kind} identifier minted by the composer`,
  });

/** Prose a person typed. Trimmed, bounded, and free of the four languages. */
const authored = (max: number) =>
  z.string().trim().max(max).refine(isSafeAuthoredText, {
    message: "authored text may not contain markup, script, style or query syntax",
  });

/**
 * A handle into the semantic registry.
 *
 * The grammar is narrow because the registry authors these, never an operator.
 * Passing the grammar is NOT authorization: `validateExperienceDefinition`
 * additionally requires the handle to be present in the study's own registry,
 * so a well-shaped handle from another study fails to resolve.
 */
const semanticId = z.string().min(1).max(63).regex(/^[a-z][a-z0-9_]*$/, {
  message: "semantic handles are lowercase words minted by the registry",
});

/** A value the study already stores — a segment value, a period name. */
const storedValue = z.string().min(1).max(240).refine(isSafeStoredValue, {
  message: "stored values may not contain markup, script, style or query syntax",
});

// ---------------------------------------------------------------------------
// Sample visibility
// ---------------------------------------------------------------------------

export const samplePolicySchema = z.strictObject({
  policyVersion: z.literal(SAMPLE_POLICY_VERSION),
  mode: z.enum(SAMPLE_POLICY_MODES),
  threshold: z.number().int().min(1).max(100_000),
});

export const samplePolicyOverrideSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("inherit") }),
  z.strictObject({ kind: z.literal("override"), policy: samplePolicySchema }),
]);

// ---------------------------------------------------------------------------
// Presentation vocabulary — closed sets, never free CSS
// ---------------------------------------------------------------------------

export const COLOR_ROLES = [
  "default",
  "evidence",
  "voice",
  "sky",
  "magenta",
  "green",
  "yellow",
  "lavender",
  "caution",
  "positive",
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

export const NUMBER_SUFFIXES = ["none", "percent", "points", "currency_mxn", "people"] as const;

export const numberFormatSchema = z.strictObject({
  decimals: z.number().int().min(0).max(4),
  suffix: z.enum(NUMBER_SUFFIXES),
  grouped: z.boolean(),
});

export const presentationSchema = z.strictObject({
  emphasis: z.enum(["lead", "normal", "quiet"]),
  tone: z.enum(["neutral", "evidence", "voice", "caution", "positive"]),
  colorRole: z.enum(COLOR_ROLES),
  /** Whether the base behind the number is stated next to it. */
  showSampleNote: z.boolean(),
  /** Whether the "how this was measured" disclosure is offered. */
  showMethodology: z.boolean(),
});
export type BlockPresentation = z.infer<typeof presentationSchema>;

export const visualizationSchema = z.strictObject({
  variant: z.enum(CHART_VARIANTS),
  legend: z.enum(["auto", "hidden", "below", "right"]),
  showValueLabels: z.boolean(),
  axisLabel: authored(L.titleLength).nullable(),
  /**
   * The palette a scaled drawing reads its colours from — a heat map's ramp, a
   * treemap's fill, a bubble's series. A ROLE from a closed set, never a hex an
   * operator typed: the brand resolves it, and a palette nobody can author
   * cannot become a contrast failure somebody has to discover on a client's
   * screen. `auto` lets the block type choose the one that suits it.
   */
  palette: z.enum(CHART_PALETTES),
});
export type BlockVisualization = z.infer<typeof visualizationSchema>;

// ---------------------------------------------------------------------------
// Semáforo — reusable band schemes, declared once and referenced by id
// ---------------------------------------------------------------------------

const bandBoundSchema = z.strictObject({
  value: z.number().finite().min(-1_000_000).max(1_000_000).nullable(),
  inclusive: z.boolean(),
});

export const bandSchema = z.strictObject({
  id: identifier("bandpart"),
  label: authored(L.titleLength),
  colorRole: z.enum(BAND_COLOR_ROLES),
  shape: z.enum(BAND_SHAPES),
  /** What being in this band MEANS. Required: a colour with no sentence is a mood. */
  meaning: authored(L.titleLength),
  lower: bandBoundSchema,
  upper: bandBoundSchema,
  values: z.array(storedValue).max(L.defaultValuesPerFilter),
});

export const bandSchemeSchema = z
  .strictObject({
    id: identifier("band"),
    title: authored(L.titleLength),
    description: authored(L.bodyLength).nullable(),
    source: z.enum(BAND_SOURCES),
    scale: z
      .strictObject({
        minimum: z.number().finite().min(-1_000_000).max(1_000_000),
        maximum: z.number().finite().min(-1_000_000).max(1_000_000),
      })
      .nullable(),
    bands: z.array(bandSchema).max(L.bandsPerScheme),
    noDataLabel: authored(L.titleLength),
    /**
     * THE RESULT THIS SCHEME CLASSIFIES, when it is also offered as a filter.
     *
     * A study can record a performance SCORE and no performance CATEGORY —
     * the real one records `desempeño` as a number from 25 to 93 and has no
     * "Verde" anywhere. Offering "Desempeño: Verde / Amarillo / Rojo" as a
     * filter therefore needs a rule for turning the number into a category,
     * and the ONLY acceptable rule is the one a person already wrote down here.
     *
     * WHAT THIS IS NOT: percentiles of the study's own distribution. "The
     * worst third of this chapter" is a different statement from "below the
     * standard", and deriving one from the other would put a verdict on a
     * client's screen that nobody agreed to. Null means the scheme colours
     * results and offers no filter, which is the honest state until somebody
     * says what the bands mean.
     */
    filterMetricId: semanticId.nullable(),
    /** What the derived characteristic is called in a filter control. */
    filterLabel: authored(L.titleLength).nullable(),
  })
  .superRefine((scheme, context) => {
    const ids = scheme.bands.map((band) => band.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["bands"], message: "repeated band" });
    }
    if (scheme.scale && scheme.scale.minimum >= scheme.scale.maximum) {
      context.addIssue({ code: "custom", path: ["scale"], message: "empty scale" });
    }
    /*
     * A HALF-BUILT SCHEME IS SAVEABLE; A DISHONEST ONE IS NOT.
     *
     * Overlaps, gaps and missing meanings are SOFT — a person passes through
     * every one of them while building a scheme, and refusing the save in
     * between is how a tool stops being usable (`validate.ts` says them next to
     * the controls). What the boundary refuses is a document that could not be
     * read at all: a categorical band carrying numeric bounds, or a numeric one
     * carrying category values. Those are not states somebody is passing
     * through; they are two schemes in one object.
     */
    for (const band of scheme.bands) {
      if (scheme.source === "category" && (band.lower.value !== null || band.upper.value !== null)) {
        context.addIssue({
          code: "custom",
          path: ["bands"],
          message: "a categorical band carries values, not bounds",
        });
        break;
      }
      if (scheme.source === "numeric" && band.values.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["bands"],
          message: "a numeric band carries bounds, not values",
        });
        break;
      }
    }
  });

export type BandSchemeDocument = z.infer<typeof bandSchemeSchema>;

// ---------------------------------------------------------------------------
// The thematic cloud — what it counts, and how it is drawn
// ---------------------------------------------------------------------------

/**
 * WHICH NUMBER THE WORDS ARE SIZED BY, said out loud on the drawing.
 *
 * `mentions` is how many confirmed observations carry the theme. `people` is
 * how many distinct voices are behind it. They are different numbers — one
 * person saying the same thing three times is 3 and 1 — and a cloud that
 * silently used one while its caption implied the other would be a wrong
 * number with a font size. So the basis is a choice, it is stored, and the
 * renderer prints which one it used.
 */
export const THEME_COUNT_BASIS = ["mentions", "people"] as const;
export type ThemeCountBasis = (typeof THEME_COUNT_BASIS)[number];

/** How words are turned to fill a box. Deterministic in every case. */
export const THEME_ORIENTATIONS = ["horizontal", "mostly_horizontal", "mixed"] as const;
export type ThemeOrientation = (typeof THEME_ORIENTATIONS)[number];

export const themeCloudConfigSchema = z
  .strictObject({
    basis: z.enum(THEME_COUNT_BASIS),
    /** Words beyond this are summarized rather than dropped in silence. */
    maximumThemes: z.number().int().min(3).max(L.themesPerCloud),
    minimumFontSize: z.number().int().min(8).max(48),
    maximumFontSize: z.number().int().min(12).max(96),
    orientation: z.enum(THEME_ORIENTATIONS),
    palette: z.enum(CHART_PALETTES),
    /** Whether the count is written beside the word as well as encoded in its size. */
    showCounts: z.boolean(),
    /**
     * Which qualitative source this cloud reads, or null for all of them. It is
     * how two clouds on one page can say different things — "lo que dijeron en
     * la encuesta" beside "lo que dijeron en el focus group" — without either
     * of them being a filter of the other.
     */
    source: storedValue.nullable(),
  })
  .superRefine((config, context) => {
    if (config.minimumFontSize >= config.maximumFontSize) {
      context.addIssue({
        code: "custom",
        path: ["maximumFontSize"],
        message: "the largest word must be larger than the smallest",
      });
    }
  });

export type ThemeCloudConfig = z.infer<typeof themeCloudConfigSchema>;

// ---------------------------------------------------------------------------
// The two kinds of filter, kept apart on purpose
// ---------------------------------------------------------------------------

/**
 * A narrowing an author fixed on one block. Self-contained: a characteristic
 * and the values it is held to, named directly rather than through a viewer
 * control that somebody could delete.
 */
export const fixedFilterSchema = z
  .strictObject({
    dimensionId: semanticId,
    values: z.array(storedValue).min(1).max(L.defaultValuesPerFilter),
  })
  .superRefine((filter, context) => {
    if (new Set(filter.values).size !== filter.values.length) {
      context.addIssue({ code: "custom", path: ["values"], message: "repeated value" });
    }
  });

export type FixedFilter = z.infer<typeof fixedFilterSchema>;

/**
 * WHAT A VISIBLE PANEL MOVES.
 *
 * Four answers, and they are deliberately not the same mechanism:
 *
 *   `experience`  every compatible block in the whole experience
 *   `page`        every compatible block on the page the panel sits on
 *   `sections`    the named sections, and the blocks that follow each one
 *   `blocks`      exactly the blocks named
 *
 * The first two RESOLVE at render time, so a block added later automatically
 * joins what the panel already governs — which is what "every compatible
 * block" has to mean if it is not to quietly go stale. The last two are BY ID
 * and stay by id: renaming a section or a block never changes what a panel
 * moves, and an id naming nothing is a hard validation error rather than a
 * silently dropped connection.
 */
export const FILTER_TARGET_KINDS = ["experience", "page", "sections", "blocks"] as const;
export type FilterTargetKind = (typeof FILTER_TARGET_KINDS)[number];

export const filterTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("experience") }),
  z.strictObject({ kind: z.literal("page") }),
  z.strictObject({
    kind: z.literal("sections"),
    sectionIds: z.array(identifier("block")).min(1).max(L.blocksPerPage),
  }),
  z.strictObject({
    kind: z.literal("blocks"),
    blockIds: z.array(identifier("block")).min(1).max(L.blocksPerConnection),
  }),
]);

export type FilterTarget = z.infer<typeof filterTargetSchema>;

export const FILTER_PANEL_LAYOUTS = ["inline", "stacked", "grid"] as const;
export type FilterPanelLayout = (typeof FILTER_PANEL_LAYOUTS)[number];

/**
 * PANEL DE FILTROS PARA EXPLORAR — how one visible panel presents itself and
 * what it governs. The controls it offers are its `filterRefs`, in that order.
 */
export const filterPanelSchema = z.strictObject({
  /** The sentence under the panel's title that says what it is for. */
  intro: authored(L.bodyLength).nullable(),
  layout: z.enum(FILTER_PANEL_LAYOUTS),
  /** Whether "Limpiar filtros" is offered. */
  showClear: z.boolean(),
  /** Whether the choices in force are listed above the controls. */
  showActive: z.boolean(),
  target: filterTargetSchema,
});

export type FilterPanel = z.infer<typeof filterPanelSchema>;

// ---------------------------------------------------------------------------
// The query one block asks
// ---------------------------------------------------------------------------

export const blockQuerySchema = z
  .strictObject({
    /** A registry handle for the result. Never a metric key. */
    metricId: semanticId,
    aggregation: z.enum(AGGREGATIONS),
    primaryDimensionId: semanticId.nullable(),
    secondaryDimensionId: semanticId.nullable(),
    /**
     * FILTRO FIJO DEL BLOQUE — the narrowing the AUTHOR fixed, permanently.
     * "This chart is always about the people who renewed."
     *
     * IT CARRIES ITS OWN CHARACTERISTIC AND VALUES, and that is the point of
     * the shape. Until version 2 this was a list of `filterDefinition` ids,
     * which made an author's permanent restriction depend on a viewer control
     * existing — delete the control and the block's meaning changed. The two
     * concepts are now different things in the document as well as in the UI:
     *
     *   `fixedFilters`      what this block is ALWAYS about        (author)
     *   `filterDefinitions` + `filterPanel` + `filterConnections`
     *                       what the READER may change temporarily (viewer)
     *
     * A fixed filter is applied before anything a reader chooses, and no
     * reader choice can widen past it.
     */
    fixedFilters: z.array(fixedFilterSchema).max(L.filterRefsPerBlock),
    sort: z.strictObject({
      by: z.enum(["value", "label", "dimension_order"]),
      direction: z.enum(["asc", "desc"]),
    }),
    topN: z.number().int().min(1).max(L.topN).nullable(),
    period: z.strictObject({
      kind: z.enum(["latest", "all", "named"]),
      periodId: storedValue.nullable(),
    }),
    /**
     * What the number is read against.
     *
     * `target` carries an IDEAL RANGE rather than a single number, because
     * that is the shape the product already ships: a study configures one
     * result with a minimum, a maximum and the words to use when the value
     * falls outside them (`presentation.threshold` in
     * `src/lib/dashboard/config.ts`). Either bound may be open — "at least
     * eight" and "no more than three" are both real targets — and the label is
     * authored prose held to the same standard as every other authored string.
     */
    comparison: z.strictObject({
      kind: z.enum(["none", "previous_period", "study_average", "target"]),
      target: z.number().finite().nullable(),
      targetMaximum: z.number().finite().nullable(),
      targetLabel: authored(L.titleLength).nullable(),
    }),
    numberFormat: numberFormatSchema,
    samplePolicy: samplePolicyOverrideSchema,
  })
  .superRefine((query, context) => {
    if (query.secondaryDimensionId && !query.primaryDimensionId) {
      context.addIssue({
        code: "custom",
        path: ["secondaryDimensionId"],
        message: "a second characteristic needs a first one",
      });
    }
    if (query.secondaryDimensionId && query.secondaryDimensionId === query.primaryDimensionId) {
      context.addIssue({
        code: "custom",
        path: ["secondaryDimensionId"],
        message: "a result cannot be crossed with the same characteristic twice",
      });
    }
    if (query.period.kind === "named" && !query.period.periodId) {
      context.addIssue({ code: "custom", path: ["period", "periodId"], message: "name the period" });
    }
    if (query.period.kind !== "named" && query.period.periodId) {
      context.addIssue({
        code: "custom",
        path: ["period", "periodId"],
        message: "only a named period carries a period name",
      });
    }
    if (
      query.comparison.kind === "target"
      && query.comparison.target === null
      && query.comparison.targetMaximum === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["comparison", "target"],
        message: "a target comparison needs a minimum, a maximum, or both",
      });
    }
    if (
      query.comparison.kind !== "target"
      && (query.comparison.target !== null
        || query.comparison.targetMaximum !== null
        || query.comparison.targetLabel !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["comparison", "target"],
        message: "only a target comparison carries a target",
      });
    }
    if (
      query.comparison.target !== null
      && query.comparison.targetMaximum !== null
      && query.comparison.target > query.comparison.targetMaximum
    ) {
      context.addIssue({
        code: "custom",
        path: ["comparison", "targetMaximum"],
        message: "the ideal range ends before it starts",
      });
    }
    const fixedDimensions = query.fixedFilters.map((filter) => filter.dimensionId);
    if (new Set(fixedDimensions).size !== fixedDimensions.length) {
      context.addIssue({
        code: "custom",
        path: ["fixedFilters"],
        message: "repeated characteristic in the block's fixed filter",
      });
    }
  });

export type BlockQuerySpec = z.infer<typeof blockQuerySchema>;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const placementSchema = z.strictObject({
  order: z.number().int().min(0).max(10_000),
  span: z.number().int().min(1).max(L.gridColumns),
  visible: z.boolean(),
});

export const responsiveLayoutSchema = z.strictObject(
  Object.fromEntries(BREAKPOINTS.map((breakpoint) => [breakpoint, placementSchema])) as Record<
    (typeof BREAKPOINTS)[number],
    typeof placementSchema
  >,
);

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const copySchema = z.strictObject({
  eyebrow: authored(L.titleLength).nullable(),
  body: authored(L.bodyLength).nullable(),
  caption: authored(L.titleLength).nullable(),
  items: z.array(authored(L.titleLength)).max(12),
});

const imageSchema = z.strictObject({
  /** An asset the client already has. A handle, never a URL an operator typed. */
  assetId: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9_-]*$/),
  alt: authored(L.titleLength),
});

export const experienceBlockSchema = z
  .strictObject({
    id: identifier("block"),
    type: z.enum(BLOCK_TYPES),
    title: authored(L.titleLength).nullable(),
    copy: copySchema,
    query: blockQuerySchema.nullable(),
    visualization: visualizationSchema.nullable(),
    journeyRef: identifier("journey").nullable(),
    image: imageSchema.nullable(),
    /** Present exactly on a `filter_panel`, absent everywhere else. */
    filterPanel: filterPanelSchema.nullable(),
    /**
     * The semáforo this block reads its colours from, when it is drawn as one.
     * Null means "not configured", which the renderer says out loud rather than
     * colouring the number anyway.
     */
    bandSchemeId: identifier("band").nullable(),
    /** Present exactly on a `theme_cloud`, absent everywhere else. */
    themeCloud: themeCloudConfigSchema.nullable(),
    /**
     * Filters whose CONTROL this block hosts — the "block filters" of the
     * design. Which blocks a filter DRIVES is a separate, explicit statement in
     * `filterConnections`; hosting a control and answering to it are two
     * different things and are stored as two different things.
     */
    filterRefs: z.array(identifier("filter")).max(L.filtersPerPanel),
    samplePolicy: samplePolicyOverrideSchema,
    presentation: presentationSchema,
    /** Hidden blocks stay in the document, in place, and render nowhere. */
    visible: z.boolean(),
    layout: responsiveLayoutSchema,
  })
  .superRefine((block, context) => {
    const spec = BLOCK_SPECS[block.type as BlockType];
    if (!spec) return;
    if (spec.requiresQuery && !block.query) {
      context.addIssue({ code: "custom", path: ["query"], message: `${spec.label} needs a result` });
    }
    if (!spec.allowsQuery && block.query) {
      context.addIssue({
        code: "custom",
        path: ["query"],
        message: `${spec.label} does not read a result`,
      });
    }
    if (spec.allowsVisualization && !block.visualization) {
      context.addIssue({
        code: "custom",
        path: ["visualization"],
        message: `${spec.label} needs a way of being drawn`,
      });
    }
    if (!spec.allowsVisualization && block.visualization) {
      context.addIssue({
        code: "custom",
        path: ["visualization"],
        message: `${spec.label} is not drawn as a graphic`,
      });
    }
    if (
      block.visualization
      && !(spec.variants as readonly string[]).includes(block.visualization.variant)
    ) {
      context.addIssue({
        code: "custom",
        path: ["visualization", "variant"],
        message: `${spec.label} cannot be drawn that way`,
      });
    }
    if (spec.requiresJourney && !block.journeyRef) {
      context.addIssue({
        code: "custom",
        path: ["journeyRef"],
        message: `${spec.label} needs a journey`,
      });
    }
    if (!spec.requiresJourney && block.journeyRef) {
      context.addIssue({
        code: "custom",
        path: ["journeyRef"],
        message: `${spec.label} does not carry a journey`,
      });
    }
    // HOSTING, not responding. `filterRefs` is where a block OFFERS a
    // reader's controls; being moved by one is `filterConnections` and a
    // panel's target, and the two have never been the same question. They used
    // to share one boolean, which is how a paragraph came to be offered the
    // whole characteristic registry.
    if (!spec.capabilities.hostsFilterControls && block.filterRefs.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["filterRefs"],
        message: `${spec.label} does not host a filter`,
      });
    }
    // The array's own ceiling is the panel's. An ordinary block is held to the
    // smaller one here, so the two numbers stay two numbers.
    if (block.type !== "filter_panel" && block.filterRefs.length > L.filterRefsPerBlock) {
      context.addIssue({
        code: "custom",
        path: ["filterRefs"],
        message: `a block hosts at most ${L.filterRefsPerBlock} controls`,
      });
    }
    if (new Set(block.filterRefs).size !== block.filterRefs.length) {
      context.addIssue({ code: "custom", path: ["filterRefs"], message: "repeated filter" });
    }
    // A cloud's configuration belongs to a cloud. The same rule `filterPanel`
    // and `image` already live under: the field is present on exactly the type
    // it means something for, so a document can never carry two answers to
    // "how is this drawn".
    if (block.type === "theme_cloud" && !block.themeCloud) {
      context.addIssue({ code: "custom", path: ["themeCloud"], message: "a cloud needs its settings" });
    }
    if (block.type !== "theme_cloud" && block.themeCloud) {
      context.addIssue({
        code: "custom",
        path: ["themeCloud"],
        message: "only a theme cloud carries cloud settings",
      });
    }
    if (!spec.allowsSamplePolicyOverride && block.samplePolicy.kind === "override") {
      context.addIssue({
        code: "custom",
        path: ["samplePolicy"],
        message: `${spec.label} follows the study's rule`,
      });
    }
    if (spec.copy === "none" && (block.copy.body || block.copy.items.length > 0)) {
      context.addIssue({ code: "custom", path: ["copy"], message: `${spec.label} carries no text` });
    }
    if (block.type === "image" && !block.image) {
      context.addIssue({ code: "custom", path: ["image"], message: "an image needs an image" });
    }
    if (block.type !== "image" && block.image) {
      context.addIssue({ code: "custom", path: ["image"], message: "only an image block carries one" });
    }
    if (block.type === "filter_panel" && !block.filterPanel) {
      context.addIssue({
        code: "custom",
        path: ["filterPanel"],
        message: "a filter panel needs its configuration",
      });
    }
    if (block.type !== "filter_panel" && block.filterPanel) {
      context.addIssue({
        code: "custom",
        path: ["filterPanel"],
        message: "only a filter panel carries a panel configuration",
      });
    }
    // A panel that offers no control is a heading pretending to be a control.
    // It is allowed to exist while it is being built, so this is not an error
    // here; `validate.ts` says it as a soft warning, next to the choice.
  });

export type ExperienceBlock = z.infer<typeof experienceBlockSchema>;

// ---------------------------------------------------------------------------
// Filters and their connections
// ---------------------------------------------------------------------------

export const FILTER_SCOPES = ["global", "page", "block"] as const;
export type FilterScope = (typeof FILTER_SCOPES)[number];

export const filterDefinitionSchema = z
  .strictObject({
    id: identifier("filter"),
    /** The characteristic the filter is over. A registry handle. */
    dimensionId: semanticId,
    label: authored(L.titleLength),
    control: z.enum(["single_select", "multi_select"]),
    defaultValues: z.array(storedValue).max(L.defaultValuesPerFilter),
    /** Whether the client sees the control, or only inherits its effect. */
    clientVisible: z.boolean(),
    scope: z.enum(FILTER_SCOPES),
    /** Required for a page-scoped filter, forbidden otherwise. */
    pageId: identifier("page").nullable(),
    /** A cascading filter narrows the options of the one it depends on. */
    dependsOn: identifier("filter").nullable(),
  })
  .superRefine((filter, context) => {
    if (filter.scope === "page" && !filter.pageId) {
      context.addIssue({ code: "custom", path: ["pageId"], message: "a page filter names its page" });
    }
    if (filter.scope !== "page" && filter.pageId) {
      context.addIssue({ code: "custom", path: ["pageId"], message: "only a page filter names a page" });
    }
    if (filter.control === "single_select" && filter.defaultValues.length > 1) {
      context.addIssue({
        code: "custom",
        path: ["defaultValues"],
        message: "a single-choice filter has at most one default",
      });
    }
    if (filter.dependsOn === filter.id) {
      context.addIssue({ code: "custom", path: ["dependsOn"], message: "a filter cannot depend on itself" });
    }
    if (new Set(filter.defaultValues).size !== filter.defaultValues.length) {
      context.addIssue({ code: "custom", path: ["defaultValues"], message: "repeated default" });
    }
  });

export type FilterDefinition = z.infer<typeof filterDefinitionSchema>;

/**
 * WHICH BLOCKS A FILTER ACTUALLY MOVES.
 *
 * This is the whole reason the structure exists. Sharing a characteristic is
 * not a connection: two charts can both be broken down by generation and only
 * one of them may be meant to follow the reader's choice. Nothing is ever
 * matched by key; a block responds when, and only when, a connection names it.
 */
export const filterConnectionSchema = z
  .strictObject({
    id: identifier("connection"),
    filterId: identifier("filter"),
    blockIds: z.array(identifier("block")).max(L.blocksPerConnection),
  })
  .superRefine((connection, context) => {
    if (new Set(connection.blockIds).size !== connection.blockIds.length) {
      context.addIssue({ code: "custom", path: ["blockIds"], message: "repeated block" });
    }
  });

export type FilterConnection = z.infer<typeof filterConnectionSchema>;

// ---------------------------------------------------------------------------
// Journeys — many of them, independent of one another
// ---------------------------------------------------------------------------

export const JOURNEY_VARIANTS = ["stepped", "linear", "grid"] as const;

/**
 * "NO SABÍA QUE EXISTÍA ESTE MOMENTO", CONFIGURED RATHER THAN INFERRED.
 *
 * A separate result, because it is a separate question: how many people did
 * not know the touchpoint was there. Modelled explicitly so it can never be
 * confused with a low score — a moment nobody knew about and a moment everybody
 * disliked are opposite findings.
 *
 * `values` is the part that matters and the part that used to be missing. A
 * blank answer, a skipped question and an invalid entry are NOT "did not know
 * it": they are an absence, and counting an absence as an answer is how a
 * percentage gets a numerator nobody supplied. So the exact recorded values
 * that mean "did not know" are named here, by a person, and nothing else counts.
 *
 * `base` says which people are the denominator: everyone who answered the
 * awareness question at all. Somebody who skipped it is in neither half.
 */
export const journeyAwarenessSchema = z
  .strictObject({
    metricId: semanticId,
    label: authored(L.titleLength).nullable(),
    /** The exact recorded values that mean "no lo conocía". Never inferred. */
    values: z.array(storedValue).min(1).max(L.defaultValuesPerFilter),
  })
  .superRefine((awareness, context) => {
    if (new Set(awareness.values).size !== awareness.values.length) {
      context.addIssue({ code: "custom", path: ["values"], message: "repeated value" });
    }
  });

export type JourneyAwareness = z.infer<typeof journeyAwarenessSchema>;

export const journeyMomentSchema = z.strictObject({
  id: identifier("moment"),
  title: authored(L.titleLength),
  description: authored(L.bodyLength).nullable(),
  /** The result this moment shows. Null while it is still being built. */
  metricId: semanticId.nullable(),
  /** How many people did not know this moment existed. Null when not asked. */
  awareness: journeyAwarenessSchema.nullable(),
  /** Prose for this moment alone, beside the number. */
  body: authored(L.bodyLength).nullable(),
  /** A drawing for this moment alone, or null to follow the journey's own. */
  variant: z.enum(CHART_VARIANTS).nullable(),
  /** A semáforo for this moment alone, or null to inherit the journey's. */
  bandSchemeId: identifier("band").nullable(),
  visible: z.boolean(),
});

export type JourneyMoment = z.infer<typeof journeyMomentSchema>;

export const journeyReferenceSchema = z
  .strictObject({
    id: identifier("journey"),
    title: authored(L.titleLength),
    description: authored(L.bodyLength).nullable(),
    /**
     * The families of results this journey may carry — usually exactly one,
     * which is what "a satisfaction recorrido" means and what stops a moment
     * about revenue from appearing inside it.
     *
     * It is a LIST rather than a single value for one reason: a journey adapted
     * from a study that already exists declares the families its moments
     * already use, so adapting can never invent a constraint the study fails.
     * A composed journey normally declares one and is held to it.
     */
    eligibleFamilies: z.array(z.enum(METRIC_FAMILIES)).min(1).max(METRIC_FAMILIES.length),
    moments: z.array(journeyMomentSchema).max(L.momentsPerJourney),
    filterRefs: z.array(identifier("filter")).max(L.filterRefsPerBlock),
    variant: z.enum(JOURNEY_VARIANTS),
    /** The semáforo every moment inherits unless it states its own. */
    bandSchemeId: identifier("band").nullable(),
    visible: z.boolean(),
    /**
     * Where the journey came from. `legacy_journey_definition` marks one
     * derived from a study's existing `journey_definition`, which remains the
     * stored, supported shape and is not migrated away by this slice.
     */
    origin: z.enum(["legacy_journey_definition", "composed"]),
    revision: z.number().int().min(1).max(1_000_000),
  })
  .superRefine((journey, context) => {
    const ids = journey.moments.map((moment) => moment.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["moments"], message: "repeated moment" });
    }
  });

export type JourneyReference = z.infer<typeof journeyReferenceSchema>;

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export const experiencePageSchema = z
  .strictObject({
    id: identifier("page"),
    title: authored(L.titleLength),
    description: authored(L.bodyLength).nullable(),
    order: z.number().int().min(0).max(10_000),
    visible: z.boolean(),
    /** Filters whose control this page hosts, above its blocks. */
    filterRefs: z.array(identifier("filter")).max(L.filterRefsPerBlock),
    blocks: z.array(experienceBlockSchema).max(L.blocksPerPage),
  })
  .superRefine((page, context) => {
    const ids = page.blocks.map((block) => block.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["blocks"], message: "repeated block" });
    }
  });

export type ExperiencePage = z.infer<typeof experiencePageSchema>;

// ---------------------------------------------------------------------------
// Identity — who the study belongs to, above the pages
// ---------------------------------------------------------------------------

/**
 * IDENTIDAD Y PORTADA DEL ESTUDIO.
 *
 * The study's own name, the organisation it was done for, the period it
 * covers, the sentence that introduces it and the mark it carries. It is a
 * GLOBAL LAYER, not a block: it renders once, before the pages, and it is
 * configured on its own.
 *
 * IT USED TO BE A `cover` BLOCK INSIDE PANORAMA, and that was wrong in a way
 * that mattered. It made the identity of the study look like ordinary
 * Panorama content: it appeared in the block count, it could be reordered
 * underneath a chart, duplicating the page duplicated the study's name, and
 * hiding Panorama hid who the report was for. Identity is not a section of the
 * report; it is what the report IS.
 *
 * Pages keep every ordinary heading and text block they had. Nothing here
 * removes the ability to write a title anywhere — it removes the accident of
 * the study's own title being one of them.
 */
export const experienceIdentitySchema = z.strictObject({
  /** Whether the identity layer renders at all. */
  visible: z.boolean(),
  /** The study's visible title, as the reader should see it. */
  title: authored(L.titleLength),
  /** The client or organisation the work was done for. */
  organization: authored(L.titleLength).nullable(),
  /** The period the study covers, in words. */
  period: authored(L.titleLength).nullable(),
  /** The paragraph that introduces the study. */
  description: authored(L.bodyLength).nullable(),
  /**
   * The identity mark. `client_brand` resolves to the client's own mark
   * through the existing brand layer; it is never a URL somebody typed, so a
   * definition cannot be made to fetch from an address of an attacker's
   * choosing.
   */
  mark: z.discriminatedUnion("source", [
    z.strictObject({ source: z.literal("none") }),
    z.strictObject({ source: z.literal("client_brand") }),
  ]),
  /** Whether the identity layer offers the report download. */
  showReportDownload: z.boolean(),
  /** Which parts are shown. Each is an independent decision. */
  show: z.strictObject({
    title: z.boolean(),
    organization: z.boolean(),
    period: z.boolean(),
    description: z.boolean(),
    mark: z.boolean(),
  }),
});

export type ExperienceIdentity = z.infer<typeof experienceIdentitySchema>;

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export const experienceThemeSchema = z.strictObject({
  /** A named palette, never a stylesheet. */
  palette: z.enum(["be_community", "client_brand"]),
  /**
   * The accent. Either the client's own brand colour, resolved at render time
   * through `src/lib/brand/contrast.ts` so it can never carry unreadable text,
   * or one exact hex chosen by the team. Six hex digits and nothing else — it
   * is a value, not a declaration.
   */
  accent: z.discriminatedUnion("source", [
    z.strictObject({ source: z.literal("client_brand") }),
    z.strictObject({ source: z.literal("custom"), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  ]),
  density: z.enum(["comfortable", "compact"]),
  /** Whether the cover carries the client's mark. */
  showClientMark: z.boolean(),
});

export type ExperienceTheme = z.infer<typeof experienceThemeSchema>;

// ---------------------------------------------------------------------------
// Review and publication — modelled, not persisted by this slice
// ---------------------------------------------------------------------------

export const reviewSchema = z.strictObject({
  status: z.enum(REVIEW_STATUSES),
  revision: z.number().int().min(1).max(1_000_000),
  authorId: z.string().uuid().nullable(),
  reviewerId: z.string().uuid().nullable(),
  publisherId: z.string().uuid().nullable(),
  changeSummary: authored(L.bodyLength).nullable(),
  approvedAt: z.string().datetime().nullable(),
  invalidationReasons: z.array(z.enum(APPROVAL_INVALIDATION_REASONS)).max(16),
});

export const publicationSchema = z.strictObject({
  snapshotId: z.string().uuid().nullable(),
  publishedAt: z.string().datetime().nullable(),
  schemaVersion: z.number().int().min(1).max(1000),
  registryVersion: z.string().max(4000).nullable(),
  dataRevision: z.string().max(200).nullable(),
  samplePolicy: samplePolicySchema.nullable(),
  categorySnapshotId: z.string().uuid().nullable(),
});

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export const experienceDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(EXPERIENCE_SCHEMA_VERSION),
    id: identifier("experience"),
    title: authored(L.titleLength),
    /** The global identity layer. Renders once, above the pages. */
    identity: experienceIdentitySchema,
    metadata: z.strictObject({
      studyId: z.string().uuid(),
      tenantId: z.string().uuid(),
      subtitle: authored(L.titleLength).nullable(),
      locale: z.enum(["es-MX"]),
    }),
    sampleVisibilityPolicy: samplePolicySchema,
    theme: experienceThemeSchema,
    pages: z.array(experiencePageSchema).max(L.pages),
    filterDefinitions: z.array(filterDefinitionSchema).max(L.filterDefinitions),
    filterConnections: z.array(filterConnectionSchema).max(L.filterConnections),
    /**
     * Reusable semáforo schemes, declared once and referenced by id from a
     * block, a journey or a single moment. Top-level rather than per-block for
     * the same reason a filter definition is: "the standard we hold a chapter
     * to" is one decision, and copying it onto every card is how two cards
     * start disagreeing about what amarillo means.
     */
    bandSchemes: z.array(bandSchemeSchema).max(L.bandSchemes),
    journeyReferences: z.array(journeyReferenceSchema).max(L.journeys),
    review: reviewSchema,
    publication: publicationSchema,
  })
  .superRefine((definition, context) => {
    const pageIds = definition.pages.map((page) => page.id);
    if (new Set(pageIds).size !== pageIds.length) {
      context.addIssue({ code: "custom", path: ["pages"], message: "repeated page" });
    }
    const blockIds = definition.pages.flatMap((page) => page.blocks.map((block) => block.id));
    if (new Set(blockIds).size !== blockIds.length) {
      context.addIssue({ code: "custom", path: ["pages"], message: "repeated block across pages" });
    }
    if (blockIds.length > L.blocks) {
      context.addIssue({
        code: "custom",
        path: ["pages"],
        message: `at most ${L.blocks} blocks in one experience`,
      });
    }
    const filterIds = definition.filterDefinitions.map((filter) => filter.id);
    if (new Set(filterIds).size !== filterIds.length) {
      context.addIssue({ code: "custom", path: ["filterDefinitions"], message: "repeated filter" });
    }
    const journeyIds = definition.journeyReferences.map((journey) => journey.id);
    if (new Set(journeyIds).size !== journeyIds.length) {
      context.addIssue({ code: "custom", path: ["journeyReferences"], message: "repeated journey" });
    }

    /*
     * A SEMÁFORO REFERENCE NAMES A SCHEME THAT IS THERE.
     *
     * The same rule every other reference in this document lives under. A
     * block, a journey or a single moment may point at a scheme; a pointer to
     * a scheme somebody deleted would leave a card asking to be coloured by
     * nothing, and "not configured" and "configured, pointing at a hole" are
     * different states that would look identical on screen.
     */
    const schemeIds = definition.bandSchemes.map((scheme) => scheme.id);
    if (new Set(schemeIds).size !== schemeIds.length) {
      context.addIssue({ code: "custom", path: ["bandSchemes"], message: "repeated band scheme" });
    }
    const knownSchemes = new Set(schemeIds);
    const schemeReferences: { id: string | null; path: (string | number)[] }[] = [
      ...definition.pages.flatMap((page, pageIndex) =>
        page.blocks.map((block, blockIndex) => ({
          id: block.bandSchemeId,
          path: ["pages", pageIndex, "blocks", blockIndex, "bandSchemeId"],
        })),
      ),
      ...definition.journeyReferences.flatMap((journey, journeyIndex) => [
        { id: journey.bandSchemeId, path: ["journeyReferences", journeyIndex, "bandSchemeId"] },
        ...journey.moments.map((moment, momentIndex) => ({
          id: moment.bandSchemeId,
          path: ["journeyReferences", journeyIndex, "moments", momentIndex, "bandSchemeId"],
        })),
      ]),
    ];
    for (const reference of schemeReferences) {
      if (reference.id && !knownSchemes.has(reference.id)) {
        context.addIssue({
          code: "custom",
          path: reference.path,
          message: "names a semáforo scheme that does not exist",
        });
      }
    }

    /*
     * A PANEL MAY NOT NAME A BLOCK THAT IS NOT THERE.
     *
     * The same rule a dangling `filterConnection` already lives under, applied
     * to the other place a block id can now appear. A target naming nothing is
     * refused rather than quietly resolving to fewer blocks than the author
     * chose — a filter that silently stops moving a chart is worse than one
     * that refuses to save.
     */
    const known = new Set(blockIds);
    const sectionIds = new Set(
      definition.pages.flatMap((page) =>
        page.blocks.filter((block) => block.type === "section").map((block) => block.id),
      ),
    );
    definition.pages.forEach((page, pageIndex) => {
      page.blocks.forEach((block, blockIndex) => {
        const target = block.filterPanel?.target;
        if (!target) return;
        const path = ["pages", pageIndex, "blocks", blockIndex, "filterPanel", "target"];
        if (target.kind === "blocks") {
          for (const id of target.blockIds) {
            if (!known.has(id)) {
              context.addIssue({ code: "custom", path, message: "the panel names a block that is not there" });
            }
          }
          if (new Set(target.blockIds).size !== target.blockIds.length) {
            context.addIssue({ code: "custom", path, message: "repeated block" });
          }
        }
        if (target.kind === "sections") {
          for (const id of target.sectionIds) {
            if (!sectionIds.has(id)) {
              context.addIssue({ code: "custom", path, message: "the panel names a section that is not there" });
            }
          }
          if (new Set(target.sectionIds).size !== target.sectionIds.length) {
            context.addIssue({ code: "custom", path, message: "repeated section" });
          }
        }
      });
    });
  });

/**
 * The typed document. Written by hand rather than inferred, so the exported
 * type is readable in an editor and a reviewer can see the shape without
 * unwrapping four layers of Zod inference.
 */
export type ExperienceDefinitionV1 = {
  schemaVersion: typeof EXPERIENCE_SCHEMA_VERSION;
  id: string;
  title: string;
  metadata: {
    studyId: string;
    tenantId: string;
    subtitle: string | null;
    locale: "es-MX";
  };
  identity: ExperienceIdentity;
  sampleVisibilityPolicy: SampleVisibilityPolicy;
  theme: ExperienceTheme;
  pages: ExperiencePage[];
  filterDefinitions: FilterDefinition[];
  filterConnections: FilterConnection[];
  bandSchemes: BandSchemeDocument[];
  journeyReferences: JourneyReference[];
  review: ExperienceReview;
  publication: ExperiencePublication;
};

export type ParseResult =
  | { ok: true; definition: ExperienceDefinitionV1 }
  | { ok: false; issues: { path: string; message: string }[] };

/**
 * THE untrusted boundary. Everything that arrives from a browser, a stored
 * blob or a template goes through here, and nothing else is trusted to have
 * done it.
 */
export function parseExperienceDefinition(value: unknown): ParseResult {
  const parsed = experienceDefinitionSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  return { ok: true, definition: parsed.data as ExperienceDefinitionV1 };
}

// ---------------------------------------------------------------------------
// Reading helpers — one place, so no surface re-derives them
// ---------------------------------------------------------------------------

export function allBlocks(definition: ExperienceDefinitionV1): ExperienceBlock[] {
  return definition.pages.flatMap((page) => page.blocks);
}

export function findBlock(
  definition: ExperienceDefinitionV1,
  blockId: string,
): { page: ExperiencePage; block: ExperienceBlock } | null {
  for (const page of definition.pages) {
    const block = page.blocks.find((candidate) => candidate.id === blockId);
    if (block) return { page, block };
  }
  return null;
}

/**
 * The blocks one filter moves. Connections only — never a key match, never a
 * shared dimension, never a heuristic.
 */
export function blocksAffectedBy(definition: ExperienceDefinitionV1, filterId: string): string[] {
  const named = definition.filterConnections
    .filter((connection) => connection.filterId === filterId)
    .flatMap((connection) => connection.blockIds);
  const existing = new Set(allBlocks(definition).map((block) => block.id));
  return [...new Set(named)].filter((id) => existing.has(id)).sort();
}

/** The filters that move one block. The same statement, read the other way. */
export function filtersAffecting(definition: ExperienceDefinitionV1, blockId: string): string[] {
  return [
    ...new Set(
      definition.filterConnections
        .filter((connection) => connection.blockIds.includes(blockId))
        .map((connection) => connection.filterId),
    ),
  ].sort();
}

/** Re-exported so callers need one import for the block vocabulary. */
export type { BlockType, ChartVariant, Aggregation, MetricFamily, NumberFormat, ResponsiveLayout, SamplePolicyOverride };
