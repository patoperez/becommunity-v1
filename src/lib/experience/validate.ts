/**
 * Everything the schema cannot know on its own.
 *
 * The Zod boundary in `definition.ts` proves the document is well-formed:
 * strict, bounded, free of markup, internally consistent. It cannot prove that
 * `r_9k2…` is a result THIS study has, that the aggregation is one THAT result
 * supports, or that the chart can carry 128 categories. Those need the semantic
 * registry, and that is what this module does.
 *
 * THE DISTINCTION THAT MATTERS MOST HERE IS NOT TECHNICAL, IT IS PRODUCT.
 *
 *   A HARD ERROR is something the product would be lying about. An unknown
 *   result. A characteristic from another study. A chart that cannot represent
 *   the data it was given. These block, and they block on the server.
 *
 *   A SOFT WARNING is something a person may reasonably decide to do anyway.
 *   A pie with nine slices. A label that will wrap on a phone. A bar chart over
 *   four answers. The composer says so, once, next to the choice — and then
 *   gets out of the way. A tool that refuses a legible-but-imperfect page is a
 *   tool the person it was built for stops using.
 *
 * Both come back as structured issues with a code and a target, never as
 * rendered copy: the same issue has to read differently in a side panel, in a
 * summary and in a gate.
 */

import { blockSpec, type BlockType } from "./blocks";
import { CHART_SPECS, alternativeVariant, type ChartVariant } from "./charts";
import {
  allBlocks,
  type ExperienceBlock,
  type ExperienceDefinitionV1,
  type BlockQuerySpec,
} from "./definition";
import { panelTargetBlockIds } from "./filters";
import { layoutProblems, rowWidths, GRID_COLUMNS, BREAKPOINTS, type PlacedBlock } from "./layout";
import { EXPERIENCE_LIMITS } from "./limits";
import {
  dimensionCardinality,
  findDimension,
  findMetric,
  type SemanticRegistry,
} from "./registry";

export const HARD_CODES = [
  "unknown_metric",
  "unknown_dimension",
  "unauthorized_field",
  "unsupported_aggregation",
  "tenant_mismatch",
  "impossible_schema",
  "cardinality_ceiling",
  "unknown_reference",
  "layout_invalid",
  "limit_exceeded",
  "journey_family_mismatch",
  "not_publication_ready",
] as const;
export type HardCode = (typeof HARD_CODES)[number];

export const SOFT_CODES = [
  "crowded_categories",
  "hard_to_read_chart",
  "sparse_result",
  "empty_panel",
  "panel_moves_nothing",
  "long_labels",
  "weak_mobile_fit",
  "hidden_everywhere",
  "unconnected_filter",
  "no_renderer_yet",
] as const;
export type SoftCode = (typeof SOFT_CODES)[number];

export type Issue<C extends string> = {
  code: C;
  /** What the issue is about, so a panel can highlight it. */
  target: { kind: "definition" | "page" | "block" | "filter" | "journey"; id: string };
  /** One plain sentence. Spanish, because the composer is in Spanish. */
  detail: string;
};

export type ValidationReport = {
  errors: Issue<HardCode>[];
  warnings: Issue<SoftCode>[];
};

/**
 * The drawings whose geometry ASSERTS that the parts add up to the whole, and
 * the aggregations for which that assertion is true.
 */
const PART_OF_WHOLE_VARIANTS: ReadonlySet<string> = new Set(["pie", "donut", "treemap"]);
const PART_OF_WHOLE_AGGREGATIONS: ReadonlySet<string> = new Set(["count", "sum", "share"]);

const EMPTY: ValidationReport = { errors: [], warnings: [] };

function merge(...reports: ValidationReport[]): ValidationReport {
  return {
    errors: reports.flatMap((report) => report.errors),
    warnings: reports.flatMap((report) => report.warnings),
  };
}

/**
 * One block's query, checked against what the study actually has.
 *
 * Exported on its own because the composer asks this question while somebody is
 * still choosing, long before there is a whole document to validate.
 */
