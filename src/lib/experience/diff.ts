/**
 * What changed between two arrangements, said in sentences a consultant reads.
 *
 * WHY THIS EXISTS RATHER THAN A JSON DIFF. A reviewer deciding whether to send
 * something to a client is answering "what will be different on their screen".
 * Two pretty-printed documents side by side answer a different question — "which
 * characters differ" — and answer it in a form where a reordered page and a
 * deleted chart look the same. The technical export still exists for the rare
 * case where somebody needs the bytes; it is not the review experience.
 *
 * WHAT IS DELIBERATELY IGNORED. `review` and `publication` are editor
 * bookkeeping and never reach a reader, so a change in them is not a change.
 * The canonical hash covers them, because the hash names the stored document;
 * this names what a client would notice. Those are two different questions and
 * conflating them would make every publication look like a content change.
 *
 * WHAT IS NEVER INFERRED. A block is the same block when it has the same
 * identifier — never when it has the same title, and never by position.
 * Identifiers are opaque and stable exactly so that renaming a block is a
 * rename rather than a delete and an add, and so that moving one is a move.
 *
 * IT IS PURE and takes two documents. The gate drives it with literals.
 */

import { blockSpec } from "./blocks";
import {
  type ExperienceBlock,
  type ExperienceDefinitionV1,
  type ExperiencePage,
} from "./definition";
import type { SamplePolicyOverride } from "./sample-policy";

export const DIFF_KINDS = [
  "page",
  "block",
  "query",
  "visualization",
  "filter",
  "journey",
  "band",
  "sample_policy",
  "identity",
  "theme_cloud",
] as const;
export type DiffKind = (typeof DIFF_KINDS)[number];

export const DIFF_ACTIONS = [
  "added",
  "removed",
  "renamed",
  "reordered",
  "moved",
  "hidden",
  "restored",
  "changed",
] as const;
export type DiffAction = (typeof DIFF_ACTIONS)[number];

export type DiffChange = {
  kind: DiffKind;
  action: DiffAction;
  /** The identifier of the thing that changed. Never rendered to a person. */
  id: string;
  /** What the thing is called, for the screen. */
  label: string;
  /** One sentence saying what is different. */
  detail: string;
};

export type StructuralDiff = {
  changes: DiffChange[];
  /** True exactly when nothing a reader could notice is different. */
  identical: boolean;
  /** How many changes of each kind, so a summary line can be built. */
  counts: Record<DiffKind, number>;
};

export const DIFF_KIND_LABEL: Record<DiffKind, string> = {
  page: "Páginas",
  block: "Bloques",
  query: "Resultados",
  visualization: "Gráficas",
  filter: "Filtros",
  journey: "Recorridos",
  band: "Semáforos",
  sample_policy: "Regla de muestra",
  identity: "Portada",
  theme_cloud: "Nube de temas",
};

function blockName(block: ExperienceBlock): string {
  return block.title?.trim() || blockSpec(block.type).label;
}

function pageIndex(definition: ExperienceDefinitionV1): Map<string, ExperiencePage> {
  return new Map(definition.pages.map((page) => [page.id, page]));
}

function blockIndex(
  definition: ExperienceDefinitionV1,
): Map<string, { page: ExperiencePage; block: ExperienceBlock }> {
  const index = new Map<string, { page: ExperiencePage; block: ExperienceBlock }>();
  for (const page of definition.pages) {
    for (const block of page.blocks) index.set(block.id, { page, block });
  }
  return index;
}

/** Stable order for pages as a reader meets them. */
function orderedPageIds(definition: ExperienceDefinitionV1): string[] {
  return [...definition.pages].sort((a, b) => a.order - b.order).map((page) => page.id);
}

