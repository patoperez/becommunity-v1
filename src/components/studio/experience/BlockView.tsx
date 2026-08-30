"use client";

import { useMemo } from "react";

import type { BlockType } from "@/lib/experience/blocks";
import { CHART_SPECS, isRendererImplemented, alternativeVariant, type ChartVariant } from "@/lib/experience/charts";
import {
  dataKeyForBlock,
  dataKeyForAwareness,
  dataKeyForMoment,
  dataKeyForPivot,
  dataKeyForThemes,
  type BlockDataSet,
  type ResolvedBlockData,
} from "@/lib/experience/data";
import type {
  ExperienceBlock,
  ExperienceDefinitionV1,
} from "@/lib/experience/definition";
import { findMetric, type SemanticRegistry } from "@/lib/experience/registry";
import type { BandScheme } from "@/lib/experience/bands";
import {
  resolveSamplePolicy,
  type SampleVisibilityPolicy,
} from "@/lib/experience/sample-policy";
import { DEFAULT_THEME_CLOUD_OPTIONS, layoutThemeCloud } from "@/lib/experience/theme-cloud";
import type { BuilderEvidence } from "@/lib/experience/builder-workspace";

import { FilterPanelView, type ViewerContext } from "./ExploreViews";

import {
  DataTable,
  EmptyChart,
  HorizontalBars,
  JourneyChart,
  KpiChart,
  LineChart,
  PieChart,
  RetentionSeries,
  StackedBars,
  ThemeCloud,
  TrafficLightChart,
  HeatMap,
  BubbleChart,
  TreemapChart,
  UnavailableRenderer,
  VerticalBars,
  type JourneyMomentView,
  type TargetRange,
} from "./Charts";

/**
 * One block, drawn with the study's real numbers.
 *
 * THE RULE THIS COMPONENT KEEPS: it never invents a value and it never hides
 * the fact that it has none. There are exactly four honest outcomes for a block
 * that shows evidence, and each of them reads differently:
 *
 *   a number            the aggregate, through the canonical engine;
 *   no responses        nobody has answered this yet;
 *   withheld            the study's disclosure rule says not to show it;
 *   broken reference    the block points at something the study no longer has.
 *
 * A fifth outcome — "this drawing does not exist in this build" — is a property
 * of the RENDERER rather than of the data, and `UnavailableRenderer` says so by
 * name over the top of the reference representation. It is never swapped
 * silently, because a consultant who publishes a page has to have chosen the
 * picture on it.
 *
 * CONFIGURATION AND DATA ARE VISIBLY DIFFERENT THINGS. Anything the block
 * DESCRIBES — the report download, the complete inventory, the approved
 * reading, the comparison explorer — is drawn as a bordered statement of what
 * the client will get. Anything the block MEASURES is drawn as a chart with its
 * base underneath. A reader of this screen can always tell which of the two
 * they are looking at.
 */

export type BlockViewProps = {
  block: ExperienceBlock;
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  data: BlockDataSet;
  evidence: BuilderEvidence;
  study: { name: string; clientName: string; period: string | null };
  /**
   * Present only where a reader is actually exploring — the internal draft
   * preview. On the builder's canvas it is absent and a filter panel draws the
   * same controls inert, so composing shows what the client will see without
   * the author's own clicks moving numbers underneath their edit.
   */
  viewer?: ViewerContext;
};

const CONFIG_FRAME =
  "rounded-lg border border-dashed border-line-strong bg-surface-sunken px-3 py-2.5 text-sm";