export function validateBlockQuery(
  query: BlockQuerySpec,
  registry: SemanticRegistry,
  context: { blockId: string; type: BlockType; variant: ChartVariant | null },
): ValidationReport {
  const errors: Issue<HardCode>[] = [];
  const warnings: Issue<SoftCode>[] = [];
  const target = { kind: "block" as const, id: context.blockId };

  const metric = findMetric(registry, query.metricId);
  if (!metric) {
    errors.push({
      code: "unknown_metric",
      target,
      detail: "Este bloque apunta a un resultado que este estudio no tiene.",
    });
    return { errors, warnings };
  }

  if (!metric.aggregations.includes(query.aggregation)) {
    errors.push({
      code: "unsupported_aggregation",
      target,
      detail: `“${metric.label}” no se puede calcular de esa manera.`,
    });
  }

  if (!metric.publicationReady) {
    warnings.push({
      code: "sparse_result",
      target,
      detail: `“${metric.label}” todavía no está listo para mostrarse a un cliente.`,
    });
  }

  if (metric.responses === 0) {
    warnings.push({
      code: "sparse_result",
      target,
      detail: `“${metric.label}” hoy no tiene respuestas en este estudio.`,
    });
  }

  const dimensionIds = [query.primaryDimensionId, query.secondaryDimensionId].filter(
    (id): id is string => typeof id === "string",
  );
  let cardinality = 0;
  for (const id of dimensionIds) {
    const dimension = findDimension(registry, id);
    if (!dimension) {
      errors.push({
        code: "unknown_dimension",
        target,
        detail: "Este bloque se desglosa por una característica que este estudio no tiene.",
      });
      continue;
    }
    const values = dimensionCardinality(dimension);
    cardinality = Math.max(cardinality, values);
    if (values > EXPERIENCE_LIMITS.dimensionCardinality) {
      errors.push({
        code: "cardinality_ceiling",
        target,
        detail: `“${dimension.label}” tiene ${values} valores distintos; el máximo legible es ${EXPERIENCE_LIMITS.dimensionCardinality}.`,
      });
    }
    if (values === 1) {
      warnings.push({
        code: "sparse_result",
        target,
        detail: `“${dimension.label}” tiene un solo valor, así que el desglose no compara nada.`,
      });
    }
    const longest = dimension.values.reduce(
      (longest, entry) => Math.max(longest, entry.label.length),
      0,
    );
    if (longest > 28) {
      warnings.push({
        code: "long_labels",
        target,
        detail: `Algunas etiquetas de “${dimension.label}” son largas y se van a cortar en pantalla angosta.`,
      });
    }
  }

  /*
   * FILTRO FIJO DEL BLOQUE — the author's permanent narrowing.
   *
   * It names a characteristic and the values it is held to, so unlike a viewer
   * control it is checked HERE, against the study's own registry: a fixed
   * filter over a characteristic the study no longer has silently stops
   * narrowing anything, and a block that quietly widens to everybody is a
   * wrong number rather than an ugly one.
   */
  for (const fixed of query.fixedFilters) {
    const dimension = findDimension(registry, fixed.dimensionId);
    if (!dimension) {
      errors.push({
        code: "unknown_dimension",
        target,
        detail: "Este bloque está acotado por una característica que este estudio ya no tiene.",
      });
      continue;
    }
    const known = new Set(dimension.values.map((value) => value.value));
    const missing = fixed.values.filter((value) => !known.has(value));
    if (missing.length > 0) {
      warnings.push({
        code: "sparse_result",
        target,
        detail: `“${dimension.label}” ya no tiene ${missing.length === 1 ? "el valor" : "los valores"} ${missing
          .slice(0, 3)
          .map((value) => `“${value}”`)
          .join(", ")}, así que ese acotamiento no deja pasar nada.`,
      });
    }
  }

  if (context.variant) {
    const spec = CHART_SPECS[context.variant];
    const supplied = dimensionIds.length as 0 | 1 | 2;
    if (supplied < spec.dimensions.min || supplied > spec.dimensions.max) {
      errors.push({
        code: "impossible_schema",
        target,
        detail: `“${spec.label}” necesita ${spec.dimensions.min === spec.dimensions.max ? spec.dimensions.min : `entre ${spec.dimensions.min} y ${spec.dimensions.max}`} característica(s), y este bloque tiene ${supplied}.`,
      });
    }
    if (!(metric.charts as readonly string[]).includes(context.variant)) {
      errors.push({
        code: "impossible_schema",
        target,
        detail: `“${metric.label}” no se puede representar como ${spec.label.toLowerCase()}.`,
      });
    }
    // A DRAWING THAT DIVIDES A WHOLE NEEDS PARTS THAT ADD UP TO ONE.
    //
    // A pie, a dona and a treemap all say "this is how the total splits". A
    // promedio, un NPS o un Top-2-Box por característica do not add up to
    // anything: three slices reading 8.4, 7.9 and 9.1 make a picture whose
    // angles mean nothing at all. Counting answers, adding them up, or taking
    // the share of the total does divide a whole, so those three aggregations
    // are exactly the ones these drawings accept. It is a hard error because
    // the alternative is a graphic that misrepresents the data.
    if (PART_OF_WHOLE_VARIANTS.has(context.variant) && !PART_OF_WHOLE_AGGREGATIONS.has(query.aggregation)) {
      errors.push({
        code: "impossible_schema",
        target,
        detail:
          `“${spec.label}” reparte un total entre sus partes, y “${metric.label}” está calculado como `
          + "un promedio, así que las partes no suman el total. Cambia el cálculo a cantidad, suma o "
          + "porcentaje del total, o elige otra gráfica.",
      });
    }
    const shown = query.topN ? Math.min(query.topN, cardinality || query.topN) : cardinality;
    if (spec.maximumCategories !== null && shown > spec.maximumCategories) {
      errors.push({
        code: "cardinality_ceiling",
        target,
        detail: `“${spec.label}” no puede dibujar ${shown} categorías. Limita el número de filas o cambia de gráfica.`,
      });
    } else if (spec.comfortableCategories !== null && shown > spec.comfortableCategories) {
      warnings.push({
        code: "crowded_categories",
        target,
        detail: `Con ${shown} categorías, “${spec.label.toLowerCase()}” se va a leer con dificultad. Se puede publicar así.`,
      });
    }
    warnings.push(...variantWarnings(context.variant, target));
  }

  return { errors, warnings };
}

