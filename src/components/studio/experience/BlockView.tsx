"use client";

import { useMemo } from "react";

import { useIsClient } from "./Audience";

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
  evaluateSampleVisibility,
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

/**
 * THE TITLE SOMEBODY WROTE ON A BLOCK, DRAWN.
 *
 * Every block type whose spec says it carries copy offers a title in the
 * composer, and until now only `section` and `cover` ever drew one: a chart
 * titled "Mapa de calor por generación y antigüedad" reached the canvas, the
 * previews and — the first time a composed experience was published — a
 * client's screen, as an untitled picture. The author's own words for what a
 * drawing is about were being collected and thrown away.
 *
 * Found by driving the published client screen and looking for the title that
 * was supposed to be on it.
 *
 * `section` and `cover` are excluded because the title IS their content, and
 * the spacing rules are excluded because they carry no words at all. Everything
 * else gets the heading above whatever it draws.
 */
const TITLE_IS_THE_BLOCK = new Set<BlockType>([
  // The title IS the content.
  "section",
  "cover",
  // No words at all.
  "divider",
  "spacer",
  // Draws its own heading, from the same `block.title`. Adding one above it
  // printed "Explora los resultados" twice on the first published client
  // screen — found in the screenshot, not in the code.
  "filter_panel",
]);

export function BlockView(props: BlockViewProps) {
  const { block } = props;
  const title = block.title?.trim();
  const body = <BlockBody {...props} />;
  if (!title || TITLE_IS_THE_BLOCK.has(block.type as BlockType)) return body;
  return (
    <div className="min-w-0">
      <h3 className="min-w-0 font-display text-sm font-semibold text-strong [overflow-wrap:anywhere]">
        {title}
      </h3>
      <div className="mt-1.5 min-w-0">{body}</div>
    </div>
  );
}

function BlockBody(props: BlockViewProps) {
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
  // Read before any branch: a hook called inside one is a hook whose order
  // changes between renders, and React's rules exist because that corrupts
  // every hook after it.
  const forClient = useIsClient();
  if (!block.copy.body) {
    // A paragraph with no paragraph is unfinished work. `client-visibility.ts`
    // already keeps it off a client's page; this is the second line, so the
    // instruction below can never be the thing a client reads.
    if (forClient) return null;
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
  /*
   * THE STUDY'S DISCLOSURE RULE APPLIES TO A WORD EXACTLY AS IT APPLIES TO A
   * NUMBER.
   *
   * A theme is an aggregate over a base of VOICES, and a base of two under a
   * `hide_below` rule is two identifiable people whether the product renders it
   * as a cell or as a large word. So a suppressed theme loses its word and its
   * count together — publishing "oculto, 2 personas" would hide the number and
   * announce the base, which is the half that identifies somebody.
   *
   * A withheld theme leaves nothing behind: no ghost word, no placeholder and
   * no line in the ranked list. What Be Community chose not to disclose renders
   * as silence.
   */
  const themes = useMemo(() => {
    const all = resolved?.ok
      ? resolved.data.series[0].cells.map((cell) => ({
          label: resolved.data.categories.find((category) => category.key === cell.categoryKey)?.label
            ?? cell.categoryKey,
          count: cell.value ?? 0,
          n: cell.n,
        }))
      : [];
    return all.filter((theme) => evaluateSampleVisibility(theme.n, policy).state !== "suppressed");
  }, [resolved, policy]);
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

  /*
   * A BLOCK WITH NO RESOLVED DATA SAYS SO, exactly as a number does.
   *
   * This used to fall back to `evidence.themes` — the STUDY-WIDE summary, the
   * same list for everybody. On a narrowed page that renders an unfiltered
   * count beside filtered charts and looks completely convincing; in the
   * builder it renders yesterday's numbers under today's settings for as long
   * as the recompute takes. "Not computed yet" is a different sentence from
   * "here are the numbers", and it is the true one.
   *
   * `evidence.themes` is still read, once, to tell the two EMPTY states apart:
   * a study with no confirmed themes at all reads differently from a study
   * that has them and this selection that does not.
   */
  if (!resolved) {
    return <EmptyChart title="Todavía no se calcularon los temas de este bloque" />;
  }
  if (!resolved.ok) return <BrokenReference reason={resolved.reason} />;

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

  /*
   * THE BLOCK'S OWN SETTINGS DRIVE THE DRAWING.
   *
   * How many words, how large the smallest and the largest, how they are
   * turned, which palette, whether the count is written beside the word. Two
   * clouds on one page can therefore be two different pictures of two different
   * questions, which is the whole reason a cloud carries settings at all rather
   * than reading a constant.
   */
  const settings = block.themeCloud;
  const cloud = layoutThemeCloud(
    themes.map((theme) => ({
      label: theme.label,
      count: theme.count,
      evidenceHref: null,
    })),
    {
      ...DEFAULT_THEME_CLOUD_OPTIONS,
      /*
       * THE DRAWING AREA IS SIZED LIKE THE BOX IT WILL BE DRAWN IN.
       *
       * The SVG scales its viewBox to fit whatever width the block has — about
       * 620 px for a half-width block on a 1 280 px page. A 900-unit-wide
       * layout therefore arrives on screen at roughly 0.7, and a 14-unit word
       * lands at ten pixels: present, correct, and unreadable. Laying out at a
       * width close to the real one keeps the configured sizes meaning what
       * they say.
       */
      width: 720,
      height: 320,
      maximumWords: settings?.maximumThemes ?? DEFAULT_THEME_CLOUD_OPTIONS.maximumWords,
      minimumFontSize: settings?.minimumFontSize ?? DEFAULT_THEME_CLOUD_OPTIONS.minimumFontSize,
      maximumFontSize: settings?.maximumFontSize ?? DEFAULT_THEME_CLOUD_OPTIONS.maximumFontSize,
      orientation: settings?.orientation ?? DEFAULT_THEME_CLOUD_OPTIONS.orientation,
      // The layout has to reserve room for what will actually be drawn, count
      // and all, which is why this setting reaches the layout and not only the
      // renderer.
      showCounts: settings?.showCounts ?? DEFAULT_THEME_CLOUD_OPTIONS.showCounts,
    },
  );

  const draw = () => {
    if (variant === "theme_cloud") {
      return (
        <ThemeCloud
          layout={cloud}
          basis={settings?.basis ?? "mentions"}
          showCounts={settings?.showCounts ?? true}
          palette={settings?.palette ?? "auto"}
          themes={resolved?.ok ? (resolved.data.themes ?? []) : []}
          policy={policy}
          exportName={(block.title ?? "nube-de-temas")
            .replace(/[^a-zA-Z0-9-]+/g, "-")
            .toLowerCase()}
        />
      );
    }
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
