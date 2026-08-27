"use client";

import { useState } from "react";
import {
  acceptConsequence,
  mergeConsequence,
  newThemeRefusal,
  rejectConsequence,
  themeKeyFromLabel,
  themeLabel,
  type ThemeOption,
} from "@/lib/studio/theme-picker";

/**
 * Reviewing what people said, without retyping anything (P8.2, contract C1).
 *
 * WHAT DOES NOT CHANGE. The same form, the same field names, the same three
 * actions in the same order, the same Server Action and the same atomic
 * `review_qual_observations` call. A quote is still approved separately from a
 * theme, and a suggestion still publishes nothing by itself.
 *
 * WHAT CHANGES, AND WHY IT MATTERS MORE THAN IT LOOKS.
 *
 *  1. THE THEME IS CHOSEN. The old control was `<input name="theme"
 *     placeholder="comunicacion">`. Typing "Comunicación" one week and
 *     "comunicacion interna" the next produced two themes meaning the same
 *     thing, with nothing on screen saying a third had appeared. Now the themes
 *     this study already carries are offered with their counts, and creating a
 *     genuinely new one is a separate act that REFUSES a name colliding with an
 *     existing theme instead of silently resolving it.
 *
 *  2. THE ROWS REFLOW. The `min-w-[900px]` table became a card per observation,
 *     because this is the screen the consultant actually uses away from her
 *     desk.
 *
 *  3. SELECTION IS PAGE-SCOPED, AND SAYS SO. An action applies to what is
 *     ticked on the page in front of you and to nothing else. Carrying ticks
 *     across pages would mean confirming rows the reviewer never read, which is
 *     the one accident a human-in-the-loop workflow cannot afford.
 */

const field =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";

export type ReviewRow = {
  id: string;
  quote: string | null;
  source: string | null;
  sourceTheme: string | null;
  suggested: string | null;
  confirmed: string | null;
  stageKey: string | null;
  status: "pending" | "confirmed" | "rejected";
  quoteApproved: boolean;
};

export type StageChoice = { id: string; label: string };

const STATUS_LABEL: Record<ReviewRow["status"], string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  rejected: "Descartada",
};

const STATUS_TONE: Record<ReviewRow["status"], string> = {
  pending: "border-caution-line bg-caution-surface text-caution",
  confirmed: "border-positive-line bg-positive-surface text-positive",
  rejected: "border-danger-line bg-danger-surface text-danger",
};

function readable(value: string | null): string | null {
  const key = (value ?? "").trim();
  return key ? themeLabel(key) : null;
}

