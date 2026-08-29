"use client";

import { useId, useMemo, useState } from "react";

import { blockCatalogue, blockSpec, type BlockType } from "@/lib/experience/blocks";
import { CHART_SPECS, type ChartVariant } from "@/lib/experience/charts";
import { canAddBlock } from "@/lib/experience/defaults";
import {
  filtersAffecting,
  findBlock,
  parseExperienceDefinition,
  type ExperienceBlock,
  type ExperienceDefinitionV1,
} from "@/lib/experience/definition";
import { BREAKPOINTS, BREAKPOINT_WIDTHS } from "@/lib/experience/layout";
import {
  addBlock,
  duplicateBlock,
  initialState,
  moveBlock,
  removeBlock,
  resetPrototype,
  selectBlock,
  setBlockTitle,
  setBlockVisibility,
  setChartVariant,
  setStudySamplePolicy,
} from "@/lib/experience/prototype";
import { findDimension, findMetric, type SemanticRegistry } from "@/lib/experience/registry";
import {
  evaluateSampleVisibility,
  resolveSamplePolicy,
  SAMPLE_POLICY_MODES,
  type SamplePolicyMode,
} from "@/lib/experience/sample-policy";
import { serializeExperienceDefinition } from "@/lib/experience/serialize";
import { validateExperienceDefinition } from "@/lib/experience/validate";

/**
 * "Construcción del dashboard" — the internal prototype.
 *
 * WHAT IT IS FOR. Before anything is built to STORE a composed experience, the
 * team has to know whether the mental model is right: does thinking in pages,
 * blocks, connections and a disclosure policy match how a consultant actually
 * wants to assemble a client's study? That question is answered by moving
 * things around, not by reading a schema. So this screen loads a real study
 * through the compatibility adapter and lets somebody rearrange it.
 *
 * WHAT IT DELIBERATELY IS NOT. It saves nothing. There is no autosave, no
 * Server Action, no draft, no publication. Closing the tab discards everything,
 * which is stated on the screen rather than left to be discovered. Every edit
 * is a pure function from `src/lib/experience/prototype.ts`; this component
 * holds one state object and calls them.
 *
 * The technical vocabulary stays out of the interface. A block is named by what
 * it is ("Gráfica", "Recorrido"), never by its type token; a result is named by
 * what it measures, never by its handle; and the serialized document is
 * reachable only through a download, never rendered on screen.
 */

const MODE_LABEL: Record<SamplePolicyMode, string> = {
  show_all: "Mostrar todos los resultados",
  warn_below: "Mostrar con aviso cuando hay pocas respuestas",
  hide_below: "Ocultar cuando hay pocas respuestas",
};

const MODE_DETAIL: Record<SamplePolicyMode, string> = {
  show_all:
    "Los resultados se ven desde una sola respuesta. Es la opción por omisión para las experiencias nuevas.",
  warn_below:
    "El número se ve siempre; debajo del mínimo se acompaña de un aviso de que descansa en pocas respuestas.",
  hide_below:
    "Debajo del mínimo el resultado no se muestra. Es la regla con la que funcionan hoy los estudios existentes.",
};

const BREAKPOINT_LABEL: Record<(typeof BREAKPOINTS)[number], string> = {
  desktop: "Computadora",
  tablet: "Tableta",
  mobile: "Teléfono",
};

const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-strong transition-colors duration-[var(--motion-state)] hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-45";