/**
 * What is worth saying about a DRAWING, independently of any query.
 *
 * Four block kinds carry a visualization and no query at all — the recorrido,
 * the confirmed themes, the theme cloud and the complete results table. Keeping
 * these two warnings inside the query check meant those four could be switched
 * to a variant with no renderer, or to one that is unreadable on a phone, and
 * the composer said nothing. The drawing is a property of the block, so the
 * warnings about the drawing belong to the block.
 */
function variantWarnings(
  variant: ChartVariant | null,
  target: Issue<SoftCode>["target"],
): Issue<SoftCode>[] {
  if (!variant) return [];
  const spec = CHART_SPECS[variant];
  const warnings: Issue<SoftCode>[] = [];
  if (spec.mobile === "poor") {
    warnings.push({
      code: "weak_mobile_fit",
      target,
      detail: `“${spec.label}” es difícil de leer en teléfono. Considera una tabla como alternativa.`,
    });
  }
  if (!spec.rendererImplemented) {
    const alternative = alternativeVariant(variant);
    warnings.push({
      code: "no_renderer_yet",
      target,
      detail:
        `“${spec.label}” todavía no se dibuja. El bloque lo dice con todas sus letras y muestra `
        + `${alternative ? CHART_SPECS[alternative].label.toLowerCase() : "la tabla"} debajo, `
        + "como referencia; no es la misma gráfica y no se hace pasar por ella.",
    });
  }
  return warnings;
}