export function BlockView(props: BlockViewProps) {
  const { block, definition } = props;
  const policy = resolveSamplePolicy(definition.sampleVisibilityPolicy, block.samplePolicy);

  switch (block.type as BlockType) {
    case "divider":
      return <hr className="my-2 border-t border-line-strong" />;
    case "spacer":
      return <div className="h-8" aria-hidden="true" />;
    case "cover":
      return <CoverBlock {...props} />;
    case "section":
      return (
        <p className="border-l-4 border-evidence-line pl-3 font-display text-base font-semibold text-strong">
          {block.title ?? "Sección"}
        </p>
      );
    case "rich_text":
    case "recommendation":
      return <ProseBlock block={block} />;
    case "interpretation":
      return <InterpretationBlock />;
    case "finding":
      return <FindingBlock {...props} policy={policy} />;
    case "image":
      return (
        <div className={CONFIG_FRAME}>
          <p className="text-body">Imagen del cliente: {block.image?.alt ?? "sin descripción"}</p>
        </div>
      );
    case "report_download":
      return (
        <div className={CONFIG_FRAME}>
          <p className="font-medium text-strong">Descargar el informe (PDF)</p>
          <p className="mt-0.5 text-xs text-muted">
            El cliente lo descarga con los filtros que tenga puestos en ese momento.
          </p>
        </div>
      );
    case "all_results_disclosure":
      return <AllResultsBlock {...props} />;
    case "pivot_explorer":
      return <PivotBlock {...props} policy={policy} />;
    case "filter_panel":
      return (
        <FilterPanelView
          block={block}
          definition={definition}
          registry={props.registry}
          viewer={props.viewer}
        />
      );
    case "journey":
      return <JourneyBlock {...props} policy={policy} />;
    case "qualitative_themes":
    case "theme_cloud":
      return <QualitativeBlock {...props} policy={policy} />;
    case "retention":
      return <RetentionBlock {...props} policy={policy} />;
    case "metric":
    case "chart":
    case "comparison":
      return <EvidenceBlock {...props} policy={policy} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Blocks that describe rather than measure
// ---------------------------------------------------------------------------

function CoverBlock({ block, study }: BlockViewProps) {
  return (
    <div className={CONFIG_FRAME}>
      <p className="font-display text-base font-semibold text-strong">
        {block.title ?? study.name}
      </p>
      <p className="mt-0.5 text-xs text-muted">
        {study.clientName}
        {study.period ? ` · ${study.period}` : ""}
      </p>
      {block.copy.body ? <p className="mt-1.5 text-sm text-body">{block.copy.body}</p> : null}
    </div>
  );
}

function ProseBlock({ block }: { block: ExperienceBlock }) {
  if (!block.copy.body) {
    return (
      <div className={CONFIG_FRAME}>
        <p className="text-muted">
          Este bloque todavía no tiene texto. Escríbelo en la ficha del bloque.
        </p>
      </div>
    );
  }
  return <p className="whitespace-pre-line text-sm leading-relaxed text-body">{block.copy.body}</p>;
}

function InterpretationBlock() {
  return (
    <div className={CONFIG_FRAME}>
      <p className="font-medium text-strong">La lectura aprobada del equipo</p>
      <p className="mt-0.5 text-xs text-muted">
        Se redacta y se aprueba en “Interpretación”, nunca desde esta pantalla. Aquí solo se decide
        dónde aparece y qué tan ancha se ve.
      </p>
    </div>
  );
}

function AllResultsBlock({ registry }: BlockViewProps) {
  const ready = registry.metrics.filter((metric) => metric.publicationReady).length;
  return (
    <div className={CONFIG_FRAME}>
      <p className="font-medium text-strong">El inventario completo de resultados</p>
      <p className="mt-0.5 text-xs text-muted">
        {registry.metrics.length === 0
          ? "Este estudio todavía no produce ningún resultado numérico."
          : `${registry.metrics.length} resultados en total, ${ready} con respuestas. El cliente los ve plegados, para revisarlos si quiere.`}
      </p>
    </div>
  );
}

function PivotBlock({
  block,
  data,
  evidence,
  policy,
}: BlockViewProps & { policy: SampleVisibilityPolicy }) {
  const entry = data[dataKeyForPivot(block.id)];
  return (
    <div className="min-w-0 space-y-2">
      <div className={CONFIG_FRAME}>
        <p className="font-medium text-strong">El lector arma su propia comparación</p>
        <p className="mt-0.5 text-xs text-muted">
          {evidence.crossableCharacteristics.length === 0
            ? "Este estudio todavía no tiene características por las que cruzar."
            : `Puede elegir entre ${evidence.crossableResults} resultados y cruzarlos por ${evidence.crossableCharacteristics
                .slice(0, 4)
                .join(", ")}${evidence.crossableCharacteristics.length > 4 ? " y más" : ""}.`}
        </p>
      </div>
      {entry?.ok ? (
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted">Así abre, antes de que el lector cambie nada:</p>
          <DataTable data={entry.data} policy={policy} />
        </div>
      ) : (
        <EmptyChart title="No hay un cruce con el que abrir" detail={entry && !entry.ok ? entry.reason : undefined} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocks that measure
// ---------------------------------------------------------------------------

/** Deliberately not named like a hook: it is a lookup, and it is called
 * conditionally. */
function blockData(block: ExperienceBlock, data: BlockDataSet) {
  return data[dataKeyForBlock(block.id)];
}

function FindingBlock(props: BlockViewProps & { policy: SampleVisibilityPolicy }) {
  const { block, data, policy } = props;
  const entry = block.query ? blockData(block, data) : undefined;
  return (
    <div className="min-w-0 space-y-2">
      <ProseBlock block={block} />
      {entry?.ok ? (
        <div className="rounded-lg border border-line bg-surface px-3 py-2">
          <KpiChart data={entry.data} policy={policy} showDetail={false} />
        </div>
      ) : entry && !entry.ok ? (
        <BrokenReference reason={entry.reason} />
      ) : null}
    </div>
  );
}

function JourneyBlock({ block, definition, registry, data, policy }: BlockViewProps & { policy: SampleVisibilityPolicy }) {
  const journey = definition.journeyReferences.find((entry) => entry.id === block.journeyRef);
  if (!journey) {
    return <BrokenReference reason="Este bloque apunta a un recorrido que ya no existe." />;
  }
  const moments: JourneyMomentView[] = journey.moments
    .filter((moment) => moment.visible)
    .map((moment) => {
      // A MOMENT'S SEMÁFORO IS ITS OWN, OR THE RECORRIDO'S, OR NONE. Resolved
      // here so a scheme somebody deleted leaves the moment uncoloured rather
      // than pointing at a hole.
      const schemeId = moment.bandSchemeId ?? journey.bandSchemeId;
      const scheme =
        definition.bandSchemes.find((candidate) => candidate.id === schemeId) ?? null;

      // The awareness share, when a mapping is configured. Absent is absent:
      // a moment where the question was never asked shows nothing here.
      const awarenessEntry = moment.awareness
        ? data[dataKeyForAwareness(journey.id, moment.id)]
        : undefined;
      const awareness = awarenessEntry?.ok ? awarenessEntry.data : null;
      const awarenessMissing =
        awarenessEntry && !awarenessEntry.ok ? awarenessEntry.reason : null;

      const shared = {
        id: moment.id,
        title: moment.title,
        description: moment.description,
        body: moment.body,
        awareness,
        awarenessMissing,
        scheme,
      };

      if (!moment.metricId) {
        return {
          ...shared,
          data: null,
          missing: "Este momento todavía no tiene un resultado asignado.",
        };
      }
      const entry = data[dataKeyForMoment(journey.id, moment.id)];
      if (!entry) {
        return {
          ...shared,
          data: null,
          missing: findMetric(registry, moment.metricId)
            ? "Todavía sin respuestas."
            : "El resultado de este momento ya no existe en el estudio.",
        };
      }
      if (!entry.ok) return { ...shared, data: null, missing: entry.reason };
      return { ...shared, data: entry.data, missing: null };
    });
  return <JourneyChart moments={moments} policy={policy} />;
}

function RetentionBlock(props: BlockViewProps & { policy: SampleVisibilityPolicy }) {
  const { block, data, evidence, policy } = props;
  const entry = block.query ? data[dataKeyForBlock(block.id)] : undefined;
  return (
    <RetentionSeries
      data={entry?.ok ? entry.data : null}
      policy={policy}
      periods={evidence.periods}
    />
  );
}

/**
 * The confirmed themes, as a count of mentions.
 *
 * The counts come from `summarizeConfirmedQualitative`, the same function the
 * client dashboard uses, so a theme reads the same number on both screens. The
 * base a disclosure rule is applied to is `n` — distinct voices — and NOT the
 * mention count, because two mentions from one person is one person.
 */
/**
 * THE THEMES A READER IS ACTUALLY LOOKING AT.
 *
 * The catalogue declares that this block responds to a viewer filter, so it
 * reads the RESOLVED, narrowed theme series the server computed for this exact
 * block — not the study-wide `evidence.themes`, which is the same list for
 * everybody and would have left a filtered page showing an unfiltered count
 * beside filtered charts. `evidence.themes` remains the fallback for a surface
 * that has not resolved one yet, which is what it always was.
 */
function QualitativeBlock({ block, data, evidence, policy }: BlockViewProps & { policy: SampleVisibilityPolicy }) {
  const variant = (block.visualization?.variant ?? "bar_horizontal") as ChartVariant;
  const resolved = data[dataKeyForThemes(block.id)];
  const themes = useMemo(
    () =>
      resolved?.ok
        ? resolved.data.series[0].cells.map((cell) => ({
            label: resolved.data.categories.find((category) => category.key === cell.categoryKey)?.label
              ?? cell.categoryKey,
            count: cell.value ?? 0,
            n: cell.n,
          }))
        : evidence.themes,
    [resolved, evidence.themes],
  );
  const themeData = useMemo<ResolvedBlockData>(
    () => ({
      blockId: block.id,
      metricLabel: "Menciones confirmadas",
      unit: "count",
      decimals: 0,
      categoryLabel: "Tema",
      seriesLabel: null,
      categories: themes.map((theme) => ({ key: theme.label, label: theme.label })),
      series: [
        {
          key: "",
          label: null,
          cells: themes.map((theme) => ({
            categoryKey: theme.label,
            value: theme.count,
            n: theme.n,
          })),
        },
      ],
      overall: {
        categoryKey: "",
        value: themes.reduce((sum, theme) => sum + theme.count, 0),
        n: themes.reduce((sum, theme) => sum + theme.n, 0),
      },
      omittedCategories: 0,
      detail: [],
    }),
    [block.id, themes],
  );

  if (themes.length === 0) {
    return evidence.themes.length > 0 ? (
      <EmptyChart
        title="Nadie de este grupo dijo algo con un tema confirmado"
        detail="Hay temas confirmados en el estudio, pero ninguno viene de las personas que el filtro deja."
      />
    ) : (
      <EmptyChart
        title="Todavía no hay temas confirmados"
        detail="Solo entra lo que el equipo ya confirmó en la revisión cualitativa; nada se toma de un comentario sin revisar."
      />
    );
  }

  const cloud = layoutThemeCloud(
    themes.map((theme) => ({
      label: theme.label,
      count: theme.count,
      evidenceHref: null,
    })),
    { ...DEFAULT_THEME_CLOUD_OPTIONS, width: 900, height: 380 },
  );

  const draw = () => {
    if (variant === "theme_cloud") return <ThemeCloud layout={cloud} />;
    if (variant === "table") return <DataTable data={themeData} policy={policy} />;
    return <HorizontalBars data={themeData} policy={policy} />;
  };

  if (!isRendererImplemented(variant)) {
    const alternative = alternativeVariant(variant);
    return (
      <UnavailableRenderer variant={variant}>
        {alternative === "table" ? (
          <DataTable data={themeData} policy={policy} />
        ) : (
          <HorizontalBars data={themeData} policy={policy} />
        )}
      </UnavailableRenderer>
    );
  }
  return draw();
}

function EvidenceBlock(props: BlockViewProps & { policy: SampleVisibilityPolicy }) {
  const { block, data, definition, policy } = props;
  const entry = blockData(block, data);
  if (!block.query) {
    return <EmptyChart title="Este bloque todavía no apunta a un resultado" />;
  }
  if (!entry) {
    return <EmptyChart title="Todavía no se calcularon los resultados de este bloque" />;
  }
  if (!entry.ok) return <BrokenReference reason={entry.reason} />;

  const variant = (block.visualization?.variant ?? "table") as ChartVariant;
  const target: TargetRange | null =
    block.query.comparison.kind === "target"
      ? {
          minimum: block.query.comparison.target,
          maximum: block.query.comparison.targetMaximum,
          label: block.query.comparison.targetLabel,
        }
      : null;

  // The semáforo this block is read against, when a person configured one.
  // Resolved HERE rather than inside the renderer so the reference is checked
  // against the document that is actually on screen.
  const scheme =
    definition.bandSchemes.find((candidate) => candidate.id === block.bandSchemeId) ?? null;

  if (!isRendererImplemented(variant)) {
    const alternative = alternativeVariant(variant) ?? "table";
    return (
      <UnavailableRenderer variant={variant}>
        {drawVariant(alternative, entry.data, policy, target, block, scheme)}
      </UnavailableRenderer>
    );
  }
  return drawVariant(variant, entry.data, policy, target, block, scheme);
}

function drawVariant(
  variant: ChartVariant,
  data: ResolvedBlockData,
  policy: SampleVisibilityPolicy,
  target: TargetRange | null,
  block: ExperienceBlock,
  scheme: BandScheme | null = null,
) {
  const showValueLabels = block.visualization?.showValueLabels ?? true;
  const palette = block.visualization?.palette ?? "auto";
  switch (variant) {
    case "kpi":
      return <KpiChart data={data} policy={policy} />;
    case "traffic_light":
      return <TrafficLightChart data={data} policy={policy} target={target} scheme={scheme} />;
    case "heatmap":
      return (
        <HeatMap data={data} policy={policy} palette={palette} showValueLabels={showValueLabels} />
      );
    case "bubble":
      return <BubbleChart data={data} policy={policy} palette={palette} />;
    case "treemap":
      return <TreemapChart data={data} policy={policy} palette={palette} />;
    case "bar_horizontal":
    case "bar_grouped":
      return <HorizontalBars data={data} policy={policy} showValueLabels={showValueLabels} />;
    case "bar_vertical":
      return <VerticalBars data={data} policy={policy} showValueLabels={showValueLabels} />;
    case "bar_stacked":
      return <StackedBars data={data} policy={policy} />;
    case "bar_stacked_100":
      return <StackedBars data={data} policy={policy} hundred />;
    case "line":
      return <LineChart data={data} policy={policy} />;
    case "area":
      return <LineChart data={data} policy={policy} area />;
    case "pie":
      return <PieChart data={data} policy={policy} />;
    case "donut":
      return <PieChart data={data} policy={policy} donut />;
    case "retention_series":
      return <LineChart data={data} policy={policy} />;
    case "table":
    default:
      return <DataTable data={data} policy={policy} />;
  }
}

function BrokenReference({ reason }: { reason: string }) {
  return (
    <div className="rounded-lg border border-caution-line bg-caution-surface px-3 py-2.5 text-sm text-caution">
      <p className="font-medium">Este bloque no puede mostrar un número</p>
      <p className="mt-0.5 text-xs">{reason}</p>
    </div>
  );
}

/** What the catalogue says about a drawing, for the panel that offers it. */
export function variantNote(variant: ChartVariant): string {
  const spec = CHART_SPECS[variant];
  if (spec.rendererImplemented) return spec.description;
  return `${spec.description} — todavía no se dibuja en esta versión.`;
}
