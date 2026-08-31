"use client";

/**
 * The two things that are not blocks-with-numbers: the study's identity, and
 * the reader's own filter controls.
 *
 * BOTH ARE RENDERED BY ONE COMPONENT EACH, USED ON BOTH SURFACES — the
 * builder's canvas and the internal draft preview. On the canvas the controls
 * are inert and the identity carries a quiet note that it is configured apart
 * from the pages; in the preview the same markup is live. Two components would
 * be two chances for the preview to disagree with what the author was looking
 * at while composing it, which is the one thing a preview may not do.
 */

import type { ViewerSelection } from "@/lib/experience/data";
import {
  panelControls,
  panelTargetBlockIds,
} from "@/lib/experience/filters";
import type {
  ExperienceBlock,
  ExperienceDefinitionV1,
  ExperienceIdentity,
  FilterDefinition,
} from "@/lib/experience/definition";
import type { SemanticRegistry } from "@/lib/experience/registry";

export type ViewerContext = {
  selection: ViewerSelection;
  onChange: (filterId: string, values: string[]) => void;
  onClear: (filterIds: string[]) => void;
};

/**
 * How several choices combine, in the words a reader gets rather than as
 * behaviour they have to infer by watching numbers move. Stated on every
 * panel, because a filter box whose logic is a guess is a filter box that
 * produces confident wrong readings.
 */
export const COMBINATION_NOTE =
  "Si eliges varios valores de una misma característica, se suman. Si eliges características distintas, se combinan y el resultado es más específico.";

// ---------------------------------------------------------------------------
// Identidad y portada del estudio
// ---------------------------------------------------------------------------

/**
 * IDENTITY IS NOT A BLOCK, AND THIS IS WHERE THAT BECOMES TRUE ON SCREEN.
 *
 * It renders once, before the pages, and it is not part of any page's block
 * list — so it cannot be reordered under a chart, it is not counted among
 * Panorama's blocks, and hiding a page never hides who the report is for.
 *
 * Every part is shown only when it is both turned on AND has something in it.
 * A heading with nothing under it, or a reserved line for a period the study
 * does not have, is exactly the "absence rendered as a finding" the client
 * contract forbids.
 */