function samePolicyOverride(a: SamplePolicyOverride, b: SamplePolicyOverride): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "inherit" || b.kind === "inherit") return true;
  return (
    a.policy.mode === b.policy.mode
    && a.policy.threshold === b.policy.threshold
    && a.policy.policyVersion === b.policy.policyVersion
  );
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function structuralDiff(
  before: ExperienceDefinitionV1,
  after: ExperienceDefinitionV1,
): StructuralDiff {
  const changes: DiffChange[] = [];
  const push = (change: DiffChange) => changes.push(change);

  // -------------------------------------------------------------------------
  // Identity — the layer that renders once, above everything
  // -------------------------------------------------------------------------
  const identityFields: [keyof typeof before.identity, string][] = [
    ["visible", "si la portada se muestra"],
    ["title", "el título"],
    ["organization", "el cliente"],
    ["period", "el periodo"],
    ["description", "la introducción"],
    ["showReportDownload", "la descarga del reporte"],
  ];
  for (const [field, name] of identityFields) {
    if (json(before.identity[field]) !== json(after.identity[field])) {
      push({
        kind: "identity",
        action: "changed",
        id: after.id,
        label: "Portada",
        detail: `Cambió ${name} de la portada.`,
      });
    }
  }
  if (json(before.identity.show) !== json(after.identity.show)) {
    push({
      kind: "identity",
      action: "changed",
      id: after.id,
      label: "Portada",
      detail: "Cambió qué partes de la portada se muestran.",
    });
  }
  if (json(before.identity.mark) !== json(after.identity.mark)) {
    push({
      kind: "identity",
      action: "changed",
      id: after.id,
      label: "Portada",
      detail: "Cambió la marca de la portada.",
    });
  }
  if (before.title !== after.title) {
    push({
      kind: "identity",
      action: "renamed",
      id: after.id,
      label: after.title,
      detail: `La experiencia pasó de llamarse “${before.title}” a “${after.title}”.`,
    });
  }

  // -------------------------------------------------------------------------
  // The study's disclosure rule
  // -------------------------------------------------------------------------
  const beforePolicy = before.sampleVisibilityPolicy;
  const afterPolicy = after.sampleVisibilityPolicy;
  if (
    beforePolicy.mode !== afterPolicy.mode
    || beforePolicy.threshold !== afterPolicy.threshold
    || beforePolicy.policyVersion !== afterPolicy.policyVersion
  ) {
    push({
      kind: "sample_policy",
      action: "changed",
      id: after.id,
      label: "Regla de muestra",
      detail:
        `La regla de muestra pasó de ${beforePolicy.mode} (${beforePolicy.threshold}) a `
        + `${afterPolicy.mode} (${afterPolicy.threshold}). Decide qué resultados con pocas `
        + "respuestas se muestran.",
    });
  }

  // -------------------------------------------------------------------------
  // Pages
  // -------------------------------------------------------------------------
  const beforePages = pageIndex(before);
  const afterPages = pageIndex(after);
  for (const [id, page] of afterPages) {
    if (!beforePages.has(id)) {
      push({
        kind: "page",
        action: "added",
        id,
        label: page.title,
        detail: `Se agregó la página “${page.title}”${page.visible ? "" : " (oculta)"}.`,
      });
    }
  }
  for (const [id, page] of beforePages) {
    if (!afterPages.has(id)) {
      push({
        kind: "page",
        action: "removed",
        id,
        label: page.title,
        detail: `Se quitó la página “${page.title}”.`,
      });
    }
  }
  for (const [id, page] of afterPages) {
    const old = beforePages.get(id);
    if (!old) continue;
    if (old.title !== page.title) {
      push({
        kind: "page",
        action: "renamed",
        id,
        label: page.title,
        detail: `La página “${old.title}” ahora se llama “${page.title}”.`,
      });
    }
    if (old.visible !== page.visible) {
      push({
        kind: "page",
        action: page.visible ? "restored" : "hidden",
        id,
        label: page.title,
        detail: page.visible
          ? `“${page.title}” vuelve a mostrarse.`
          : `“${page.title}” ya no se muestra.`,
      });
    }
    if ((old.description ?? "") !== (page.description ?? "")) {
      push({
        kind: "page",
        action: "changed",
        id,
        label: page.title,
        detail: `Cambió el texto introductorio de “${page.title}”.`,
      });
    }
  }
  // Reordering is reported ONCE for the experience, naming the new first page,
  // rather than once per page. A reader who moved page four to the front does
  // not want to be told that four pages changed position.
  const beforeOrder = orderedPageIds(before).filter((id) => afterPages.has(id));
  const afterOrder = orderedPageIds(after).filter((id) => beforePages.has(id));
  if (beforeOrder.join("|") !== afterOrder.join("|")) {
    const first = afterPages.get(afterOrder[0]);
    push({
      kind: "page",
      action: "reordered",
      id: after.id,
      label: "Orden de las páginas",
      detail: `Cambió el orden de las páginas${first ? `; ahora empieza por “${first.title}”` : ""}.`,
    });
  }

  // -------------------------------------------------------------------------
  // Blocks, and everything a block carries
  // -------------------------------------------------------------------------
  const beforeBlocks = blockIndex(before);
  const afterBlocks = blockIndex(after);

  for (const [id, entry] of afterBlocks) {
    if (beforeBlocks.has(id)) continue;
    push({
      kind: "block",
      action: "added",
      id,
      label: blockName(entry.block),
      detail:
        `Se agregó “${blockName(entry.block)}” en “${entry.page.title}”`
        + `${entry.block.visible ? "" : " (oculto)"}.`,
    });
  }
  for (const [id, entry] of beforeBlocks) {
    if (afterBlocks.has(id)) continue;
    push({
      kind: "block",
      action: "removed",
      id,
      label: blockName(entry.block),
      detail: `Se quitó “${blockName(entry.block)}” de “${entry.page.title}”.`,
    });
  }

  for (const [id, entry] of afterBlocks) {
    const old = beforeBlocks.get(id);
    if (!old) continue;
    const name = blockName(entry.block);

    if (old.page.id !== entry.page.id) {
      push({
        kind: "block",
        action: "moved",
        id,
        label: name,
        detail: `“${name}” pasó de “${old.page.title}” a “${entry.page.title}”.`,
      });
    } else if (old.block.layout.desktop.order !== entry.block.layout.desktop.order) {
      push({
        kind: "block",
        action: "moved",
        id,
        label: name,
        detail: `“${name}” cambió de lugar dentro de “${entry.page.title}”.`,
      });
    }

    if (old.block.visible !== entry.block.visible) {
      push({
        kind: "block",
        action: entry.block.visible ? "restored" : "hidden",
        id,
        label: name,
        detail: entry.block.visible
          ? `“${name}” vuelve a mostrarse.`
          : `“${name}” ya no se muestra.`,
      });
    }

    if ((old.block.title ?? "") !== (entry.block.title ?? "")) {
      push({
        kind: "block",
        action: "renamed",
        id,
        label: name,
        detail: `“${old.block.title ?? blockSpec(old.block.type).label}” ahora se llama “${name}”.`,
      });
    }

    if (json(old.block.copy) !== json(entry.block.copy)) {
      push({
        kind: "block",
        action: "changed",
        id,
        label: name,
        detail: `Cambió el texto de “${name}”.`,
      });
    }

    if (json(old.block.layout) !== json(entry.block.layout)) {
      const widthChanged =
        old.block.layout.desktop.span !== entry.block.layout.desktop.span
        || old.block.layout.tablet.span !== entry.block.layout.tablet.span
        || old.block.layout.mobile.span !== entry.block.layout.mobile.span;
      if (widthChanged) {
        push({
          kind: "block",
          action: "changed",
          id,
          label: name,
          detail: `Cambió el ancho de “${name}”.`,
        });
      }
    }

    // The result the block reads. Reported field by field, because "the query
    // changed" is exactly as useless as a JSON diff.
    const oldQuery = old.block.query;
    const newQuery = entry.block.query;
    if (json(oldQuery) !== json(newQuery)) {
      if (!oldQuery && newQuery) {
        push({
          kind: "query",
          action: "added",
          id,
          label: name,
          detail: `“${name}” ahora lee un resultado.`,
        });
      } else if (oldQuery && !newQuery) {
        push({
          kind: "query",
          action: "removed",
          id,
          label: name,
          detail: `“${name}” ya no lee ningún resultado.`,
        });
      } else if (oldQuery && newQuery) {
        if (oldQuery.metricId !== newQuery.metricId) {
          push({
            kind: "query",
            action: "changed",
            id,
            label: name,
            detail: `“${name}” pasó a mostrar otro resultado.`,
          });
        }
        if (oldQuery.aggregation !== newQuery.aggregation) {
          push({
            kind: "query",
            action: "changed",
            id,
            label: name,
            detail: `“${name}” pasó de calcularse como ${oldQuery.aggregation} a ${newQuery.aggregation}.`,
          });
        }
        if (
          oldQuery.primaryDimensionId !== newQuery.primaryDimensionId
          || oldQuery.secondaryDimensionId !== newQuery.secondaryDimensionId
        ) {
          push({
            kind: "query",
            action: "changed",
            id,
            label: name,
            detail: `Cambió con qué características se cruza “${name}”.`,
          });
        }
        if (json(oldQuery.fixedFilters) !== json(newQuery.fixedFilters)) {
          push({
            kind: "filter",
            action: "changed",
            id,
            label: name,
            detail: `Cambió el filtro fijo de “${name}”: siempre muestra otro subconjunto.`,
          });
        }
        if (json(oldQuery.comparison) !== json(newQuery.comparison)) {
          push({
            kind: "query",
            action: "changed",
            id,
            label: name,
            detail: `Cambió contra qué se compara “${name}”.`,
          });
        }
        if (json(oldQuery.period) !== json(newQuery.period)) {
          push({
            kind: "query",
            action: "changed",
            id,
            label: name,
            detail: `Cambió el periodo que lee “${name}”.`,
          });
        }
        if (
          oldQuery.topN !== newQuery.topN
          || json(oldQuery.sort) !== json(newQuery.sort)
        ) {
          push({
            kind: "query",
            action: "changed",
            id,
            label: name,
            detail: `Cambió el orden o el recorte de “${name}”.`,
          });
        }
        if (!samePolicyOverride(oldQuery.samplePolicy, newQuery.samplePolicy)) {
          push({
            kind: "sample_policy",
            action: "changed",
            id,
            label: name,
            detail: `“${name}” cambió su propia regla de muestra.`,
          });
        }
      }
    }

    if (json(old.block.visualization) !== json(entry.block.visualization)) {
      const oldVariant = old.block.visualization?.variant ?? null;
      const newVariant = entry.block.visualization?.variant ?? null;
      push({
        kind: "visualization",
        action: "changed",
        id,
        label: name,
        detail:
          oldVariant !== newVariant
            ? `“${name}” pasó de dibujarse como ${oldVariant ?? "nada"} a ${newVariant ?? "nada"}.`
            : `Cambió cómo se dibuja “${name}”.`,
      });
    }

    if (old.block.bandSchemeId !== entry.block.bandSchemeId) {
      push({
        kind: "band",
        action: "changed",
        id,
        label: name,
        detail: entry.block.bandSchemeId
          ? `“${name}” ahora se pinta con un semáforo.`
          : `“${name}” ya no se pinta con un semáforo.`,
      });
    }

    if (json(old.block.themeCloud) !== json(entry.block.themeCloud)) {
      const oldSource = old.block.themeCloud?.source ?? null;
      const newSource = entry.block.themeCloud?.source ?? null;
      push({
        kind: "theme_cloud",
        action: "changed",
        id,
        label: name,
        detail:
          oldSource !== newSource
            ? `“${name}” pasó a leer ${newSource ? `la fuente “${newSource}”` : "todas las fuentes"}.`
            : `Cambió la configuración de la nube “${name}”.`,
      });
    }

    if (json(old.block.filterRefs) !== json(entry.block.filterRefs)) {
      push({
        kind: "filter",
        action: "changed",
        id,
        label: name,
        detail: `Cambió qué controles de filtro ofrece “${name}”.`,
      });
    }

    if (json(old.block.filterPanel) !== json(entry.block.filterPanel)) {
      push({
        kind: "filter",
        action: "changed",
        id,
        label: name,
        detail: `Cambió a qué bloques mueve el panel “${name}”.`,
      });
    }

    if (old.block.journeyRef !== entry.block.journeyRef) {
      push({
        kind: "journey",
        action: "changed",
        id,
        label: name,
        detail: `“${name}” ahora muestra otro recorrido.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Filters, as declarations
  // -------------------------------------------------------------------------
  const beforeFilters = new Map(before.filterDefinitions.map((filter) => [filter.id, filter]));
  const afterFilters = new Map(after.filterDefinitions.map((filter) => [filter.id, filter]));
  for (const [id, filter] of afterFilters) {
    if (!beforeFilters.has(id)) {
      push({
        kind: "filter",
        action: "added",
        id,
        label: filter.label,
        detail: `Se agregó el filtro “${filter.label}”.`,
      });
    }
  }
  for (const [id, filter] of beforeFilters) {
    if (!afterFilters.has(id)) {
      push({
        kind: "filter",
        action: "removed",
        id,
        label: filter.label,
        detail: `Se quitó el filtro “${filter.label}”.`,
      });
    }
  }
  for (const [id, filter] of afterFilters) {
    const old = beforeFilters.get(id);
    if (!old) continue;
    if (old.label !== filter.label) {
      push({
        kind: "filter",
        action: "renamed",
        id,
        label: filter.label,
        detail: `El filtro “${old.label}” ahora se llama “${filter.label}”.`,
      });
    }
    if (
      old.dimensionId !== filter.dimensionId
      || old.control !== filter.control
      || json(old.defaultValues) !== json(filter.defaultValues)
      || old.clientVisible !== filter.clientVisible
      || old.scope !== filter.scope
      || old.dependsOn !== filter.dependsOn
    ) {
      push({
        kind: "filter",
        action: "changed",
        id,
        label: filter.label,
        detail: `Cambió cómo funciona el filtro “${filter.label}”.`,
      });
    }
  }
  // A connection is what makes a filter move a block, so a change in the set of
  // connections is a change a reader feels even when no block or filter moved.
  const connectionKey = (definition: ExperienceDefinitionV1) =>
    definition.filterConnections
      .map((connection) => `${connection.filterId}>${[...connection.blockIds].sort().join(",")}`)
      .sort()
      .join("|");
  if (connectionKey(before) !== connectionKey(after)) {
    push({
      kind: "filter",
      action: "changed",
      id: after.id,
      label: "Conexiones de filtros",
      detail: "Cambió qué bloques responden a qué filtros.",
    });
  }

  // -------------------------------------------------------------------------
  // Journeys
  // -------------------------------------------------------------------------
  const beforeJourneys = new Map(before.journeyReferences.map((journey) => [journey.id, journey]));
  const afterJourneys = new Map(after.journeyReferences.map((journey) => [journey.id, journey]));
  for (const [id, journey] of afterJourneys) {
    if (!beforeJourneys.has(id)) {
      push({
        kind: "journey",
        action: "added",
        id,
        label: journey.title,
        detail: `Se agregó el recorrido “${journey.title}” con ${journey.moments.length} momentos.`,
      });
    }
  }
  for (const [id, journey] of beforeJourneys) {
    if (!afterJourneys.has(id)) {
      push({
        kind: "journey",
        action: "removed",
        id,
        label: journey.title,
        detail: `Se quitó el recorrido “${journey.title}”.`,
      });
    }
  }
  for (const [id, journey] of afterJourneys) {
    const old = beforeJourneys.get(id);
    if (!old) continue;
    if (old.title !== journey.title) {
      push({
        kind: "journey",
        action: "renamed",
        id,
        label: journey.title,
        detail: `El recorrido “${old.title}” ahora se llama “${journey.title}”.`,
      });
    }
    const oldMoments = new Map(old.moments.map((moment) => [moment.id, moment]));
    const newMoments = new Map(journey.moments.map((moment) => [moment.id, moment]));
    for (const [momentId, moment] of newMoments) {
      if (!oldMoments.has(momentId)) {
        push({
          kind: "journey",
          action: "added",
          id,
          label: `${journey.title} · ${moment.title}`,
          detail: `Se agregó el momento “${moment.title}” a “${journey.title}”.`,
        });
      }
    }
    for (const [momentId, moment] of oldMoments) {
      if (!newMoments.has(momentId)) {
        push({
          kind: "journey",
          action: "removed",
          id,
          label: `${journey.title} · ${moment.title}`,
          detail: `Se quitó el momento “${moment.title}” de “${journey.title}”.`,
        });
      }
    }
    for (const [momentId, moment] of newMoments) {
      const oldMoment = oldMoments.get(momentId);
      if (!oldMoment) continue;
      if (oldMoment.metricId !== moment.metricId) {
        push({
          kind: "journey",
          action: "changed",
          id,
          label: `${journey.title} · ${moment.title}`,
          detail: `“${moment.title}” pasó a mostrar otro resultado.`,
        });
      }
      if (json(oldMoment.awareness) !== json(moment.awareness)) {
        push({
          kind: "journey",
          action: "changed",
          id,
          label: `${journey.title} · ${moment.title}`,
          detail: `Cambió el porcentaje de quienes no conocían “${moment.title}”.`,
        });
      }
      if (oldMoment.visible !== moment.visible) {
        push({
          kind: "journey",
          action: moment.visible ? "restored" : "hidden",
          id,
          label: `${journey.title} · ${moment.title}`,
          detail: moment.visible
            ? `“${moment.title}” vuelve a mostrarse.`
            : `“${moment.title}” ya no se muestra.`,
        });
      }
      if (
        (oldMoment.title !== moment.title)
        || (oldMoment.body ?? "") !== (moment.body ?? "")
        || (oldMoment.description ?? "") !== (moment.description ?? "")
      ) {
        push({
          kind: "journey",
          action: "changed",
          id,
          label: `${journey.title} · ${moment.title}`,
          detail: `Cambió el texto de “${moment.title}”.`,
        });
      }
      if (oldMoment.bandSchemeId !== moment.bandSchemeId || oldMoment.variant !== moment.variant) {
        push({
          kind: "journey",
          action: "changed",
          id,
          label: `${journey.title} · ${moment.title}`,
          detail: `Cambió cómo se dibuja “${moment.title}”.`,
        });
      }
    }
    const momentOrder = (entries: { id: string }[]) => entries.map((moment) => moment.id).join("|");
    if (
      momentOrder(old.moments.filter((moment) => newMoments.has(moment.id)))
      !== momentOrder(journey.moments.filter((moment) => oldMoments.has(moment.id)))
    ) {
      push({
        kind: "journey",
        action: "reordered",
        id,
        label: journey.title,
        detail: `Cambió el orden de los momentos de “${journey.title}”.`,
      });
    }
    if (old.variant !== journey.variant || old.bandSchemeId !== journey.bandSchemeId) {
      push({
        kind: "journey",
        action: "changed",
        id,
        label: journey.title,
        detail: `Cambió cómo se dibuja el recorrido “${journey.title}”.`,
      });
    }
    if (old.visible !== journey.visible) {
      push({
        kind: "journey",
        action: journey.visible ? "restored" : "hidden",
        id,
        label: journey.title,
        detail: journey.visible
          ? `El recorrido “${journey.title}” vuelve a mostrarse.`
          : `El recorrido “${journey.title}” ya no se muestra.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Semáforos
  // -------------------------------------------------------------------------
  const beforeSchemes = new Map(before.bandSchemes.map((scheme) => [scheme.id, scheme]));
  const afterSchemes = new Map(after.bandSchemes.map((scheme) => [scheme.id, scheme]));
  for (const [id, scheme] of afterSchemes) {
    if (!beforeSchemes.has(id)) {
      push({
        kind: "band",
        action: "added",
        id,
        label: scheme.title,
        detail: `Se agregó el semáforo “${scheme.title}” con ${scheme.bands.length} bandas.`,
      });
    }
  }
  for (const [id, scheme] of beforeSchemes) {
    if (!afterSchemes.has(id)) {
      push({
        kind: "band",
        action: "removed",
        id,
        label: scheme.title,
        detail: `Se quitó el semáforo “${scheme.title}”.`,
      });
    }
  }
  for (const [id, scheme] of afterSchemes) {
    const old = beforeSchemes.get(id);
    if (!old) continue;
    if (old.title !== scheme.title) {
      push({
        kind: "band",
        action: "renamed",
        id,
        label: scheme.title,
        detail: `El semáforo “${old.title}” ahora se llama “${scheme.title}”.`,
      });
    }
    if (json(old.bands) !== json(scheme.bands)) {
      push({
        kind: "band",
        action: "changed",
        id,
        label: scheme.title,
        detail:
          `Cambiaron las bandas de “${scheme.title}”. Un mismo número puede quedar de otro color.`,
      });
    }
    if (old.filterMetricId !== scheme.filterMetricId) {
      push({
        kind: "band",
        action: "changed",
        id,
        label: scheme.title,
        detail: scheme.filterMetricId
          ? `“${scheme.title}” ahora también se ofrece como característica para filtrar.`
          : `“${scheme.title}” ya no se ofrece como característica para filtrar.`,
      });
    }
  }

  const counts = Object.fromEntries(DIFF_KINDS.map((kind) => [kind, 0])) as Record<DiffKind, number>;
  for (const change of changes) counts[change.kind] += 1;

  return { changes, identical: changes.length === 0, counts };
}

/** One line summarising a diff, for a history row or a confirmation dialog. */
export function summariseDiff(diff: StructuralDiff): string {
  if (diff.identical) return "Sin cambios estructurales.";
  const parts = DIFF_KINDS.filter((kind) => diff.counts[kind] > 0).map(
    (kind) => `${DIFF_KIND_LABEL[kind]}: ${diff.counts[kind]}`,
  );
  return parts.join(" · ");
}