export function ExperienceComposer({
  original,
  registry,
  adapterWarnings,
}: {
  original: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  adapterWarnings: { code: string; detail: string }[];
}) {
  const [state, setState] = useState(() => initialState(original));
  const ids = useId().replace(/:/g, "");
  const { definition, selectedBlockId } = state;

  const schemaIssues = useMemo(() => {
    const parsed = parseExperienceDefinition(definition);
    return parsed.ok ? [] : parsed.issues;
  }, [definition]);

  const report = useMemo(
    () => validateExperienceDefinition(definition, registry),
    [definition, registry],
  );

  // A linear scan over a few dozen blocks, computed on every render on purpose:
  // it is cheaper than the memo that would guard it, and the React compiler
  // cannot preserve a manual memo whose body returns early.
  const selected = selectedBlockId ? findBlock(definition, selectedBlockId) : null;

  const catalogue = useMemo(
    () =>
      blockCatalogue().map((group) => ({
        ...group,
        blocks: group.blocks.filter((spec) =>
          canAddBlock(spec.id, registry, definition.journeyReferences.length > 0),
        ),
      })),
    [registry, definition.journeyReferences.length],
  );

  const [pendingType, setPendingType] = useState<BlockType>("rich_text");

  function download() {
    const contents = serializeExperienceDefinition(definition, { pretty: true });
    const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "construccion-prototipo.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  const policy = definition.sampleVisibilityPolicy;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-caution-line bg-caution-surface p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-caution">
          Solo para el equipo de Be Community
        </p>
        <h2 className="mt-1 font-display text-lg font-semibold text-caution">
          Nada de lo que hagas aquí se guarda ni se publica
        </h2>
        <p className="mt-1 max-w-prose text-sm text-caution">
          Esta pantalla arma el estudio actual con el modelo nuevo para ver si la forma de trabajar
          es la correcta. Los cambios viven solo mientras la pestaña esté abierta: al recargar
          vuelve a aparecer la configuración real del estudio, que no se toca en ningún momento.
        </p>
      </section>

      {/* ---- The study-wide disclosure rule -------------------------------- */}
      <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="font-display text-base font-semibold text-strong">
          Cuándo se muestra un resultado con pocas respuestas
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Esta regla vale para todo el estudio. Un bloque puede tener la suya propia, y en ese caso
          manda la del bloque.
        </p>
        <fieldset className="mt-3">
          <legend className="sr-only">Regla del estudio</legend>
          <div className="space-y-2">
            {SAMPLE_POLICY_MODES.map((mode) => (
              <label
                key={mode}
                className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                  policy.mode === mode
                    ? "border-evidence-line bg-evidence-surface"
                    : "border-line bg-surface hover:bg-surface-sunken"
                }`}
              >
                <input
                  type="radio"
                  name={`${ids}-policy`}
                  value={mode}
                  checked={policy.mode === mode}
                  onChange={() => setState((current) => setStudySamplePolicy(current, mode))}
                  className="mt-1 size-4"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-strong">{MODE_LABEL[mode]}</span>
                  <span className="block text-sm text-muted">{MODE_DETAIL[mode]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {policy.mode === "show_all" ? null : (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-body">
            <label htmlFor={`${ids}-threshold`} className="font-medium text-strong">
              Mínimo de respuestas
            </label>
            <input
              id={`${ids}-threshold`}
              type="number"
              min={1}
              max={200}
              value={policy.threshold}
              onChange={(event) =>
                setState((current) =>
                  setStudySamplePolicy(current, policy.mode, Number(event.target.value) || 1),
                )
              }
              className="min-h-11 w-24 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong"
            />
          </p>
        )}
        <p className="mt-3 text-sm text-muted">
          Con esta regla, un resultado con una sola respuesta{" "}
          <strong className="font-semibold text-strong">
            {describeOutcome(evaluateSampleVisibility(1, policy).state)}
          </strong>
          {"; "}
          con cuatro{" "}
          <strong className="font-semibold text-strong">
            {describeOutcome(evaluateSampleVisibility(4, policy).state)}
          </strong>
          .
        </p>
      </section>

      {/* ---- What the model could and could not say ------------------------ */}
      <ValidationPanel
        schemaIssues={schemaIssues}
        errors={report.errors}
        warnings={report.warnings}
        adapterWarnings={adapterWarnings}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ---- Pages and blocks ------------------------------------------- */}
        <div className="min-w-0 space-y-5">
          {definition.pages.map((page) => (
            <section key={page.id} className="rounded-xl border border-line bg-surface p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-base font-semibold text-strong">{page.title}</h2>
                <p className="text-xs text-muted">
                  {page.blocks.length === 1 ? "1 bloque" : `${page.blocks.length} bloques`}
                </p>
              </div>

              <ul className="mt-3 space-y-2">
                {page.blocks.map((block, index) => (
                  <li key={block.id}>
                    <BlockRow
                      block={block}
                      selected={block.id === selectedBlockId}
                      first={index === 0}
                      last={index === page.blocks.length - 1}
                      onSelect={() => setState((current) => selectBlock(current, block.id))}
                      onMove={(direction) =>
                        setState((current) => moveBlock(current, block.id, direction))
                      }
                      onDuplicate={() => setState((current) => duplicateBlock(current, block.id))}
                      onToggle={() =>
                        setState((current) => setBlockVisibility(current, block.id, !block.visible))
                      }
                      onRemove={() => setState((current) => removeBlock(current, block.id))}
                    />
                  </li>
                ))}
                {page.blocks.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">
                    Esta página todavía no tiene bloques.
                  </li>
                ) : null}
              </ul>

              <div className="mt-4 flex flex-wrap items-end gap-2">
                <div className="min-w-0">
                  <label
                    htmlFor={`${ids}-add-${page.id}`}
                    className="block text-sm font-medium text-strong"
                  >
                    Añadir a “{page.title}”
                  </label>
                  <select
                    id={`${ids}-add-${page.id}`}
                    value={pendingType}
                    onChange={(event) => setPendingType(event.target.value as BlockType)}
                    className="mt-1 min-h-11 w-full max-w-xs rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong sm:w-auto"
                  >
                    {catalogue.map((group) => (
                      <optgroup key={group.group} label={group.label}>
                        {group.blocks.map((spec) => (
                          <option key={spec.id} value={spec.id}>
                            {spec.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className={button}
                  onClick={() =>
                    setState((current) => addBlock(current, page.id, pendingType, registry))
                  }
                >
                  Añadir bloque
                </button>
              </div>
            </section>
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              onClick={() => setState((current) => resetPrototype(current, original))}
            >
              Volver a la configuración actual
            </button>
            <button type="button" className={button} onClick={download}>
              Descargar esta versión
            </button>
          </div>
        </div>

        {/* ---- Inspector --------------------------------------------------- */}
        <aside className="min-w-0">
          <div className="rounded-xl border border-line bg-surface p-4 sm:p-5 lg:sticky lg:top-4">
            <h2 className="font-display text-base font-semibold text-strong">Bloque seleccionado</h2>
            {selected ? (
              <BlockInspector
                key={selected.block.id}
                block={selected.block}
                pageTitle={selected.page.title}
                registry={registry}
                definition={definition}
                idPrefix={ids}
                onTitle={(title) =>
                  setState((current) => setBlockTitle(current, selected.block.id, title))
                }
                onVariant={(variant) =>
                  setState((current) => setChartVariant(current, selected.block.id, variant))
                }
              />
            ) : (
              <p className="mt-2 text-sm text-muted">
                Elige un bloque de la izquierda para ver de dónde sale su número, qué filtros lo
                mueven y cómo se acomoda en cada pantalla.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function describeOutcome(state: string): string {
  if (state === "visible") return "se muestra";
  if (state === "warning") return "se muestra con aviso";
  if (state === "suppressed") return "no se muestra";
  return "no tiene datos";
}

function BlockRow({
  block,
  selected,
  first,
  last,
  onSelect,
  onMove,
  onDuplicate,
  onToggle,
  onRemove,
}: {
  block: ExperienceBlock;
  selected: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
  onMove: (direction: "up" | "down") => void;
  onDuplicate: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const spec = blockSpec(block.type as BlockType);
  const name = block.title ?? spec.label;
  const small =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-strong hover:bg-surface-sunken disabled:opacity-40";
  return (
    <div
      className={`rounded-lg border p-3 ${
        selected ? "border-evidence-line bg-evidence-surface" : "border-line bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className="min-h-11 min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-sm font-semibold text-strong">{name}</span>
          <span className="block text-xs text-muted">
            {spec.label}
            {block.visible ? "" : " · oculto"}
          </span>
        </button>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={small}
            onClick={() => onMove("up")}
            disabled={first}
            aria-label={`Subir “${name}”`}
          >
            Subir
          </button>
          <button
            type="button"
            className={small}
            onClick={() => onMove("down")}
            disabled={last}
            aria-label={`Bajar “${name}”`}
          >
            Bajar
          </button>
          <button
            type="button"
            className={small}
            onClick={onDuplicate}
            aria-label={`Duplicar “${name}”`}
          >
            Duplicar
          </button>
          <button
            type="button"
            className={small}
            onClick={onToggle}
            aria-pressed={!block.visible}
            aria-label={block.visible ? `Ocultar “${name}”` : `Mostrar “${name}”`}
          >
            {block.visible ? "Ocultar" : "Mostrar"}
          </button>
          <button
            type="button"
            className={small}
            onClick={onRemove}
            aria-label={`Quitar “${name}” del prototipo`}
          >
            Quitar
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockInspector({
  block,
  pageTitle,
  registry,
  definition,
  idPrefix,
  onTitle,
  onVariant,
}: {
  block: ExperienceBlock;
  pageTitle: string;
  registry: SemanticRegistry;
  definition: ExperienceDefinitionV1;
  idPrefix: string;
  onTitle: (title: string) => void;
  onVariant: (variant: ChartVariant) => void;
}) {
  const spec = blockSpec(block.type as BlockType);
  const metric = block.query ? findMetric(registry, block.query.metricId) : null;
  const dimensions = block.query
    ? [block.query.primaryDimensionId, block.query.secondaryDimensionId]
        .filter((id): id is string => typeof id === "string")
        .map((id) => findDimension(registry, id))
        .filter((dimension): dimension is NonNullable<typeof dimension> => Boolean(dimension))
    : [];
  const moving = filtersAffecting(definition, block.id)
    .map((filterId) => definition.filterDefinitions.find((filter) => filter.id === filterId))
    .filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));
  const effective = resolveSamplePolicy(definition.sampleVisibilityPolicy, block.samplePolicy);

  return (
    <div className="mt-3 space-y-4">
      <p className="text-sm text-muted">
        {spec.label} · en “{pageTitle}”
      </p>

      <div>
        <label htmlFor={`${idPrefix}-title`} className="block text-sm font-medium text-strong">
          Título visible
        </label>
        <input
          id={`${idPrefix}-title`}
          type="text"
          value={block.title ?? ""}
          onChange={(event) => onTitle(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong"
        />
      </div>

      {block.visualization ? (
        <div>
          <label htmlFor={`${idPrefix}-variant`} className="block text-sm font-medium text-strong">
            Cómo se dibuja
          </label>
          <select
            id={`${idPrefix}-variant`}
            value={block.visualization.variant}
            onChange={(event) => onVariant(event.target.value as ChartVariant)}
            className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong"
          >
            {spec.variants.map((variant) => (
              <option key={variant} value={variant}>
                {CHART_SPECS[variant].label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-sm text-muted">
            {CHART_SPECS[block.visualization.variant].description}
          </p>
        </div>
      ) : null}

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium text-strong">Resultado</dt>
          <dd className="text-muted">
            {metric
              ? `${metric.label} — ${metric.question}`
              : spec.requiresQuery
                ? "Sin resultado elegido."
                : "Este bloque no lee un resultado."}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-strong">Desglose</dt>
          <dd className="text-muted">
            {dimensions.length === 0
              ? "Sin desglose."
              : dimensions
                  .map(
                    (dimension) =>
                      `${dimension.label} (${dimension.values.length} ${
                        dimension.values.length === 1 ? "valor" : "valores"
                      })`,
                  )
                  .join(" · ")}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-strong">Filtros que lo mueven</dt>
          <dd className="text-muted">
            {moving.length === 0
              ? "Ninguno. Un filtro mueve este bloque solo si está conectado a él."
              : moving.map((filter) => filter.label).join(" · ")}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-strong">Con pocas respuestas</dt>
          <dd className="text-muted">
            {block.samplePolicy.kind === "inherit"
              ? "Sigue la regla del estudio: "
              : "Regla propia de este bloque: "}
            {MODE_LABEL[effective.mode].toLowerCase()}
            {effective.mode === "show_all" ? "." : ` (mínimo ${effective.threshold}).`}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-strong">Ancho en pantalla</dt>
          <dd className="text-muted">
            {BREAKPOINTS.map(
              (breakpoint) =>
                `${BREAKPOINT_LABEL[breakpoint]} (${BREAKPOINT_WIDTHS[breakpoint]} px): ${
                  block.layout[breakpoint].span
                } de 12`,
            ).join(" · ")}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function ValidationPanel({
  schemaIssues,
  errors,
  warnings,
  adapterWarnings,
}: {
  schemaIssues: { path: string; message: string }[];
  errors: { code: string; detail: string }[];
  warnings: { code: string; detail: string }[];
  adapterWarnings: { code: string; detail: string }[];
}) {
  const blocking = schemaIssues.length + errors.length;
  return (
    <section
      aria-live="polite"
      className={`rounded-xl border p-4 sm:p-5 ${
        blocking > 0 ? "border-danger-line bg-danger-surface" : "border-line bg-surface"
      }`}
    >
      <h2
        className={`font-display text-base font-semibold ${
          blocking > 0 ? "text-danger" : "text-strong"
        }`}
      >
        {blocking > 0
          ? "Esto impediría guardar la experiencia"
          : "La experiencia es válida tal como está"}
      </h2>
      {blocking > 0 ? (
        <ul className="mt-2 space-y-1.5 text-sm text-danger">
          {schemaIssues.slice(0, 8).map((issue) => (
            <li key={`${issue.path}-${issue.message}`}>
              {issue.path ? `${issue.path}: ` : ""}
              {issue.message}
            </li>
          ))}
          {errors.slice(0, 8).map((issue) => (
            <li key={`${issue.code}-${issue.detail}`}>{issue.detail}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">
          Nada de lo que hay en pantalla contradice el modelo. Los avisos de abajo son sugerencias:
          se puede publicar sin atenderlos.
        </p>
      )}

      {warnings.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-caution">Avisos que no impiden nada</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm text-caution">
            {warnings.slice(0, 10).map((issue) => (
              <li key={`${issue.code}-${issue.detail}`}>{issue.detail}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {adapterWarnings.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-strong">
            Lo que el modelo todavía no sabe representar de este estudio
          </h3>
          <ul className="mt-1.5 space-y-1.5 text-sm text-muted">
            {adapterWarnings.map((issue) => (
              <li key={`${issue.code}-${issue.detail}`}>{issue.detail}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
