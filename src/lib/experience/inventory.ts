/**
 * What is actually in an arrangement, described the way a person reads it.
 *
 * THIS IS THE ANSWER TO "DO NOT EXPOSE RAW JSON AS THE PRIMARY REVIEW
 * EXPERIENCE". A reviewer about to send something to a client is asking a
 * short list of concrete questions — which pages, which blocks, what is
 * hidden, which filters, how many recorridos, which semáforos, where the
 * qualitative content comes from, what the disclosure rule is, whose name is
 * on the cover — and a pretty-printed document answers none of them without
 * being read line by line.
 *
 * So the review screen reads THIS, and the technical export remains available
 * for the rare case where somebody genuinely needs the bytes.
 *
 * IT IS PURE and it describes; it never judges. Whether something is a problem
 * is `preflight.ts`'s question, and keeping the two apart means the inventory
 * can be shown for a revision that cannot be published and for one that
 * already was.
 */

import { blockSpec, type BlockType } from "./blocks";
import { CHART_SPECS, isRendererImplemented } from "./charts";
import type { ExperienceBlock, ExperienceDefinitionV1 } from "./definition";
import { effectiveFilterTargets, panelControls } from "./filters";
import { findDimension, findMetric, type SemanticRegistry } from "./registry";
import { schemeIsUsable } from "./bands";

export type PageInventory = {
  id: string;
  title: string;
  visible: boolean;
  order: number;
  /** Blocks a client would see. */
  visibleBlocks: number;
  /** Blocks that are in the document and are not shown. */
  hiddenBlocks: number;
  blocks: {
    id: string;
    label: string;
    type: BlockType;
    typeLabel: string;
    visible: boolean;
    /** The result it reads, in the reader's words. Null when it reads none. */
    result: string | null;
    /** How it is drawn, in the reader's words. Null when it draws nothing. */
    drawing: string | null;
    /** The characteristic it is broken down by. */
    brokenDownBy: string | null;
    /** Fixed narrowings the author set, which no reader can widen. */
    fixedFilters: string[];
    /** Filters a reader can move that change this block. */
    movedBy: string[];
    span: number;
  }[];
};

export type FilterInventory = {
  id: string;
  label: string;
  characteristic: string;
  control: "single_select" | "multi_select";
  clientVisible: boolean;
  scope: "global" | "page" | "block";
  /** How many blocks it actually moves, after every declaration is resolved. */
  movesBlocks: number;
  /** Whether any visible panel offers its control. */
  offered: boolean;
};

export type JourneyInventory = {
  id: string;
  title: string;
  visible: boolean;
  moments: number;
  visibleMoments: number;
  momentsWithResult: number;
  momentsWithAwareness: number;
  /** Whether any visible block shows it. */
  placed: boolean;
  semaforo: string | null;
};

export type BandInventory = {
  id: string;
  title: string;
  bands: number;
  complete: boolean;
  /** The result it classifies when it is also offered as a characteristic. */
  filterResult: string | null;
  usedBy: number;
};

export type ExperienceInventory = {
  identity: {
    visible: boolean;
    shows: string[];
    title: string | null;
    organization: string | null;
    period: string | null;
    hasDescription: boolean;
    mark: "none" | "client_brand";
    reportDownload: boolean;
  };
  samplePolicy: { mode: string; threshold: number; version: number; overrides: number };
  pages: PageInventory[];
  totals: {
    pages: number;
    visiblePages: number;
    hiddenPages: number;
    blocks: number;
    visibleBlocks: number;
    hiddenBlocks: number;
  };
  filters: FilterInventory[];
  journeys: JourneyInventory[];
  bands: BandInventory[];
  qualitative: {
    /** Distinct sources the document's clouds read, or "todas". */
    sources: string[];
    clouds: number;
  };
  /**
   * Configuration this build cannot honour — a drawing it does not implement.
   * Named rather than silently substituted.
   */
  unsupported: { blockId: string; label: string; detail: string }[];
};