export function IdentityLayer({
  identity,
  note,
  onDownload,
}: {
  identity: ExperienceIdentity;
  /** An internal aside. Never rendered on anything a client receives. */
  note?: string | null;
  onDownload?: (() => void) | null;
}) {
  if (!identity.visible) return null;

  const title = identity.show.title && identity.title.trim() !== "" ? identity.title : null;
  const organization =
    identity.show.organization && identity.organization?.trim() ? identity.organization : null;
  const period = identity.show.period && identity.period?.trim() ? identity.period : null;
  const description =
    identity.show.description && identity.description?.trim() ? identity.description : null;
  const mark = identity.show.mark && identity.mark.source === "client_brand";

  if (!title && !organization && !period && !description && !mark) return null;

  return (
    <header
      className="min-w-0 rounded-xl border border-line bg-surface px-4 py-4 sm:px-5 sm:py-5"
      aria-label="Identidad del estudio"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {organization || period ? (
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {[organization, period].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {title ? (
            <h2 className="mt-0.5 font-display text-xl font-semibold text-strong sm:text-2xl">
              {title}
            </h2>
          ) : null}
        </div>
        {mark ? (
          <span className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted">
            Marca del cliente
          </span>
        ) : null}
      </div>

      {description ? <p className="mt-2 max-w-3xl text-sm text-body">{description}</p> : null}

      {identity.showReportDownload ? (
        <button
          type="button"
          onClick={onDownload ?? undefined}
          disabled={!onDownload}
          className="mt-3 min-h-11 rounded-lg border border-line px-3 text-sm font-medium text-body hover:bg-surface-sunken disabled:opacity-70"
        >
          Descargar el informe
        </button>
      ) : null}

      {note ? <p className="mt-3 text-xs text-muted">{note}</p> : null}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Panel de filtros para explorar
// ---------------------------------------------------------------------------

export function FilterPanelView({
  block,
  definition,
  registry,
  viewer,
}: {
  block: ExperienceBlock;
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  viewer?: ViewerContext;
}) {
  const config = block.filterPanel;
  if (!config) return null;

  const controls = panelControls(definition, block);
  const governed = panelTargetBlockIds(definition, block);
  const live = viewer ?? null;

  const active = controls.flatMap((filter) => {
    const values = live?.selection[filter.id] ?? [];
    return values.length > 0 ? [{ filter, values: [...values] }] : [];
  });

  if (controls.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong bg-surface-sunken px-3 py-2.5 text-sm">
        <p className="font-medium text-strong">{block.title ?? "Panel de filtros"}</p>
        <p className="mt-0.5 text-xs text-muted">
          Todavía no ofrece ninguna característica, así que el cliente no verá ningún control aquí.
        </p>
      </div>
    );
  }

  const columns =
    config.layout === "stacked"
      ? "grid grid-cols-1 gap-2"
      : config.layout === "grid"
        ? "grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
        : "flex flex-wrap gap-2";

  return (
    <section
      className="min-w-0 rounded-lg border border-line-strong bg-surface-sunken px-3 py-3"
      aria-label={block.title ?? "Panel de filtros"}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 font-display text-sm font-semibold text-strong">
          {block.title ?? "Panel de filtros"}
        </p>
        {config.showClear && live ? (
          <button
            type="button"
            onClick={() => live.onClear(controls.map((filter) => filter.id))}
            disabled={active.length === 0}
            className="min-h-11 shrink-0 rounded-md border border-line px-3 text-sm font-medium text-body hover:bg-surface disabled:opacity-50"
          >
            Limpiar filtros
          </button>
        ) : null}
      </div>

      {config.intro ? <p className="mt-1 text-xs text-muted">{config.intro}</p> : null}

      {config.showActive ? (
        <p className="mt-2 text-xs text-body" aria-live="polite">
          {active.length === 0 ? (
            <span className="text-muted">Sin filtros: se ven todas las respuestas.</span>
          ) : (
            <>
              <span className="font-medium text-strong">Estás viendo: </span>
              {active.map(({ filter, values }) => `${filter.label}: ${values.join(", ")}`).join(" · ")}
            </>
          )}
        </p>
      ) : null}

      <div className={`mt-2 min-w-0 ${columns}`}>
        {controls.map((filter) => (
          <PanelControl
            key={filter.id}
            filter={filter}
            registry={registry}
            selection={live?.selection[filter.id] ?? []}
            onChange={live ? (values) => live.onChange(filter.id, values) : null}
            inline={config.layout === "inline"}
          />
        ))}
      </div>

      <p className="mt-2 text-xs text-muted">
        {governed.size === 0
          ? "Todavía no está conectado con ningún bloque."
          : governed.size === 1
            ? "Cambia 1 bloque."
            : `Cambia ${governed.size} bloques.`}{" "}
        {COMBINATION_NOTE}
      </p>
    </section>
  );
}

/**
 * One control.
 *
 * A native `select`, because it is what the deployed dashboard already uses,
 * what a 320 px screen can hold, and what a keyboard and a screen reader
 * already know how to operate. A bespoke multi-select widget would be a new
 * accessibility surface to get right for no gain the reader can feel.
 *
 * The options come from the STUDY'S REGISTRY, so a panel can only ever offer
 * values the study actually carries. A value nobody imported cannot be chosen,
 * which is why no reader choice can name a respondent or reach past what the
 * aggregate layer already exposes.
 */
function PanelControl({
  filter,
  registry,
  selection,
  onChange,
  inline,
}: {
  filter: FilterDefinition;
  registry: SemanticRegistry;
  selection: readonly string[];
  onChange: ((values: string[]) => void) | null;
  inline: boolean;
}) {
  const dimension = registry.dimensions.find((entry) => entry.id === filter.dimensionId);
  const options = dimension?.values ?? [];
  const id = `panel-control-${filter.id}`;
  const multiple = filter.control === "multi_select";

  if (options.length === 0) {
    return (
      <p className="min-w-0 text-xs text-muted">
        {filter.label}: esta característica ya no tiene valores en el estudio.
      </p>
    );
  }

  /*
   * ON THE BUILDER'S CANVAS THIS IS A PICTURE OF A CONTROL, SO IT IS DRAWN AS
   * ONE.
   *
   * `onChange === null` means nobody is exploring: the canvas deliberately does
   * not let the author's own clicks move numbers underneath their edit. Until
   * now that was a `disabled` select, which is non-operable but still announced
   * to a screen reader as a form control, still lands in the tab order's
   * disabled set, and — the moment the canvas is drawn at a scale — is a 26 px
   * form control on screen.
   *
   * Drawing it as text says the same thing more truthfully: here is the
   * control, here is what it opens with, and it is not something you operate
   * from this screen. The real control, at full size, is what the draft
   * preview, the revision preview and the client all render, because all three
   * pass a `viewer`.
   */
  if (!onChange) {
    const opening = selection.length > 0
      ? options
          .filter((option) => selection.includes(option.value))
          .map((option) => option.label)
          .join(", ")
      : multiple
        ? "Sin selección"
        : "Todas";
    return (
      <div className={inline ? "min-w-0 basis-56 grow" : "min-w-0"}>
        <p className="block text-xs font-medium text-body">{filter.label}</p>
        <p className="mt-1 min-w-0 truncate rounded-md border border-dashed border-line bg-surface px-2 py-1.5 text-sm text-muted">
          {opening}
          <span className="sr-only"> — así abre para el cliente; no se opera desde el lienzo.</span>
        </p>
      </div>
    );
  }

  return (
    <div className={inline ? "min-w-0 basis-56 grow" : "min-w-0"}>
      <label htmlFor={id} className="block text-xs font-medium text-body">
        {filter.label}
      </label>
      <select
        id={id}
        multiple={multiple}
        size={multiple ? Math.min(4, options.length) : undefined}
        value={multiple ? [...selection] : (selection[0] ?? "")}
        onChange={(event) => {
          const chosen = multiple
            ? [...event.target.selectedOptions].map((option) => option.value)
            : event.target.value === ""
              ? []
              : [event.target.value];
          onChange(chosen);
        }}
        className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-strong"
      >
        {multiple ? null : <option value="">Todas</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
