"use client";

/**
 * THE RECORRIDO MANAGER — where journeys are defined, not where they are drawn.
 *
 * A study can carry several recorridos. Before this screen the only way to get
 * a second one was to duplicate the block, which quietly forked it: renaming a
 * moment in one left the other saying the old thing. So the definitions live
 * here, in the left panel beside the pages and the study's identity, and a
 * `journey` block on the canvas is a WINDOW onto one of them.
 *
 * The distinction is carried by the wording, everywhere it appears:
 *
 *   Duplicar bloque      a second window onto the same recorrido. Both change
 *                        together, because there is one definition.
 *   Duplicar recorrido   a second recorrido, with fresh identifiers, which can
 *                        then be edited apart from the first. It is NOT placed
 *                        on a page; where it goes is a separate decision.
 *
 * Removing one is protected by what points at it: the manager says which
 * blocks show it and refuses until they are gone, because a block pointing at
 * a deleted definition would make the whole document fail to save for a reason
 * nobody could see on screen.
 */

import { useState } from "react";

import { CHART_SPECS, type ChartVariant } from "@/lib/experience/charts";
import type {
  ExperienceDefinitionV1,
  JourneyMoment,
  JourneyReference,
} from "@/lib/experience/definition";
import { JOURNEY_VARIANTS } from "@/lib/experience/definition";
import type { SemanticMetric, SemanticRegistry } from "@/lib/experience/registry";

const field =
  "mt-1 min-h-11 w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-strong";
const label = "block text-xs font-medium text-body";
const smallButton =
  "min-h-11 min-w-11 rounded-md border border-line px-2 text-sm font-medium text-body hover:bg-surface-sunken disabled:opacity-40";
const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-strong hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-45";

const VARIANT_LABEL: Record<(typeof JOURNEY_VARIANTS)[number], string> = {
  stepped: "En pasos",
  linear: "En línea",
  grid: "En cuadrícula",
};

export type JourneyManagerProps = {
  idPrefix: string;
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  /** Which journey is open for editing, so the panel is not a wall of forms. */
  openJourneyId: string | null;
  onOpenJourney: (journeyId: string | null) => void;
  onAddJourney: (title: string) => void;
  onDuplicateJourney: (journeyId: string) => void;
  onRenameJourney: (journeyId: string, title: string) => void;
  onJourneyDescription: (journeyId: string, description: string) => void;
  onJourneyVariant: (journeyId: string, variant: JourneyReference["variant"]) => void;
  onJourneyBandScheme: (journeyId: string, bandSchemeId: string | null) => void;
  onRemoveJourney: (journeyId: string) => void;
  onAddMoment: (journeyId: string, title: string) => void;
  onDuplicateMoment: (journeyId: string, momentId: string) => void;
  onMoveMoment: (journeyId: string, momentId: string, direction: "up" | "down") => void;
  onRemoveMoment: (journeyId: string, momentId: string) => void;
  onMomentTitle: (journeyId: string, momentId: string, title: string) => void;
  onMomentBody: (journeyId: string, momentId: string, body: string) => void;
  onMomentMetric: (journeyId: string, momentId: string, metricId: string | null) => void;
  onMomentVariant: (journeyId: string, momentId: string, variant: ChartVariant | null) => void;
  onMomentBandScheme: (journeyId: string, momentId: string, bandSchemeId: string | null) => void;
  onMomentAwareness: (
    journeyId: string,
    momentId: string,
    awareness: { metricId: string; label: string | null; values: string[] } | null,
  ) => void;
  onMomentVisible: (journeyId: string, momentId: string, visible: boolean) => void;
};

/** Every block currently showing one recorrido, and where it sits. */
function usage(definition: ExperienceDefinitionV1, journeyId: string) {
  return definition.pages.flatMap((page) =>
    page.blocks
      .filter((block) => block.journeyRef === journeyId)
      .map((block) => ({ page: page.title, title: block.title ?? "Recorrido" })),
  );
}