const IDENTITY_PART_LABEL: Record<string, string> = {
  title: "título",
  organization: "cliente",
  period: "periodo",
  description: "introducción",
  mark: "marca",
};

function blockLabel(block: ExperienceBlock): string {
  return block.title?.trim() || blockSpec(block.type).label;
}

export function experienceInventory(
  definition: ExperienceDefinitionV1,
  registry: SemanticRegistry,
): ExperienceInventory {
  const targets = effectiveFilterTargets(definition);
  const movedByBlock = new Map<string, string[]>();
  for (const [filterId, blockIds] of targets) {
    const filter = definition.filterDefinitions.find((entry) => entry.id === filterId);
    if (!filter) continue;
    for (const blockId of blockIds) {
      const list = movedByBlock.get(blockId) ?? [];
      list.push(filter.label);
      movedByBlock.set(blockId, list);
    }
  }

  const unsupported: ExperienceInventory["unsupported"] = [];

  const pages: PageInventory[] = [...definition.pages]
    .sort((a, b) => a.order - b.order)
    .map((page) => {
      const blocks = [...page.blocks]
        .sort((a, b) => a.layout.desktop.order - b.layout.desktop.order)
        .map((block) => {
          const spec = blockSpec(block.type);
          const metric = block.query?.metricId ? findMetric(registry, block.query.metricId) : null;
          const dimension = block.query?.primaryDimensionId
            ? findDimension(registry, block.query.primaryDimensionId)
            : null;
          const variant = block.visualization?.variant ?? null;
          const chart = variant ? CHART_SPECS[variant] : null;
          if (variant && !isRendererImplemented(variant)) {
            unsupported.push({
              blockId: block.id,
              label: blockLabel(block),
              detail: `“${blockLabel(block)}” pide “${CHART_SPECS[variant].label}”, que esta versión todavía no dibuja.`,
            });
          }
          return {
            id: block.id,
            label: blockLabel(block),
            type: block.type,
            typeLabel: spec.label,
            visible: block.visible && block.layout.desktop.visible,
            result: metric ? metric.label : null,
            drawing: chart ? chart.label : null,
            brokenDownBy: dimension ? dimension.label : null,
            fixedFilters: (block.query?.fixedFilters ?? []).map((fixed) => {
              const characteristic = findDimension(registry, fixed.dimensionId);
              return `${characteristic?.label ?? "una característica"}: ${fixed.values.join(", ")}`;
            }),
            movedBy: [...new Set(movedByBlock.get(block.id) ?? [])].sort(),
            span: block.layout.desktop.span,
          };
        });
      return {
        id: page.id,
        title: page.title,
        visible: page.visible,
        order: page.order,
        visibleBlocks: blocks.filter((block) => block.visible).length,
        hiddenBlocks: blocks.filter((block) => !block.visible).length,
        blocks,
      };
    });

  const hostedFilters = new Set(
    definition.pages.flatMap((page) => [
      ...page.filterRefs,
      ...page.blocks.flatMap((block) => block.filterRefs),
    ]),
  );

  const filters: FilterInventory[] = definition.filterDefinitions.map((filter) => {
    const dimension = findDimension(registry, filter.dimensionId);
    return {
      id: filter.id,
      label: filter.label,
      characteristic: dimension?.label ?? "una característica que el estudio ya no tiene",
      control: filter.control,
      clientVisible: filter.clientVisible,
      scope: filter.scope,
      movesBlocks: targets.get(filter.id)?.size ?? 0,
      offered: hostedFilters.has(filter.id),
    };
  });

  const placedJourneys = new Set(
    definition.pages.flatMap((page) =>
      page.blocks
        .filter((block) => block.visible && block.layout.desktop.visible && block.journeyRef)
        .map((block) => block.journeyRef as string),
    ),
  );
  const schemeById = new Map(definition.bandSchemes.map((scheme) => [scheme.id, scheme]));

  const journeys: JourneyInventory[] = definition.journeyReferences.map((journey) => ({
    id: journey.id,
    title: journey.title,
    visible: journey.visible,
    moments: journey.moments.length,
    visibleMoments: journey.moments.filter((moment) => moment.visible).length,
    momentsWithResult: journey.moments.filter((moment) => moment.metricId !== null).length,
    momentsWithAwareness: journey.moments.filter((moment) => moment.awareness !== null).length,
    placed: placedJourneys.has(journey.id),
    semaforo: journey.bandSchemeId ? (schemeById.get(journey.bandSchemeId)?.title ?? null) : null,
  }));

  const schemeUsage = new Map<string, number>();
  const countScheme = (id: string | null) => {
    if (!id) return;
    schemeUsage.set(id, (schemeUsage.get(id) ?? 0) + 1);
  };
  for (const page of definition.pages) {
    for (const block of page.blocks) countScheme(block.bandSchemeId);
  }
  for (const journey of definition.journeyReferences) {
    countScheme(journey.bandSchemeId);
    for (const moment of journey.moments) countScheme(moment.bandSchemeId);
  }

  const bands: BandInventory[] = definition.bandSchemes.map((scheme) => ({
    id: scheme.id,
    title: scheme.title,
    bands: scheme.bands.length,
    complete: schemeIsUsable(scheme),
    filterResult: scheme.filterMetricId
      ? (findMetric(registry, scheme.filterMetricId)?.label ?? null)
      : null,
    usedBy: schemeUsage.get(scheme.id) ?? 0,
  }));

  const clouds = definition.pages.flatMap((page) =>
    page.blocks.filter((block) => block.type === "theme_cloud"),
  );
  const sources = [
    ...new Set(clouds.map((block) => block.themeCloud?.source ?? "todas las fuentes")),
  ].sort();

  const allBlocksFlat = definition.pages.flatMap((page) => page.blocks);
  const visibleBlocksFlat = allBlocksFlat.filter(
    (block) => block.visible && block.layout.desktop.visible,
  );

  return {
    identity: {
      visible: definition.identity.visible,
      shows: Object.entries(definition.identity.show)
        .filter(([, on]) => on)
        .map(([part]) => IDENTITY_PART_LABEL[part] ?? part),
      title: definition.identity.title || null,
      organization: definition.identity.organization,
      period: definition.identity.period,
      hasDescription: Boolean(definition.identity.description?.trim()),
      mark: definition.identity.mark.source,
      reportDownload: definition.identity.showReportDownload,
    },
    samplePolicy: {
      mode: definition.sampleVisibilityPolicy.mode,
      threshold: definition.sampleVisibilityPolicy.threshold,
      version: definition.sampleVisibilityPolicy.policyVersion,
      overrides: allBlocksFlat.filter((block) => block.query?.samplePolicy.kind === "override")
        .length,
    },
    pages,
    totals: {
      pages: definition.pages.length,
      visiblePages: definition.pages.filter((page) => page.visible).length,
      hiddenPages: definition.pages.filter((page) => !page.visible).length,
      blocks: allBlocksFlat.length,
      visibleBlocks: visibleBlocksFlat.length,
      hiddenBlocks: allBlocksFlat.length - visibleBlocksFlat.length,
    },
    filters,
    journeys,
    bands,
    qualitative: { sources, clouds: clouds.length },
    unsupported,
  };
}

/** How many controls one panel offers, for a screen that lists panels. */
export function panelSummary(
  definition: ExperienceDefinitionV1,
  block: ExperienceBlock,
): { controls: number; moves: number } {
  const controls = panelControls(definition, block);
  const targets = effectiveFilterTargets(definition);
  const moved = new Set(controls.flatMap((filter) => [...(targets.get(filter.id) ?? [])]));
  return { controls: controls.length, moves: moved.size };
}

export const SAMPLE_POLICY_WORD: Record<string, string> = {
  show_all: "se muestran todos los resultados, desde una respuesta",
  warn_below: "se muestran todos y se advierte cuando hay pocas respuestas",
  hide_below: "se ocultan los resultados con pocas respuestas",
};
