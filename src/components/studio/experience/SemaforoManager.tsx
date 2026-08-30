"use client";

/**
 * WHERE SOMEBODY SAYS WHAT GOOD LOOKS LIKE.
 *
 * The product does not know where verde begins. It cannot: "80 is green" is a
 * statement about one client's standard, and a default supplied here would be
 * the product publishing a verdict nobody made. So this panel is the place a
 * person writes it down — bands, bounds, meanings — and until they do, every
 * block that chose a semáforo says *Falta configurar el semáforo* and shows
 * the number uncoloured.
 *
 * TWO SOURCES, AND THE SECOND ONE MATTERS MORE THAN IT LOOKS.
 *
 *   Por rangos      ordered numeric bands over a declared scale.
 *   Por categorías  a documented categorical field mapped straight across,
 *                   with no arithmetic at all. When a study already records
 *                   "Verde", that IS the answer, and deriving it again from a
 *                   number would be a second, competing truth.
 *
 * AND ONE SCHEME CAN BECOME A FILTER. A study that records a performance score
 * and no performance category cannot offer "Desempeño: Verde / Amarillo /
 * Rojo" — unless somebody writes the rule. These bands are that rule, so
 * naming the result they classify turns them into an ordinary filterable
 * characteristic. Never percentiles: see `band-filters.ts`.
 */

import { useState } from "react";

import {
  BAND_COLOR_ROLES,
  BAND_SHAPES,
  bandRangeText,
  schemeProblems,
  type Band,
  type BandColorRole,
  type BandScheme,
  type BandShape,
} from "@/lib/experience/bands";
import type { ExperienceDefinitionV1 } from "@/lib/experience/definition";
import type { SemanticRegistry } from "@/lib/experience/registry";

const field =
  "mt-1 min-h-11 w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-strong";
const label = "block text-xs font-medium text-body";
const smallButton =
  "min-h-11 min-w-11 rounded-md border border-line px-2 text-sm font-medium text-body hover:bg-surface-sunken disabled:opacity-40";
const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-strong hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-45";

const ROLE_LABEL: Record<BandColorRole, string> = {
  positive: "Verde",
  caution: "Amarillo",
  danger: "Rojo",
  evidence: "Azul",
  neutral: "Gris",
};

const SHAPE_LABEL: Record<BandShape, string> = {
  circle: "Círculo",
  triangle: "Triángulo",
  square: "Cuadrado",
  diamond: "Rombo",
  bar: "Barra",
};

export type SemaforoManagerProps = {
  idPrefix: string;
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  openSchemeId: string | null;
  onOpenScheme: (schemeId: string | null) => void;
  onAddScheme: (title: string) => void;
  onRenameScheme: (schemeId: string, title: string) => void;
  onSchemeDescription: (schemeId: string, description: string) => void;
  onSchemeSource: (schemeId: string, source: "numeric" | "category") => void;
  onSchemeScale: (schemeId: string, scale: { minimum: number; maximum: number } | null) => void;
  onSchemeFilter: (schemeId: string, metricId: string | null, filterLabel: string | null) => void;
  onRemoveScheme: (schemeId: string) => void;
  onAddBand: (schemeId: string, label: string) => void;
  onBand: (schemeId: string, bandId: string, patch: Partial<Omit<Band, "id">>) => void;
  onMoveBand: (schemeId: string, bandId: string, direction: "up" | "down") => void;
  onRemoveBand: (schemeId: string, bandId: string) => void;
};