export function QualitativeReview({
  rows,
  themes,
  stages,
  pager,
}: {
  rows: ReviewRow[];
  /** Every theme in the STUDY, not only on this page. */
  themes: ThemeOption[];
  stages: StageChoice[];
  /** The visible paging control, rendered inside the reviewed region. */
  pager?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [approved, setApproved] = useState<string[]>(
    () => rows.filter((row) => row.quoteApproved).map((row) => row.id),
  );
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [existingKey, setExistingKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [stageKey, setStageKey] = useState("");

  const newKey = themeKeyFromLabel(newLabel);
  const newRefusal = mode === "new" ? newThemeRefusal(newLabel, themes) : null;
  const chosenExisting = themes.find((option) => option.key === existingKey) ?? null;
  const target =
    mode === "new"
      ? newKey && !newRefusal
        ? { key: newKey, label: themeLabel(newKey), confirmed: 0 }
        : null
      : chosenExisting;
  // The exact string the Server Action has always received. Never shown.
  const themeValue = target?.key ?? "";
  const retagBlocked = selected.length === 0 || !target;

  function toggle(id: string, checked: boolean) {
    setSelected((previous) =>
      checked ? [...new Set([...previous, id])] : previous.filter((item) => item !== id),
    );
  }

  return (
    <>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-strong hover:bg-surface-sunken"
              onClick={() =>
                setSelected(selected.length === rows.length ? [] : rows.map((row) => row.id))
              }
            >
              {selected.length === rows.length && rows.length > 0
                ? "Quitar la marca de esta página"
                : "Marcar todas las de esta página"}
            </button>
            <p className="text-sm text-muted" role="status">
              {selected.length === 0
                ? "Nada marcado en esta página."
                : `${selected.length} marcada${selected.length === 1 ? "" : "s"} en esta página.`}
            </p>
          </div>
          {pager}
        </div>

        <p className="text-xs text-muted">
          Las acciones se aplican solo a lo que marcaste en esta página. Al cambiar de página la
          marca se pierde, para que nunca se confirme algo que no leíste.
        </p>

        <ul className="space-y-3">
          {rows.map((row) => {
            const checked = selected.includes(row.id);
            return (
              <li
                key={row.id}
                className={`rounded-xl border bg-surface p-4 ${
                  checked ? "border-evidence-line shadow-raised" : "border-line"
                }`}
              >
                <div className="flex items-start gap-3">
                  <label className="flex min-h-11 items-start gap-2.5 pt-0.5 text-sm">
                    <input
                      type="checkbox"
                      name="observation_id"
                      value={row.id}
                      checked={checked}
                      onChange={(event) => toggle(row.id, event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span className="sr-only">Elegir esta observación</span>
                  </label>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-body">{row.quote || "(sin texto)"}</p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span
                        className={`rounded-full border px-2 py-0.5 font-medium ${STATUS_TONE[row.status]}`}
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                      <span>{row.source ?? "sin fuente"}</span>
                    </p>
                    <dl className="mt-2.5 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                      <div>
                        <dt className="text-muted">Venía del archivo como</dt>
                        <dd className="text-body">{readable(row.sourceTheme) ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">La primera pasada propone</dt>
                        <dd className="text-body">{readable(row.suggested) ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Confirmado como</dt>
                        <dd className="text-body">
                          {readable(row.confirmed) ?? "—"}
                          {row.stageKey ? (
                            <span className="block text-muted">
                              momento: {themeLabel(row.stageKey)}
                            </span>
                          ) : null}
                        </dd>
                      </div>
                    </dl>
                    <label className="mt-3 flex min-h-11 items-center gap-2.5 text-sm text-body">
                      <input
                        type="checkbox"
                        name="quote_id"
                        value={row.id}
                        checked={approved.includes(row.id)}
                        onChange={(event) =>
                          setApproved((previous) =>
                            event.target.checked
                              ? [...new Set([...previous, row.id])]
                              : previous.filter((item) => item !== row.id),
                          )
                        }
                        className="h-4 w-4 shrink-0"
                      />
                      Publicar cita
                    </label>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-voice-line bg-voice-surface p-4 sm:p-5">
        <h2 className="text-base font-semibold text-strong">Acciones sobre lo seleccionado</h2>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <fieldset className="rounded-xl border border-line bg-surface p-3.5">
            <legend className="px-1 text-sm font-semibold text-strong">
              ¿Bajo qué tema quedan?
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["existing", "Un tema que ya existe"],
                  ["new", "Un tema nuevo"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex min-h-11 items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm has-[:checked]:border-evidence-line has-[:checked]:bg-evidence-surface"
                >
                  <input
                    type="radio"
                    name="theme-mode"
                    className="h-4 w-4 shrink-0"
                    checked={mode === value}
                    disabled={value === "existing" && themes.length === 0}
                    onChange={() => setMode(value)}
                  />
                  <span className="font-medium text-strong">{label}</span>
                </label>
              ))}
            </div>

            {mode === "existing" ? (
              themes.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  Este estudio todavía no tiene ningún tema. Crea el primero con un nombre nuevo.
                </p>
              ) : (
                <label className="mt-3 block text-sm font-medium text-strong">
                  Tema
                  <select
                    className={`${field} mt-1 font-normal`}
                    value={existingKey}
                    onChange={(event) => setExistingKey(event.target.value)}
                  >
                    <option value="">Elige un tema…</option>
                    {themes.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                        {option.confirmed > 0
                          ? ` · ${option.confirmed} confirmada${option.confirmed === 1 ? "" : "s"}`
                          : " · todavía sin confirmar"}
                      </option>
                    ))}
                  </select>
                </label>
              )
            ) : (
              <label className="mt-3 block text-sm font-medium text-strong">
                Nombre del tema nuevo
                <input
                  className={`${field} mt-1 font-normal`}
                  maxLength={120}
                  value={newLabel}
                  placeholder="Comunicación con las familias"
                  onChange={(event) => setNewLabel(event.target.value)}
                />
              </label>
            )}

            {newRefusal ? (
              <p
                role="alert"
                className="mt-2.5 rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-xs text-danger"
              >
                {newRefusal}
              </p>
            ) : null}
          </fieldset>

          <label className="text-sm font-medium text-strong">
            ¿A qué momento del recorrido pertenece?
            <select
              className={`${field} mt-1 font-normal`}
              name="stage_key"
              value={stageKey}
              onChange={(event) => setStageKey(event.target.value)}
            >
              <option value="">Sin momento</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.label}
                </option>
              ))}
            </select>
            <span className="mt-1.5 block text-xs text-muted">
              Opcional. Sirve para colgar el comentario del momento que lo explica.
            </span>
          </label>
        </div>

        {/* The Server Action contract, unchanged. Never shown to anyone. */}
        <input type="hidden" name="theme" value={themeValue} />

        <div className="mt-4 space-y-2.5">
          <p className="rounded-lg border border-evidence-line bg-evidence-surface px-3 py-2 text-sm text-body">
            {acceptConsequence(selected.length)}
          </p>
          <p
            className={`rounded-lg border px-3 py-2 text-sm ${
              retagBlocked
                ? "border-line bg-surface-sunken text-muted"
                : "border-evidence-line bg-evidence-surface text-body"
            }`}
          >
            {mergeConsequence(selected.length, target, mode === "new")}
          </p>
          <p className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-muted">
            {rejectConsequence(selected.length)}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            name="mode"
            value="accept"
            disabled={selected.length === 0}
            className="min-h-11 rounded-lg border border-positive-line bg-positive-surface px-4 py-2 text-sm font-semibold text-positive hover:brightness-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Aceptar sugerencias
          </button>
          <button
            name="mode"
            value="retag"
            disabled={retagBlocked}
            className="min-h-11 rounded-lg border border-sky-line bg-sky-surface px-4 py-2 text-sm font-semibold text-strong hover:brightness-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reetiquetar / fusionar
          </button>
          <button
            name="mode"
            value="reject"
            disabled={selected.length === 0}
            className="min-h-11 rounded-lg border border-danger-line bg-danger-surface px-4 py-2 text-sm font-semibold text-danger hover:brightness-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rechazar
          </button>
        </div>
      </section>
    </>
  );
}
