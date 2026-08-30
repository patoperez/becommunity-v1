"use client";

/**
 * The two authoring surfaces this milestone adds to the builder: the study's
 * IDENTITY, which is configured apart from every page, and a filter PANEL's
 * card, which is where a person says what the panel offers and what it moves.
 *
 * They live beside the builder rather than inside it because the builder is
 * already the largest file in the product, and because both are self-contained
 * controlled components: they render the document they are given and call back
 * with an intent. No state, no effects, no data.
 */

import { blockSpec, type BlockType } from "@/lib/experience/blocks";
import {
  filterTargetRefusal,
  isFilterTargetable,
  panelTargetBlockIds,
  sectionMembers,
} from "@/lib/experience/filters";
import type {
  ExperienceBlock,
  ExperienceDefinitionV1,
  ExperienceIdentity,
  FilterPanelLayout,
  FilterTarget,
} from "@/lib/experience/definition";

const field =
  "mt-1 min-h-11 w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-strong";
const label = "block text-xs font-medium text-body";
const smallButton =
  "min-h-11 min-w-11 rounded-md border border-line px-2 text-sm font-medium text-body hover:bg-surface-sunken disabled:opacity-40";

// ---------------------------------------------------------------------------
// Identidad y portada del estudio
// ---------------------------------------------------------------------------

/**
 * IT IS NOT IN THE BLOCK CATALOGUE, AND THAT IS THE POINT.
 *
 * The study's own name, client, period and introduction are what the report
 * IS; they are not a section of Panorama. Editing them here — once, apart from
 * every page — is what stops them being reordered under a chart, counted among
 * a page's blocks, or duplicated along with the page they happened to sit on.
 *
 * Every part has its own switch, and a part with nothing written in it renders
 * as nothing rather than as an empty line.
 */
export function IdentityPanel({
  idPrefix,
  identity,
  onText,
  onToggle,
  onVisible,
  onReportDownload,
}: {
  idPrefix: string;
  identity: ExperienceIdentity;
  onText: (field: "title" | "organization" | "period" | "description", value: string) => void;
  onToggle: (part: "title" | "organization" | "period" | "description" | "mark", shown: boolean) => void;
  onVisible: (visible: boolean) => void;
  onReportDownload: (offered: boolean) => void;
}) {
  const id = (name: string) => `${idPrefix}-identity-${name}`;
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-3">
      <h3 className="font-display text-sm font-semibold text-strong">
        Identidad y portada del estudio
      </h3>
      <p className="mt-1 text-xs text-muted">
        Se muestra una vez, antes de las páginas. No es un bloque: no se reordena con Panorama ni
        se cuenta entre sus bloques.
      </p>

      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-body">
        <input
          type="checkbox"
          checked={identity.visible}
          onChange={(event) => onVisible(event.target.checked)}
          className="size-4"
        />
        Mostrar la portada
      </label>

      <div className="mt-2 space-y-2">
        <div>
          {/*
            "Nombre", not "Título visible" — the block card already has a field
            called "Título visible", and two fields whose names differ only by a
            trailing "del estudio" are two fields somebody types into the wrong
            one of. Naming them apart is cheaper than explaining the difference.
          */}
          <label className={label} htmlFor={id("title")}>
            Nombre visible del estudio
          </label>
          <input
            id={id("title")}
            type="text"
            className={field}
            value={identity.title}
            onChange={(event) => onText("title", event.target.value)}
          />
        </div>

        <IdentityField
          id={id("organization")}
          name="Cliente u organización"
          value={identity.organization}
          shown={identity.show.organization}
          onValue={(value) => onText("organization", value)}
          onShown={(shown) => onToggle("organization", shown)}
        />
        <IdentityField
          id={id("period")}
          name="Periodo"
          value={identity.period}
          shown={identity.show.period}
          onValue={(value) => onText("period", value)}
          onShown={(shown) => onToggle("period", shown)}
        />

        <div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <label className={label} htmlFor={id("description")}>
              Descripción introductoria
            </label>
            <label className="flex min-h-11 items-center gap-1.5 text-xs text-body">
              <input
                type="checkbox"
                checked={identity.show.description}
                onChange={(event) => onToggle("description", event.target.checked)}
                className="size-4"
              />
              Mostrar
            </label>
          </div>
          <textarea
            id={id("description")}
            rows={3}
            className={`${field} min-h-24`}
            value={identity.description ?? ""}
            onChange={(event) => onText("description", event.target.value)}
          />
        </div>

        <label className="flex min-h-11 items-center gap-2 text-sm text-body">
          <input
            type="checkbox"
            checked={identity.show.mark}
            onChange={(event) => onToggle("mark", event.target.checked)}
            className="size-4"
          />
          Mostrar la marca del cliente
        </label>

        <label className="flex min-h-11 items-center gap-2 text-sm text-body">
          <input
            type="checkbox"
            checked={identity.showReportDownload}
            onChange={(event) => onReportDownload(event.target.checked)}
            className="size-4"
          />
          Ofrecer la descarga del informe en la portada
        </label>
      </div>

      <p className="mt-2 text-xs text-muted">
        Las páginas siguen aceptando títulos y textos propios; esto solo saca la identidad del
        estudio de Panorama.
      </p>
    </section>
  );
}