export function SemaforoManager(props: SemaforoManagerProps) {
  const { definition, registry, openSchemeId } = props;
  const [newTitle, setNewTitle] = useState("");
  const [newBand, setNewBand] = useState("");
  const open = definition.bandSchemes.find((scheme) => scheme.id === openSchemeId) ?? null;
  const id = (name: string) => `${props.idPrefix}-band-${name}`;

  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <h2 className="px-1 font-display text-sm font-semibold text-strong">Semáforos</h2>
      <p className="mt-1 px-1 text-xs text-muted">
        Un semáforo dice qué significa cada color. El producto no lo decide: mientras no haya
        bandas configuradas, un bloque muestra el número sin color y avisa que falta.
      </p>

      <ul className="mt-2 space-y-1">
        {definition.bandSchemes.length === 0 ? (
          <li className="px-1 text-xs text-muted">
            Todavía no hay ningún semáforo en esta experiencia.
          </li>
        ) : null}
        {definition.bandSchemes.map((scheme) => {
          const problems = schemeProblems(scheme);
          return (
            <li key={scheme.id} className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => props.onOpenScheme(scheme.id === openSchemeId ? null : scheme.id)}
                aria-expanded={scheme.id === openSchemeId}
                data-scheme-row={scheme.id}
                className={`flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-md px-2 text-left ${
                  scheme.id === openSchemeId ? "bg-evidence-surface" : "hover:bg-surface-sunken"
                }`}
              >
                <span className="block truncate text-sm font-medium text-strong">{scheme.title}</span>
                <span
                  className={`block truncate text-xs ${problems.length > 0 ? "text-caution" : "text-muted"}`}
                >
                  {problems.length > 0
                    ? `Falta configurar: ${problems[0]}`
                    : `${scheme.bands.length} bandas · listo para usarse`}
                </span>
              </button>
              <button
                type="button"
                className={smallButton}
                onClick={() => props.onRemoveScheme(scheme.id)}
                aria-label={`Quitar el semáforo “${scheme.title}”`}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 px-1">
        <label className={label} htmlFor={id("new")}>
          Añadir un semáforo
        </label>
        <input
          id={id("new")}
          className={field}
          value={newTitle}
          placeholder="Por ejemplo: Desempeño del capítulo"
          onChange={(event) => setNewTitle(event.target.value)}
        />
        <button
          type="button"
          className={`${button} mt-2 w-full`}
          onClick={() => {
            props.onAddScheme(newTitle);
            setNewTitle("");
          }}
        >
          Añadir semáforo
        </button>
      </div>

      {open ? (
        <div className="mt-3 rounded-lg border border-line bg-surface-sunken p-3">
          <label className={label} htmlFor={id("title")}>
            Nombre visible
          </label>
          <input
            id={id("title")}
            className={field}
            value={open.title}
            onChange={(event) => props.onRenameScheme(open.id, event.target.value)}
          />

          <label className={`${label} mt-2`} htmlFor={id("desc")}>
            Qué mide y de dónde salen las bandas
          </label>
          <textarea
            id={id("desc")}
            rows={2}
            className={`${field} min-h-20`}
            value={open.description ?? ""}
            onChange={(event) => props.onSchemeDescription(open.id, event.target.value)}
          />

          <label className={`${label} mt-2`} htmlFor={id("source")}>
            Cómo se clasifica
          </label>
          <select
            id={id("source")}
            className={field}
            value={open.source}
            onChange={(event) =>
              props.onSchemeSource(open.id, event.target.value as "numeric" | "category")
            }
          >
            <option value="numeric">Por rangos de un número</option>
            <option value="category">Por categorías que el estudio ya registra</option>
          </select>

          {open.source === "numeric" ? (
            <div className="mt-2 flex gap-2">
              <div className="min-w-0 flex-1">
                <label className={label} htmlFor={id("min")}>
                  Escala: mínimo
                </label>
                <input
                  id={id("min")}
                  type="number"
                  className={field}
                  value={open.scale?.minimum ?? ""}
                  onChange={(event) =>
                    props.onSchemeScale(
                      open.id,
                      event.target.value === ""
                        ? null
                        : { minimum: Number(event.target.value), maximum: open.scale?.maximum ?? 100 },
                    )
                  }
                />
              </div>
              <div className="min-w-0 flex-1">
                <label className={label} htmlFor={id("max")}>
                  Escala: máximo
                </label>
                <input
                  id={id("max")}
                  type="number"
                  className={field}
                  value={open.scale?.maximum ?? ""}
                  onChange={(event) =>
                    props.onSchemeScale(
                      open.id,
                      event.target.value === ""
                        ? null
                        : { minimum: open.scale?.minimum ?? 0, maximum: Number(event.target.value) },
                    )
                  }
                />
              </div>
            </div>
          ) : null}

          <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Bandas</h4>
          <ul className="mt-1 space-y-2">
            {open.bands.map((band, index) => (
              <BandRow
                key={band.id}
                idPrefix={`${props.idPrefix}-b${index}`}
                scheme={open}
                band={band}
                first={index === 0}
                last={index === open.bands.length - 1}
                onBand={(patch) => props.onBand(open.id, band.id, patch)}
                onMove={(direction) => props.onMoveBand(open.id, band.id, direction)}
                onRemove={() => props.onRemoveBand(open.id, band.id)}
              />
            ))}
          </ul>

          <label className={`${label} mt-2`} htmlFor={id("newband")}>
            Añadir una banda
          </label>
          <input
            id={id("newband")}
            className={field}
            value={newBand}
            onChange={(event) => setNewBand(event.target.value)}
          />
          <button
            type="button"
            className={`${button} mt-2 w-full`}
            onClick={() => {
              props.onAddBand(open.id, newBand);
              setNewBand("");
            }}
          >
            Añadir banda
          </button>

          {/* --- The scheme as a filterable characteristic ----------------- */}
          <fieldset className="mt-3 rounded-md border border-line-strong p-2">
            <legend className="px-1 text-xs font-semibold text-strong">
              Ofrecerlo como característica para filtrar
            </legend>
            <p className="text-xs text-muted">
              Si este semáforo clasifica un resultado, el cliente puede filtrar por sus bandas —
              “solo los que están en rojo”. La regla es exactamente la que está escrita arriba: el
              producto no reparte por percentiles ni inventa cortes.
            </p>
            <label className={`${label} mt-2`} htmlFor={id("filtermetric")}>
              Resultado que clasifica
            </label>
            <select
              id={id("filtermetric")}
              className={field}
              value={open.filterMetricId ?? ""}
              onChange={(event) =>
                props.onSchemeFilter(
                  open.id,
                  event.target.value === "" ? null : event.target.value,
                  open.filterLabel,
                )
              }
            >
              <option value="">No se ofrece como filtro</option>
              {registry.metrics.map((metric) => (
                <option key={metric.id} value={metric.id}>
                  {metric.label}
                  {metric.scale ? ` (${metric.scale.minimum}–${metric.scale.maximum})` : ""}
                </option>
              ))}
            </select>
            {open.filterMetricId ? (
              <>
                <label className={`${label} mt-2`} htmlFor={id("filterlabel")}>
                  Cómo se llama el filtro
                </label>
                <input
                  id={id("filterlabel")}
                  className={field}
                  value={open.filterLabel ?? ""}
                  placeholder={open.title}
                  onChange={(event) =>
                    props.onSchemeFilter(open.id, open.filterMetricId, event.target.value)
                  }
                />
                <p className="mt-1 text-xs text-muted">
                  {schemeProblems(open).length > 0
                    ? "Mientras el semáforo esté incompleto no se ofrecerá como filtro."
                    : `Se ofrecerá con estas opciones: ${open.bands.map((band) => band.label).join(", ")}.`}
                </p>
              </>
            ) : null}
          </fieldset>

          {schemeProblems(open).length > 0 ? (
            <ul className="mt-3 space-y-1 rounded-md border border-caution-line bg-caution-surface p-2 text-xs text-caution">
              {schemeProblems(open).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-md border border-positive-line bg-positive-surface p-2 text-xs text-positive">
              Este semáforo está completo y se puede usar en un bloque o en un recorrido.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function BandRow({
  idPrefix,
  scheme,
  band,
  first,
  last,
  onBand,
  onMove,
  onRemove,
}: {
  idPrefix: string;
  scheme: BandScheme;
  band: Band;
  first: boolean;
  last: boolean;
  onBand: (patch: Partial<Omit<Band, "id">>) => void;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <li className="rounded-md border border-line bg-surface p-2" data-band={band.id}>
      <div className="flex min-w-0 items-center gap-1">
        <input
          className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm font-medium text-strong"
          value={band.label}
          aria-label={`Nombre de la banda “${band.label}”`}
          onChange={(event) => onBand({ label: event.target.value })}
        />
        <button type="button" className={smallButton} disabled={first} onClick={() => onMove("up")} aria-label={`Subir “${band.label}”`}>
          ↑
        </button>
        <button type="button" className={smallButton} disabled={last} onClick={() => onMove("down")} aria-label={`Bajar “${band.label}”`}>
          ↓
        </button>
        <button type="button" className={smallButton} onClick={onRemove} aria-label={`Quitar “${band.label}”`}>
          ✕
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        <div className="min-w-0 flex-1">
          <label className={label} htmlFor={id("role")}>
            Color
          </label>
          <select
            id={id("role")}
            className={field}
            value={band.colorRole}
            onChange={(event) => onBand({ colorRole: event.target.value as BandColorRole })}
          >
            {BAND_COLOR_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <label className={label} htmlFor={id("shape")}>
            Forma
          </label>
          <select
            id={id("shape")}
            className={field}
            value={band.shape}
            onChange={(event) => onBand({ shape: event.target.value as BandShape })}
          >
            {BAND_SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {SHAPE_LABEL[shape]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">
        La forma existe para que el color no sea la única señal: se imprime, se fotocopia y la lee
        quien no distingue el verde del rojo.
      </p>

      {scheme.source === "numeric" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <label className={label} htmlFor={id("lower")}>
              Desde
            </label>
            <input
              id={id("lower")}
              type="number"
              className={field}
              value={band.lower.value ?? ""}
              onChange={(event) =>
                onBand({
                  lower: {
                    value: event.target.value === "" ? null : Number(event.target.value),
                    inclusive: band.lower.inclusive,
                  },
                })
              }
            />
            <label className="mt-1 flex min-h-11 items-center gap-2 text-xs text-body">
              <input
                type="checkbox"
                className="size-4"
                checked={band.lower.inclusive}
                onChange={(event) =>
                  onBand({ lower: { value: band.lower.value, inclusive: event.target.checked } })
                }
              />
              Incluye ese valor
            </label>
          </div>
          <div className="min-w-0 flex-1">
            <label className={label} htmlFor={id("upper")}>
              Hasta
            </label>
            <input
              id={id("upper")}
              type="number"
              className={field}
              value={band.upper.value ?? ""}
              onChange={(event) =>
                onBand({
                  upper: {
                    value: event.target.value === "" ? null : Number(event.target.value),
                    inclusive: band.upper.inclusive,
                  },
                })
              }
            />
            <label className="mt-1 flex min-h-11 items-center gap-2 text-xs text-body">
              <input
                type="checkbox"
                className="size-4"
                checked={band.upper.inclusive}
                onChange={(event) =>
                  onBand({ upper: { value: band.upper.value, inclusive: event.target.checked } })
                }
              />
              Incluye ese valor
            </label>
          </div>
        </div>
      ) : (
        <>
          <label className={`${label} mt-2`} htmlFor={id("values")}>
            Valores que caen en esta banda
          </label>
          <input
            id={id("values")}
            className={field}
            value={band.values.join(", ")}
            placeholder="Por ejemplo: Verde, Excelente"
            onChange={(event) =>
              onBand({
                values: event.target.value
                  .split(",")
                  .map((value) => value.trim())
                  .filter((value) => value !== ""),
              })
            }
          />
        </>
      )}

      <label className={`${label} mt-2`} htmlFor={id("meaning")}>
        Qué significa estar en esta banda
      </label>
      <input
        id={id("meaning")}
        className={field}
        value={band.meaning}
        placeholder="En palabras que el cliente entienda"
        onChange={(event) => onBand({ meaning: event.target.value })}
      />
      <p className="mt-1 text-xs text-muted">Rango actual: {bandRangeText(scheme, band)}</p>
    </li>
  );
}