function validateBlock(
  block: ExperienceBlock,
  registry: SemanticRegistry,
  known: { filters: Set<string>; journeys: Set<string> },
  definition: ExperienceDefinitionV1,
): ValidationReport {
  const target = { kind: "block" as const, id: block.id };
  const errors: Issue<HardCode>[] = [];
  const warnings: Issue<SoftCode>[] = [];
  const spec = blockSpec(block.type as BlockType);

  for (const problem of layoutProblems(block.type as BlockType, block.layout)) {
    errors.push({
      code: "layout_invalid",
      target,
      detail: `${spec.label}: ${problem.detail} (${problem.breakpoint}).`,
    });
  }

  for (const filterId of block.filterRefs) {
    if (!known.filters.has(filterId)) {
      errors.push({
        code: "unknown_reference",
        target,
        detail: `${spec.label} muestra un filtro que no existe en esta experiencia.`,
      });
    }
  }

  /*
   * A PANEL THAT OFFERS NOTHING, OR GOVERNS NOTHING, IS SAID — AND NOT BLOCKED.
   *
   * Both are states a person passes through while building one: they add the
   * panel, then choose its controls, then choose what it moves. Refusing to
   * save in between is how a tool stops being usable. They are warnings, said
   * once, next to the choice — which is the hard/soft split this module exists
   * to keep.
   */
  if (block.type === "filter_panel" && block.filterPanel) {
    if (block.filterRefs.length === 0) {
      warnings.push({
        code: "empty_panel",
        target,
        detail:
          "Este panel todavía no ofrece ninguna característica, así que el cliente no verá ningún control en él.",
      });
    }
    const governed = panelTargetBlockIds(definition, block);
    if (governed.size === 0) {
      warnings.push({
        code: "panel_moves_nothing",
        target,
        detail:
          "Este panel no está conectado con ningún bloque que pueda responder, así que cambiar sus filtros no cambiaría nada en pantalla.",
      });
    }
  }

  if (block.journeyRef && !known.journeys.has(block.journeyRef)) {
    errors.push({
      code: "unknown_reference",
      target,
      detail: `${spec.label} apunta a un recorrido que no existe en esta experiencia.`,
    });
  }

  if (block.query) {
    const report = validateBlockQuery(block.query, registry, {
      blockId: block.id,
      type: block.type as BlockType,
      variant: block.visualization?.variant ?? null,
    });
    errors.push(...report.errors);
    warnings.push(...report.warnings);
  } else if (block.visualization) {
    // A drawing with no query behind it — the recorrido, the themes, the cloud,
    // the complete results table. It still has a renderer, or it still does not.
    warnings.push(...variantWarnings(block.visualization.variant, target));
  }

  const invisibleEverywhere = BREAKPOINTS.every(
    (breakpoint) => !block.layout[breakpoint].visible,
  );
  if (block.visible && invisibleEverywhere) {
    warnings.push({
      code: "hidden_everywhere",
      target,
      detail: `${spec.label} está activo pero no aparece en ningún ancho de pantalla.`,
    });
  }

  return { errors, warnings };
}

/**
 * The whole document against the whole registry.
 *
 * SERVER-SIDE, ALWAYS. The composer runs the same function in the browser to
 * be helpful; the copy that matters is the one that runs before anything is
 * stored or published.
 */
