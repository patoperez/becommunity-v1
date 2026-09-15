"use client";

import { useRef, useState, type ReactNode } from "react";
import type { JourneyStage } from "@/lib/calc/journey";
import {
  addStageDraft,
  editStageDraft,
  optionsForStage,
  removeStageDraft,
  stageConsequence,
  stageDraftRefusal,
  toStageEditorDrafts,
  type JourneyMetricOption,
  type StageEditorDraft,
} from "@/lib/studio/journey-picker";

/**
 * The recorrido, built by choosing rather than by typing (P8.2, contract C1).
 *
 * It replaces three raw text inputs — a stable identifier, a display name and a
 * canonical metric key in a monospace box with the placeholder `metric_key`.
 * Two of those three were things the consultant was expected to remember, and
 * getting either wrong produced a moment that renders with no number and no
 * explanation.
 *
 * What it submits is unchanged: the same four `stage_*` field groups in the
 * same order, read by the same Server Action and validated by the same
 * `journeyDefinitionSchema`. This component is convenience, never a control.
 *
 * THE IDENTIFIER IS GENERATED ONCE AND THEN LEFT ALONE. A stage that already
 * exists keeps the id it was saved with, whatever its name becomes, because
 * `qual_observation.confirmed_stage_key` points at that id: regenerating it on
 * a rename would detach every comment a consultant had already filed against
 * that moment.
 *
 * THE ROW IS KEYED ON `uid`, NEVER ON THE STORED ID AND NEVER ON THE POSITION.
 * A stage that has never been saved still derives its stored id from its own
 * name, so keying the row on that id moved the key on every keystroke: React
 * replaced the row, the browser discarded the focused input with it, and a
 * moment could only be named one character per click.
 */

const field =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";

const MAX_STAGES = 30;

export function JourneyStagesFields({
  initialStages,
  options,
  submitLabel,
  submitClassName,
  children,
}: {
  initialStages: JourneyStage[];
  /** The results this study genuinely produced. Never another study's. */
  options: JourneyMetricOption[];
  submitLabel: string;
  submitClassName: string;
  /** The rest of the form: identity, publication state, visible sections. */
  children?: ReactNode;
}) {
  const [drafts, setDrafts] = useState<StageEditorDraft[]>(() =>
    toStageEditorDrafts(initialStages),
  );
  /** Monotonic and never reused, so a removed row cannot resurrect its key. */
  const added = useRef(0);

  const refusal = stageDraftRefusal(drafts);

  function addStage() {
    added.current += 1;
    const sequence = added.current;
    setDrafts((previous) => addStageDraft(previous, sequence));
  }

  return (
    <>
      {children}

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-strong">Momentos del recorrido</h3>
            <p className="mt-1 max-w-prose text-xs text-muted">
              Cada momento muestra un resultado del estudio. Elige cuál: la lista solo ofrece los
              que este estudio realmente produjo.
            </p>
          </div>
          <button
            type="button"
            onClick={addStage}
            disabled={drafts.length >= MAX_STAGES}
            className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            Añadir momento
          </button>
        </div>

        {options.length === 0 ? (
          <p className="mt-3 rounded-lg border border-caution-line bg-caution-surface px-3 py-2.5 text-sm text-caution">
            Este estudio todavía no tiene resultados numéricos, así que no hay nada que un momento
            pueda mostrar. Carga los datos primero.
          </p>
        ) : null}

        <div className="mt-3 space-y-3">
          {drafts.map((draft) => {
            const stageOptions = optionsForStage(options, draft.metric);
            const chosen = stageOptions.find((option) => option.key === draft.metric) ?? null;
            const historical = chosen !== null && !chosen.available;
            return (
              <div key={draft.uid} className="rounded-xl border border-line bg-surface-page p-3.5">
                {/* The stored identifier travels with the stage and is never
                    presented as something to fill in. */}
                <input type="hidden" name="stage_id" value={draft.id} />

                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <label className="text-sm font-medium text-strong">
                    Nombre del momento
                    <input
                      className={`${field} mt-1 font-normal`}
                      name="stage_label"
                      required
                      maxLength={120}
                      value={draft.label}
                      placeholder="Primer contacto"
                      onChange={(event) => {
                        const label = event.target.value;
                        setDrafts((previous) => editStageDraft(previous, draft.uid, { label }));
                      }}
                    />
                  </label>

                  <label className="text-sm font-medium text-strong">
                    ¿Qué resultado lo mide?
                    <select
                      className={`${field} mt-1 font-normal`}
                      name="stage_metric"
                      required
                      value={draft.metric}
                      onChange={(event) => {
                        const metric = event.target.value;
                        setDrafts((previous) => editStageDraft(previous, draft.uid, { metric }));
                      }}
                    >
                      <option value="">Elige un resultado…</option>
                      {stageOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.name}
                          {option.available
                            ? option.today == null
                              ? " · sin respuestas hoy"
                              : ` · hoy ${option.today}`
                            : " · ya no aparece en los datos"}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() => setDrafts((previous) => removeStageDraft(previous, draft.uid))}
                    className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-danger hover:bg-danger-surface"
                  >
                    Quitar
                  </button>
                </div>

                <p
                  className={`mt-2.5 rounded-lg border px-3 py-2 text-xs ${
                    historical
                      ? "border-caution-line bg-caution-surface text-caution"
                      : "border-evidence-line bg-evidence-surface text-body"
                  }`}
                >
                  {stageConsequence(chosen)}
                </p>

                <label className="mt-3 block text-sm font-medium text-strong">
                  Descripción <span className="font-normal text-muted">(opcional)</span>
                  <textarea
                    className={`${field} mt-1 font-normal`}
                    name="stage_description"
                    maxLength={500}
                    rows={2}
                    value={draft.description}
                    placeholder="Qué vive la persona en este momento."
                    onChange={(event) => {
                      const description = event.target.value;
                      setDrafts((previous) => editStageDraft(previous, draft.uid, { description }));
                    }}
                  />
                </label>
              </div>
            );
          })}
        </div>

        {drafts.length === 0 ? (
          <p className="mt-3 rounded-lg border border-line bg-surface-sunken px-3 py-2.5 text-sm text-muted">
            Este estudio no tiene recorrido. Puedes añadir momentos cuando quieras; sin ellos, el
            cliente sencillamente no verá esa sección.
          </p>
        ) : null}
      </section>

      {refusal ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-sm text-danger"
        >
          {refusal}
        </p>
      ) : null}

      <button className={submitClassName} disabled={Boolean(refusal)}>
        {submitLabel}
      </button>
    </>
  );
}