export function JourneyManager(props: JourneyManagerProps) {
  const { definition, registry, openJourneyId } = props;
  const [newTitle, setNewTitle] = useState("");
  const [newMoment, setNewMoment] = useState("");
  const open = definition.journeyReferences.find((journey) => journey.id === openJourneyId) ?? null;
  const id = (name: string) => `${props.idPrefix}-journey-${name}`;

  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <h2 className="px-1 font-display text-sm font-semibold text-strong">Recorridos</h2>
      <p className="mt-1 px-1 text-xs text-muted">
        Un recorrido se define una vez y se puede mostrar en varias páginas. Duplicar el bloque abre
        otra ventana al mismo recorrido; duplicar el recorrido crea uno nuevo que se edita aparte.
      </p>

      <ul className="mt-2 space-y-1">
        {definition.journeyReferences.length === 0 ? (
          <li className="px-1 text-xs text-muted">
            Todavía no hay ningún recorrido. Crea uno y luego añádelo a una página desde el catálogo.
          </li>
        ) : null}
        {definition.journeyReferences.map((journey) => {
          const shown = usage(definition, journey.id);
          return (
            <li key={journey.id} className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => props.onOpenJourney(journey.id === openJourneyId ? null : journey.id)}
                aria-expanded={journey.id === openJourneyId}
                data-journey-row={journey.id}
                className={`flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-md px-2 text-left ${
                  journey.id === openJourneyId ? "bg-evidence-surface" : "hover:bg-surface-sunken"
                }`}
              >
                <span className="block truncate text-sm font-medium text-strong">
                  {journey.title}
                </span>
                <span className="block truncate text-xs text-muted">
                  {journey.moments.length === 1 ? "1 momento" : `${journey.moments.length} momentos`}
                  {" · "}
                  {shown.length === 0
                    ? "no está en ninguna página"
                    : shown.length === 1
                      ? `en ${shown[0].page}`
                      : `en ${shown.length} bloques`}
                </span>
              </button>
              <button
                type="button"
                className={smallButton}
                onClick={() => props.onDuplicateJourney(journey.id)}
                aria-label={`Duplicar el recorrido “${journey.title}”`}
                title="Duplicar recorrido — crea uno nuevo, no otra ventana al mismo"
              >
                ⧉
              </button>
              <button
                type="button"
                className={smallButton}
                onClick={() => props.onRemoveJourney(journey.id)}
                aria-label={`Quitar el recorrido “${journey.title}”`}
                title={
                  shown.length > 0
                    ? `No se puede quitar: se muestra en ${shown.length} bloque(s)`
                    : "Quitar recorrido"
                }
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 px-1">
        <label className={label} htmlFor={id("new")}>
          Añadir un recorrido
        </label>
        <input
          id={id("new")}
          className={field}
          value={newTitle}
          placeholder="Cómo se llama"
          onChange={(event) => setNewTitle(event.target.value)}
        />
        <button
          type="button"
          className={`${button} mt-2 w-full`}
          onClick={() => {
            props.onAddJourney(newTitle);
            setNewTitle("");
          }}
        >
          Añadir recorrido
        </button>
      </div>

      {open ? (
        <div className="mt-3 rounded-lg border border-line bg-surface-sunken p-3">
          <h3 className="font-display text-sm font-semibold text-strong">{open.title}</h3>

          <label className={`${label} mt-2`} htmlFor={id("title")}>
            Nombre visible
          </label>
          <input
            id={id("title")}
            className={field}
            value={open.title}
            onChange={(event) => props.onRenameJourney(open.id, event.target.value)}
          />

          <label className={`${label} mt-2`} htmlFor={id("desc")}>
            Descripción
          </label>
          <textarea
            id={id("desc")}
            rows={2}
            className={`${field} min-h-20`}
            value={open.description ?? ""}
            onChange={(event) => props.onJourneyDescription(open.id, event.target.value)}
          />

          <label className={`${label} mt-2`} htmlFor={id("variant")}>
            Cómo se dibuja
          </label>
          <select
            id={id("variant")}
            className={field}
            value={open.variant}
            onChange={(event) =>
              props.onJourneyVariant(open.id, event.target.value as JourneyReference["variant"])
            }
          >
            {JOURNEY_VARIANTS.map((variant) => (
              <option key={variant} value={variant}>
                {VARIANT_LABEL[variant]}
              </option>
            ))}
          </select>

          <label className={`${label} mt-2`} htmlFor={id("band")}>
            Semáforo de todos los momentos
          </label>
          <select
            id={id("band")}
            className={field}
            value={open.bandSchemeId ?? ""}
            onChange={(event) =>
              props.onJourneyBandScheme(open.id, event.target.value === "" ? null : event.target.value)
            }
          >
            <option value="">Sin semáforo</option>
            {definition.bandSchemes.map((scheme) => (
              <option key={scheme.id} value={scheme.id}>
                {scheme.title}
              </option>
            ))}
          </select>
          {definition.bandSchemes.length === 0 ? (
            <p className="mt-1 text-xs text-muted">
              Todavía no hay ningún semáforo configurado en esta experiencia.
            </p>
          ) : null}

          <p className="mt-1 text-xs text-muted">
            Familias que admite: {open.eligibleFamilies.join(", ")}. Un momento solo puede usar
            resultados de esas familias.
          </p>

          <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
            Momentos
          </h4>
          <ul className="mt-1 space-y-2">
            {open.moments.map((moment, index) => (
              <MomentCard
                key={moment.id}
                idPrefix={`${props.idPrefix}-m${index}`}
                journey={open}
                moment={moment}
                definition={definition}
                registry={registry}
                first={index === 0}
                last={index === open.moments.length - 1}
                onTitle={(value) => props.onMomentTitle(open.id, moment.id, value)}
                onBody={(value) => props.onMomentBody(open.id, moment.id, value)}
                onMetric={(value) => props.onMomentMetric(open.id, moment.id, value)}
                onVariant={(value) => props.onMomentVariant(open.id, moment.id, value)}
                onBandScheme={(value) => props.onMomentBandScheme(open.id, moment.id, value)}
                onAwareness={(value) => props.onMomentAwareness(open.id, moment.id, value)}
                onVisible={(value) => props.onMomentVisible(open.id, moment.id, value)}
                onMove={(direction) => props.onMoveMoment(open.id, moment.id, direction)}
                onDuplicate={() => props.onDuplicateMoment(open.id, moment.id)}
                onRemove={() => props.onRemoveMoment(open.id, moment.id)}
              />
            ))}
            {open.moments.length === 0 ? (
              <li className="text-xs text-muted">
                Este recorrido todavía no tiene momentos. Añade el primero abajo.
              </li>
            ) : null}
          </ul>

          <label className={`${label} mt-2`} htmlFor={id("newmoment")}>
            Añadir un momento
          </label>
          <input
            id={id("newmoment")}
            className={field}
            value={newMoment}
            placeholder="Cómo se llama"
            onChange={(event) => setNewMoment(event.target.value)}
          />
          <button
            type="button"
            className={`${button} mt-2 w-full`}
            onClick={() => {
              props.onAddMoment(open.id, newMoment);
              setNewMoment("");
            }}
          >
            Añadir momento
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * ONE MOMENT'S CONFIGURATION.
 *
 * The awareness mapping is the part worth reading. It is TWO fields, both
 * required together: which result carries "did you know this existed", and
 * which of its recorded answers mean "no". Neither is guessable, and the
 * screen says so rather than offering a plausible default — a percentage whose
 * numerator the product chose is a number nobody can defend.
 */
function MomentCard({
  idPrefix,
  journey,
  moment,
  definition,
  registry,
  first,
  last,
  onTitle,
  onBody,
  onMetric,
  onVariant,
  onBandScheme,
  onAwareness,
  onVisible,
  onMove,
  onDuplicate,
  onRemove,
}: {
  idPrefix: string;
  journey: JourneyReference;
  moment: JourneyMoment;
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  first: boolean;
  last: boolean;
  onTitle: (value: string) => void;
  onBody: (value: string) => void;
  onMetric: (value: string | null) => void;
  onVariant: (value: ChartVariant | null) => void;
  onBandScheme: (value: string | null) => void;
  onAwareness: (
    value: { metricId: string; label: string | null; values: string[] } | null,
  ) => void;
  onVisible: (value: boolean) => void;
  onMove: (direction: "up" | "down") => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  // Only the results this recorrido declares it can carry. Offering the rest
  // and refusing the choice afterwards is a menu that lies.
  const eligible: SemanticMetric[] = registry.metrics.filter(
    (metric) => metric.journeyEligible && journey.eligibleFamilies.includes(metric.family),
  );
  /*
   * THE HALF-FILLED MAPPING LIVES HERE, AND ONLY HERE.
   *
   * The document refuses to STORE an awareness mapping with a result and no
   * answers — correctly, because that shape would compute a percentage with no
   * numerator. But the two fields are filled one after the other, and if the
   * second one only appeared once the first had been stored, nobody could ever
   * reach it: the store refuses the first half, so the second half never
   * renders, so the first half can never be completed. That is a deadlock, and
   * it is the reason this component holds the in-progress choice itself and
   * hands the document a mapping only when both halves exist.
   *
   * `chosen` is what the person picked a moment ago; `moment.awareness` is what
   * the document actually holds. They differ for exactly as long as it takes to
   * type the answers, and the screen says which state it is in.
   */
  const [pendingMetric, setPendingMetric] = useState<string | null>(null);
  const chosenMetricId = moment.awareness?.metricId ?? pendingMetric ?? "";
  const awarenessMetric = chosenMetricId
    ? registry.metrics.find((metric) => metric.id === chosenMetricId) ?? null
    : null;
  const awarenessValues = moment.awareness?.values ?? [];

  return (
    <li className="rounded-md border border-line bg-surface p-2" data-moment={moment.id}>
      <div className="flex min-w-0 items-center gap-1">
        <input
          className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm font-medium text-strong"
          value={moment.title}
          aria-label={`Nombre del momento “${moment.title}”`}
          onChange={(event) => onTitle(event.target.value)}
        />
        <button
          type="button"
          className={smallButton}
          disabled={first}
          onClick={() => onMove("up")}
          aria-label={`Subir “${moment.title}”`}
        >
          ↑
        </button>
        <button
          type="button"
          className={smallButton}
          disabled={last}
          onClick={() => onMove("down")}
          aria-label={`Bajar “${moment.title}”`}
        >
          ↓
        </button>
        <button
          type="button"
          className={smallButton}
          onClick={onDuplicate}
          aria-label={`Duplicar “${moment.title}”`}
        >
          ⧉
        </button>
        <button
          type="button"
          className={smallButton}
          onClick={onRemove}
          aria-label={`Quitar “${moment.title}”`}
        >
          ✕
        </button>
      </div>

      <label className={`${label} mt-2`} htmlFor={id("metric")}>
        Resultado que muestra
      </label>
      <select
        id={id("metric")}
        className={field}
        value={moment.metricId ?? ""}
        onChange={(event) => onMetric(event.target.value === "" ? null : event.target.value)}
      >
        <option value="">Sin resultado todavía</option>
        {eligible.map((metric) => (
          <option key={metric.id} value={metric.id}>
            {metric.label}
            {metric.responses === 0 ? " (sin respuestas)" : ""}
          </option>
        ))}
      </select>

      <label className={`${label} mt-2`} htmlFor={id("body")}>
        Texto de este momento
      </label>
      <textarea
        id={id("body")}
        rows={2}
        className={`${field} min-h-20`}
        value={moment.body ?? ""}
        onChange={(event) => onBody(event.target.value)}
      />

      <label className={`${label} mt-2`} htmlFor={id("variant")}>
        Cómo se dibuja este momento
      </label>
      <select
        id={id("variant")}
        className={field}
        value={moment.variant ?? ""}
        onChange={(event) =>
          onVariant(event.target.value === "" ? null : (event.target.value as ChartVariant))
        }
      >
        <option value="">Como el resto del recorrido</option>
        {(["kpi", "traffic_light", "bar_horizontal"] as ChartVariant[]).map((variant) => (
          <option key={variant} value={variant}>
            {CHART_SPECS[variant].label}
          </option>
        ))}
      </select>

      <label className={`${label} mt-2`} htmlFor={id("band")}>
        Semáforo de este momento
      </label>
      <select
        id={id("band")}
        className={field}
        value={moment.bandSchemeId ?? ""}
        onChange={(event) => onBandScheme(event.target.value === "" ? null : event.target.value)}
      >
        <option value="">Como el recorrido</option>
        {definition.bandSchemes.map((scheme) => (
          <option key={scheme.id} value={scheme.id}>
            {scheme.title}
          </option>
        ))}
      </select>

      {/* --- "No sabía que existía este momento" ------------------------- */}
      <fieldset className="mt-3 rounded-md border border-line-strong p-2">
        <legend className="px-1 text-xs font-semibold text-strong">
          Quién no conocía este momento
        </legend>
        <p className="text-xs text-muted">
          Es una pregunta distinta de la satisfacción. Hay que decir qué resultado la mide y qué
          respuestas exactas significan “no lo conocía”: una respuesta en blanco no cuenta como que
          no lo conocía.
        </p>
        <label className={`${label} mt-2`} htmlFor={id("aware")}>
          Resultado que lo mide
        </label>
        <select
          id={id("aware")}
          className={field}
          value={chosenMetricId}
          onChange={(event) => {
            const next = event.target.value;
            setPendingMetric(next === "" ? null : next);
            // Clearing it clears the stored mapping too. Choosing one stores
            // nothing yet — there is no honest mapping until the answers that
            // mean "no lo conocía" have been named.
            if (next === "" || awarenessValues.length === 0) {
              if (moment.awareness) onAwareness(null);
              return;
            }
            onAwareness({ metricId: next, label: moment.awareness?.label ?? null, values: awarenessValues });
          }}
        >
          <option value="">No se mide</option>
          {registry.metrics.map((metric) => (
            <option key={metric.id} value={metric.id}>
              {metric.label}
            </option>
          ))}
        </select>

        {chosenMetricId ? (
          <>
            <label className={`${label} mt-2`} htmlFor={id("awarevalues")}>
              Respuestas que significan “no lo conocía”
            </label>
            <input
              id={id("awarevalues")}
              className={field}
              defaultValue={awarenessValues.join(", ")}
              placeholder="Por ejemplo: 100, No lo conocía"
              onChange={(event) => {
                const values = event.target.value
                  .split(",")
                  .map((value) => value.trim())
                  .filter((value) => value !== "");
                if (values.length === 0) {
                  if (moment.awareness) onAwareness(null);
                  return;
                }
                onAwareness({
                  metricId: chosenMetricId,
                  label: moment.awareness?.label ?? null,
                  values,
                });
              }}
            />
            <p
              className={`mt-1 text-xs ${awarenessValues.length === 0 ? "text-caution" : "text-muted"}`}
            >
              {awarenessValues.length === 0
                ? "Falta esto: sin respuestas marcadas el porcentaje no tendría numerador, así que todavía no se guarda nada."
                : `Se contarán como “no lo conocía”: ${awarenessValues.join(", ")}.`}
              {awarenessMetric && awarenessMetric.scale
                ? ` Este resultado va de ${awarenessMetric.scale.minimum} a ${awarenessMetric.scale.maximum}.`
                : ""}
            </p>
          </>
        ) : null}
      </fieldset>

      <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-body">
        <input
          type="checkbox"
          className="size-4"
          checked={moment.visible}
          onChange={(event) => onVisible(event.target.checked)}
        />
        Se muestra en el recorrido
      </label>
    </li>
  );
}
