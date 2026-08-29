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
import { CHART_VARIANTS, type ChartVariant } from "./charts";
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
export const EXPERIENCE_SCHEMA_VERSION = 1;

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
});
export type BlockVisualization = z.infer<typeof visualizationSchema>;

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
     * Narrowings the AUTHOR fixed on this block — "this chart is always about
     * the people who renewed". Distinct from the filters a READER drives, which
     * are declared once in `filterDefinitions` and wired by `filterConnections`.
     */
    filterRefs: z.array(identifier("filter")).max(L.filterRefsPerBlock),
    sort: z.strictObject({
      by: z.enum(["value", "label", "dimension_order"]),
      direction: z.enum(["asc", "desc"]),
    }),
    topN: z.number().int().min(1).max(L.topN).nullable(),
    period: z.strictObject({
      kind: z.enum(["latest", "all", "named"]),
      periodId: storedValue.nullable(),
    }),
    comparison: z.strictObject({
      kind: z.enum(["none", "previous_period", "study_average", "target"]),
      target: z.number().finite().nullable(),
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
    if (query.comparison.kind === "target" && query.comparison.target === null) {
      context.addIssue({
        code: "custom",
        path: ["comparison", "target"],
        message: "a target comparison needs a target",
      });
    }
    if (query.comparison.kind !== "target" && query.comparison.target !== null) {
      context.addIssue({
        code: "custom",
        path: ["comparison", "target"],
        message: "only a target comparison carries a target",
      });
    }
    if (new Set(query.filterRefs).size !== query.filterRefs.length) {
      context.addIssue({ code: "custom", path: ["filterRefs"], message: "repeated filter" });
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
    /**
     * Filters whose CONTROL this block hosts — the "block filters" of the
     * design. Which blocks a filter DRIVES is a separate, explicit statement in
     * `filterConnections`; hosting a control and answering to it are two
     * different things and are stored as two different things.
     */
    filterRefs: z.array(identifier("filter")).max(L.filterRefsPerBlock),
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
    if (!spec.allowsFilters && block.filterRefs.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["filterRefs"],
        message: `${spec.label} does not host a filter`,
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

export const journeyMomentSchema = z.strictObject({
  id: identifier("moment"),
  title: authored(L.titleLength),
  description: authored(L.bodyLength).nullable(),
  /** The result this moment shows. Null while it is still being built. */
  metricId: semanticId.nullable(),
  /**
   * "No sabía que existía este momento." A separate result, because it is a
   * separate question: how many people did not know the touchpoint was there.
   * Modelled explicitly so it is never confused with a low score.
   */
  unawareMetricId: semanticId.nullable(),
  unawareLabel: authored(L.titleLength).nullable(),
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
  sampleVisibilityPolicy: SampleVisibilityPolicy;
  theme: ExperienceTheme;
  pages: ExperiencePage[];
  filterDefinitions: FilterDefinition[];
  filterConnections: FilterConnection[];
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