function IdentityField({
  id,
  name,
  value,
  shown,
  onValue,
  onShown,
}: {
  id: string;
  name: string;
  value: string | null;
  shown: boolean;
  onValue: (value: string) => void;
  onShown: (shown: boolean) => void;
}) {
  return (
    <div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <label className={label} htmlFor={id}>
          {name}
        </label>
        <label className="flex min-h-11 items-center gap-1.5 text-xs text-body">
          <input
            type="checkbox"
            checked={shown}
            onChange={(event) => onShown(event.target.checked)}
            className="size-4"
          />
          Mostrar
        </label>
      </div>
      <input id={id} type="text" className={field} value={value ?? ""} onChange={(event) => onValue(event.target.value)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The filter panel's card
// ---------------------------------------------------------------------------

const TARGET_LABEL: Record<FilterTarget["kind"], string> = {
  experience: "Todos los bloques compatibles de la experiencia",
  page: "Todos los bloques compatibles de esta página",
  sections: "Solo las secciones que elija",
  blocks: "Solo los bloques que elija",
};

/**
 * WHAT EACH SCOPE ACTUALLY DOES, said next to the choice.
 *
 * "Toda la experiencia" and "Página actual" resolve AT RENDER TIME, so a block
 * added afterwards joins what the panel already moves. The other two are by
 * identifier and stay by identifier, so renaming a section or a block never
 * changes what a panel governs. Both facts change what a person should expect
 * and neither is guessable from the label alone.
 */
const SCOPE_EXPLANATION: Record<FilterTarget["kind"], string> = {
  experience:
    "Mueve todos los bloques con datos de toda la experiencia, incluidos los que se añadan después.",
  page: "Mueve todos los bloques con datos de la página donde está el panel, incluidos los que se añadan después.",
  sections:
    "Mueve los bloques con datos que van debajo de cada encabezado elegido, hasta el siguiente encabezado.",
  blocks: "Mueve exactamente los bloques que elijas, y ninguno más.",
};

const LAYOUT_LABEL: Record<FilterPanelLayout, string> = {
  inline: "En una fila que se acomoda sola",
  stacked: "Uno debajo del otro",
  grid: "En cuadrícula",
};

export function FilterPanelCard({
  idPrefix,
  block,
  definition,
  onIntro,
  onLayout,
  onOption,
  onToggleFilter,
  onMoveFilter,
  onTarget,
  onToggleTargetBlock,
}: {
  idPrefix: string;
  block: ExperienceBlock;
  definition: ExperienceDefinitionV1;
  onIntro: (value: string) => void;
  onLayout: (layout: FilterPanelLayout) => void;
  onOption: (option: "showClear" | "showActive", on: boolean) => void;
  onToggleFilter: (filterId: string, offered: boolean) => void;
  onMoveFilter: (filterId: string, direction: "up" | "down") => void;
  onTarget: (target: FilterTarget) => void;
  onToggleTargetBlock: (blockId: string, connected: boolean) => void;
}) {
  const panel = block.filterPanel;
  if (!panel) return null;
  const id = (name: string) => `${idPrefix}-panel-${name}`;
  const governed = panelTargetBlockIds(definition, block);
  const offered = block.filterRefs;

  const sections = definition.pages.flatMap((page) =>
    page.blocks
      .filter((candidate) => candidate.type === "section")
      .map((candidate) => ({ page, block: candidate })),
  );

  const candidates = definition.pages.flatMap((page) =>
    page.blocks
      .filter((candidate) => candidate.id !== block.id)
      .map((candidate) => ({ page, block: candidate })),
  );
  const compatibleTargets = candidates.filter((entry) => isFilterTargetable(entry.block));
  const incompatibleTargets = candidates.flatMap((entry) => {
    const reason = filterTargetRefusal(entry.block);
    return reason ? [{ ...entry, reason }] : [];
  });

  return (
    <section className="mt-3 rounded-lg border border-line bg-surface-sunken p-3">
      <h4 className="font-display text-sm font-semibold text-strong">Panel de filtros</h4>
      <p className="mt-1 text-xs text-muted">
        Es la caja con la que el cliente explora. Cambia la vista mientras la usa; no cambia los
        datos ni lo que quedó guardado.
      </p>

      <div className="mt-2">
        <label className={label} htmlFor={id("intro")}>
          Explicación visible
        </label>
        <textarea
          id={id("intro")}
          rows={2}
          className={`${field} min-h-20`}
          value={panel.intro ?? ""}
          onChange={(event) => onIntro(event.target.value)}
        />
      </div>

      <div className="mt-2">
        <label className={label} htmlFor={id("layout")}>
          Cómo se acomodan los controles
        </label>
        <select
          id={id("layout")}
          className={field}
          value={panel.layout}
          onChange={(event) => onLayout(event.target.value as FilterPanelLayout)}
        >
          {(Object.keys(LAYOUT_LABEL) as FilterPanelLayout[]).map((option) => (
            <option key={option} value={option}>
              {LAYOUT_LABEL[option]}
            </option>
          ))}
        </select>
      </div>

      <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-body">
        <input
          type="checkbox"
          checked={panel.showClear}
          onChange={(event) => onOption("showClear", event.target.checked)}
          className="size-4"
        />
        Ofrecer “Limpiar filtros”
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm text-body">
        <input
          type="checkbox"
          checked={panel.showActive}
          onChange={(event) => onOption("showActive", event.target.checked)}
          className="size-4"
        />
        Mostrar arriba lo que está seleccionado
      </label>

      {/* ---- Which characteristics it offers, and in what order ---------- */}
      <h5 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
        Características que ofrece
      </h5>
      {definition.filterDefinitions.length === 0 ? (
        <p className="mt-1 text-xs text-muted">Este estudio no tiene características filtrables.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {[
            ...offered.flatMap((filterId) => {
              const filter = definition.filterDefinitions.find((entry) => entry.id === filterId);
              return filter ? [filter] : [];
            }),
            ...definition.filterDefinitions.filter((filter) => !offered.includes(filter.id)),
          ].map((filter) => {
            const on = offered.includes(filter.id);
            const position = offered.indexOf(filter.id);
            return (
              <li key={filter.id} className="flex min-w-0 items-center gap-1">
                <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm text-body">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(event) => onToggleFilter(filter.id, event.target.checked)}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 truncate">{filter.label}</span>
                </label>
                <button
                  type="button"
                  className={smallButton}
                  disabled={!on || position <= 0}
                  aria-label={`Subir “${filter.label}” en el panel`}
                  onClick={() => onMoveFilter(filter.id, "up")}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={smallButton}
                  disabled={!on || position < 0 || position >= offered.length - 1}
                  aria-label={`Bajar “${filter.label}” en el panel`}
                  onClick={() => onMoveFilter(filter.id, "down")}
                >
                  ↓
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* ---- What it moves ----------------------------------------------
          THIS IS THE PRIMARY CONNECTION EDITOR.

          Which blocks a filter moves is decided HERE, on the panel, once —
          not on every block's own card as a checklist of the whole
          characteristic registry. A block's card states which panel moves it
          and links back to this one. --------------------------------------- */}
      <h5 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
        Qué cambia este panel
      </h5>
      <p className="mt-1 text-xs text-muted">{SCOPE_EXPLANATION[panel.target.kind]}</p>
      <label className={label} htmlFor={id("target")}>
        Alcance
      </label>
      <select
        id={id("target")}
        className={field}
        value={panel.target.kind}
        onChange={(event) => {
          const kind = event.target.value as FilterTarget["kind"];
          if (kind === "experience" || kind === "page") {
            onTarget({ kind });
            return;
          }
          if (kind === "sections") {
            const first = sections[0];
            if (first) onTarget({ kind: "sections", sectionIds: [first.block.id] });
            return;
          }
          const firstCompatible = definition.pages
            .flatMap((page) => page.blocks)
            .find((candidate) => candidate.id !== block.id && isFilterTargetable(candidate) && candidate.type !== "filter_panel");
          if (firstCompatible) onTarget({ kind: "blocks", blockIds: [firstCompatible.id] });
        }}
      >
        {(Object.keys(TARGET_LABEL) as FilterTarget["kind"][]).map((kind) => (
          <option key={kind} value={kind} disabled={kind === "sections" && sections.length === 0}>
            {TARGET_LABEL[kind]}
          </option>
        ))}
      </select>

      {panel.target.kind === "sections" ? (
        <ul className="mt-2 space-y-1">
          {sections.map(({ page, block: section }) => {
            const chosen = panel.target.kind === "sections" && panel.target.sectionIds.includes(section.id);
            const members = sectionMembers(page, section.id).filter(isFilterTargetable).length;
            return (
              <li key={section.id}>
                <label className="flex min-h-11 items-center gap-2 text-sm text-body">
                  <input
                    type="checkbox"
                    checked={chosen}
                    onChange={(event) => {
                      const current =
                        panel.target.kind === "sections" ? panel.target.sectionIds : [];
                      const next = event.target.checked
                        ? [...current, section.id]
                        : current.filter((candidate) => candidate !== section.id);
                      onTarget({ kind: "sections", sectionIds: next });
                    }}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0">
                    {section.title ?? "Sección"}{" "}
                    <span className="text-muted">
                      · {page.title} · {members === 1 ? "1 bloque" : `${members} bloques`}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}

      {panel.target.kind === "blocks" ? (
        /*
         * COMPATIBLE AND INCOMPATIBLE TARGETS, VISUALLY SEPARATED.
         *
         * They used to be one undifferentiated list in document order, so a
         * divider, a paragraph and a KPI sat side by side and the only
         * difference was that one checkbox happened to be disabled. The
         * compatible ones are the list; the rest are folded away under a
         * heading that says they are not offered, each with the reason, so a
         * person who wonders "why can I not tick the interpretation" gets an
         * answer without the answer being in their way.
         */
        <>
          <ul className="mt-2 space-y-1">
            {compatibleTargets.length === 0 ? (
              <li className="text-xs text-muted">
                Esta experiencia todavía no tiene ningún bloque que se recalcule con un filtro.
              </li>
            ) : null}
            {compatibleTargets.map(({ page, block: candidate }) => {
              const chosen =
                panel.target.kind === "blocks" && panel.target.blockIds.includes(candidate.id);
              const name = candidate.title ?? blockSpec(candidate.type as BlockType).label;
              return (
                <li key={candidate.id}>
                  <label className="flex min-h-11 items-center gap-2 text-sm text-body">
                    <input
                      type="checkbox"
                      checked={chosen}
                      onChange={(event) => onToggleTargetBlock(candidate.id, event.target.checked)}
                      className="size-4 shrink-0"
                    />
                    <span className="min-w-0">
                      {name} <span className="text-muted">· {page.title}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {incompatibleTargets.length > 0 ? (
            <details className="mt-2 rounded-lg border border-line bg-surface p-2">
              <summary className="min-h-11 cursor-pointer list-none py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                No se pueden conectar ({incompatibleTargets.length})
              </summary>
              <ul className="mt-1 space-y-1">
                {incompatibleTargets.map(({ page, block: candidate, reason }) => (
                  <li key={candidate.id}>
                    <label className="flex min-h-11 items-center gap-2 text-sm text-muted">
                      <input type="checkbox" checked={false} disabled readOnly className="size-4 shrink-0" />
                      <span className="min-w-0">
                        {candidate.title ?? blockSpec(candidate.type as BlockType).label}{" "}
                        <span>· {page.title} · {reason}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}

      <p className="mt-2 text-xs text-muted">
        {governed.size === 0
          ? "Ahora mismo no cambia ningún bloque."
          : governed.size === 1
            ? "Ahora mismo cambia 1 bloque."
            : `Ahora mismo cambia ${governed.size} bloques.`}
        {" "}
        Los bloques de contenido fijo — texto, encabezados, la lectura del equipo, la portada y el
        botón de descarga — quedan fuera siempre, con cualquier alcance.
      </p>
      {governed.size > 0 ? (
        <ul className="mt-1 space-y-0.5 text-xs text-muted">
          {compatibleTargets
            .filter((entry) => governed.has(entry.block.id))
            .map((entry) => (
              <li key={entry.block.id} className="min-w-0 truncate">
                · {entry.block.title ?? blockSpec(entry.block.type as BlockType).label}{" "}
                <span>({entry.page.title})</span>
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  );
}