export function validateExperienceDefinition(
  definition: ExperienceDefinitionV1,
  registry: SemanticRegistry,
): ValidationReport {
  const errors: Issue<HardCode>[] = [];
  const warnings: Issue<SoftCode>[] = [];
  const definitionTarget = { kind: "definition" as const, id: definition.id };

  // A reference that would reach across a tenant is not caught later by a
  // policy — it fails here, because the registry it would have to resolve
  // against is the wrong one.
  if (
    registry.scope.studyId !== definition.metadata.studyId
    || registry.scope.tenantId !== definition.metadata.tenantId
  ) {
    errors.push({
      code: "tenant_mismatch",
      target: definitionTarget,
      detail: "Esta experiencia pertenece a otro estudio o a otro cliente.",
    });
    return { errors, warnings };
  }

  if (definition.pages.length > EXPERIENCE_LIMITS.pages) {
    errors.push({
      code: "limit_exceeded",
      target: definitionTarget,
      detail: `Una experiencia admite ${EXPERIENCE_LIMITS.pages} páginas como máximo.`,
    });
  }

  const blocks = allBlocks(definition);
  const blockIds = new Set(blocks.map((block) => block.id));
  const pageIds = new Set(definition.pages.map((page) => page.id));
  const filters = new Set(definition.filterDefinitions.map((filter) => filter.id));
  const journeys = new Set(definition.journeyReferences.map((journey) => journey.id));

  for (const filter of definition.filterDefinitions) {
    const target = { kind: "filter" as const, id: filter.id };
    const dimension = findDimension(registry, filter.dimensionId);
    if (!dimension) {
      errors.push({
        code: "unknown_dimension",
        target,
        detail: `“${filter.label}” filtra por una característica que este estudio no tiene.`,
      });
    } else if (!dimension.filterEligible) {
      errors.push({
        code: "unauthorized_field",
        target,
        detail: `“${dimension.label}” no puede usarse como filtro.`,
      });
    } else {
      const values = new Set(dimension.values.map((entry) => entry.value));
      for (const value of filter.defaultValues) {
        if (!values.has(value)) {
          errors.push({
            code: "unknown_reference",
            target,
            detail: `“${filter.label}” arranca con una opción que ya no existe en los datos.`,
          });
          break;
        }
      }
    }
    if (filter.pageId && !pageIds.has(filter.pageId)) {
      errors.push({
        code: "unknown_reference",
        target,
        detail: `“${filter.label}” pertenece a una página que ya no existe.`,
      });
    }
    if (filter.dependsOn && !filters.has(filter.dependsOn)) {
      errors.push({
        code: "unknown_reference",
        target,
        detail: `“${filter.label}” depende de un filtro que no existe.`,
      });
    }
    const connected = definition.filterConnections.some(
      (connection) => connection.filterId === filter.id && connection.blockIds.length > 0,
    );
    if (!connected) {
      warnings.push({
        code: "unconnected_filter",
        target,
        detail: `“${filter.label}” no está conectado a ningún bloque, así que no cambia nada todavía.`,
      });
    }
  }

  for (const connection of definition.filterConnections) {
    const target = { kind: "filter" as const, id: connection.filterId };
    if (!filters.has(connection.filterId)) {
      errors.push({
        code: "unknown_reference",
        target,
        detail: "Una conexión apunta a un filtro que no existe.",
      });
    }
    for (const blockId of connection.blockIds) {
      if (!blockIds.has(blockId)) {
        errors.push({
          code: "unknown_reference",
          target,
          detail: "Una conexión apunta a un bloque que ya no existe.",
        });
        break;
      }
    }
  }

  for (const journey of definition.journeyReferences) {
    const target = { kind: "journey" as const, id: journey.id };
    for (const filterId of journey.filterRefs) {
      if (!filters.has(filterId)) {
        errors.push({
          code: "unknown_reference",
          target,
          detail: `“${journey.title}” usa un filtro que no existe.`,
        });
        break;
      }
    }
    for (const moment of journey.moments) {
      for (const [metricId, what] of [
        [moment.metricId, "el resultado"],
        [moment.unawareMetricId, "la medida de desconocimiento"],
      ] as const) {
        if (!metricId) continue;
        const metric = findMetric(registry, metricId);
        if (!metric) {
          errors.push({
            code: "unknown_metric",
            target,
            detail: `“${moment.title}”: ${what} no existe en este estudio.`,
          });
          continue;
        }
        if (!metric.journeyEligible) {
          errors.push({
            code: "unauthorized_field",
            target,
            detail: `“${metric.label}” no puede usarse en un recorrido.`,
          });
          continue;
        }
        // The journey declares which families it carries and carries only
        // those, so a recorrido about satisfaction cannot quietly grow a
        // revenue moment.
        if (metricId === moment.metricId && !journey.eligibleFamilies.includes(metric.family)) {
          errors.push({
            code: "journey_family_mismatch",
            target,
            detail: `“${journey.title}” solo lleva resultados de ${journey.eligibleFamilies.join(", ")}, y “${metric.label}” no es uno de ellos.`,
          });
        }
      }
      if (!moment.metricId) {
        warnings.push({
          code: "sparse_result",
          target,
          detail: `“${moment.title}” todavía no tiene resultado, así que aparecerá sin número.`,
        });
      }
    }
  }

  for (const page of definition.pages) {
    for (const filterId of page.filterRefs) {
      if (!filters.has(filterId)) {
        errors.push({
          code: "unknown_reference",
          target: { kind: "page", id: page.id },
          detail: `“${page.title}” muestra un filtro que no existe.`,
        });
      }
    }
    for (const block of page.blocks) {
      const report = validateBlock(block, registry, { filters, journeys }, definition);
      errors.push(...report.errors);
      warnings.push(...report.warnings);
    }
    // The layout guarantee, asserted rather than assumed.
    const placed: PlacedBlock[] = page.blocks.map((block) => ({
      id: block.id,
      type: block.type as BlockType,
      layout: block.layout,
    }));
    for (const breakpoint of BREAKPOINTS) {
      for (const width of rowWidths(placed, breakpoint)) {
        if (width > GRID_COLUMNS) {
          errors.push({
            code: "layout_invalid",
            target: { kind: "page", id: page.id },
            detail: `“${page.title}” produce una fila más ancha que la retícula en ${breakpoint}.`,
          });
          break;
        }
      }
    }
  }

  return merge({ errors, warnings }, EMPTY);
}

/** Whether the document may be stored at all. Warnings never appear here. */
export function isPublishable(report: ValidationReport): boolean {
  return report.errors.length === 0;
}
