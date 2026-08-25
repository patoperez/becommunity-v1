"use client";

import { useState } from "react";
import type { ColumnTarget, ImportMapping, RecodingTable } from "@/lib/ingestion/mapping";
import {
  DESTINATION_CHOICES,
  QUALITATIVE_SOURCE_CHOICES,
  destinationLabel,
  destinationOptions,
  duplicateSegmentDestinations,
  keyFromLabel,
  nameRejectionReason,
  recodingTableLabel,
  targetForKind,
  targetKey,
  withTargetKey,
  type DestinationKind,
} from "@/lib/ingestion/destinations";
import type { KnownDestinations } from "./actions";
import type { QualitativeSource } from "@/lib/ingestion/canonical";

/**
 * Step 2 of the import: deciding what each column of the file becomes.
 *
 * The screen this replaces asked the operator to TYPE the stored key for every
 * segment, metric and theme, and to type a recoding table's identifier, inside
 * a 900px-wide table. Getting one of those characters wrong does not fail — it
 * quietly creates a second destination, and two periods of the same study stop
 * being comparable. Here every destination is chosen from what already exists,
 * or named in ordinary words once and derived into a stable key.
 *
 * The mapping object this produces is exactly the one the previous screen
 * produced: same schema, same keys, same recoding tables, same saved-mapping
 * reuse. Nothing about ingestion changed.
 */

const NEW = "__nuevo__";

const control =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";
const smallControl =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";
const quietButton =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-strong transition-colors duration-[var(--motion-state)] hover:bg-surface-sunken";

function knownFor(known: KnownDestinations, kind: DestinationKind): string[] {
  if (kind === "segment") return known.segments;
  if (kind === "quantitative") return known.metrics;
  if (kind === "qualitative") return known.themes;
  return [];
}

export function MappingWorkbench({
  mapping,
  samplesByHeader,
  known,
  onChange,
}: {
  mapping: ImportMapping;
  samplesByHeader: Record<string, string[]>;
  known: KnownDestinations;
  onChange: (mapping: ImportMapping) => void;
}) {
  const [namingColumn, setNamingColumn] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newNameError, setNewNameError] = useState<string | null>(null);
  const [tableNames, setTableNames] = useState<Record<number, string>>({});
  const [tableNameError, setTableNameError] = useState<Record<number, string>>({});

  const shared = duplicateSegmentDestinations(mapping);
  const imported = mapping.columns.filter((column) => column.target.kind !== "ignore").length;

  function updateTarget(index: number, target: ColumnTarget) {
    onChange({
      ...mapping,
      columns: mapping.columns.map((column, columnIndex) =>
        columnIndex === index ? { ...column, target } : column,
      ),
    });
  }

  function updateTable(index: number, table: RecodingTable) {
    const previousId = mapping.recodingTables[index]?.id;
    const recodingTables = mapping.recodingTables.map((item, tableIndex) =>
      tableIndex === index ? table : item,
    );
    // A renamed set of equivalences keeps the columns that used it. This is the
    // ONLY place a stored key follows a name, and it is explicit: the operator
    // renamed this exact set and the note under the field says what follows.
    const columns =
      previousId && previousId !== table.id
        ? mapping.columns.map((column) =>
            column.target.kind === "quantitative" && column.target.recodingTableId === previousId
              ? { ...column, target: { ...column.target, recodingTableId: table.id } }
              : column,
          )
        : mapping.columns;
    onChange({ ...mapping, columns, recodingTables });
  }

  function addTable() {
    const taken = new Set(mapping.recodingTables.map((table) => table.id));
    let id = "equivalencias";
    for (let suffix = 2; taken.has(id); suffix += 1) id = `equivalencias_${suffix}`;
    onChange({
      ...mapping,
      recodingTables: [...mapping.recodingTables, { id, version: 1, values: {} }],
    });
  }

  return (
    <div className="space-y-6">
      <label className="block text-sm font-medium text-strong">
        Nombre para reutilizar esta lectura
        <input
          value={mapping.name}
          maxLength={120}
          onChange={(event) => onChange({ ...mapping, name: event.target.value })}
          className={`${control} mt-1 font-normal`}
        />
        <span className="mt-1 block text-xs font-normal text-muted">
          Con este nombre volveremos a reconocer archivos con la misma estructura.
        </span>
      </label>

      <p className="text-sm text-muted">
        {imported} de {mapping.columns.length}{" "}
        {mapping.columns.length === 1 ? "columna entrará" : "columnas entrarán"} al estudio.
      </p>

      {shared.length > 0 ? (
        <p
          role="status"
          className="rounded-lg border border-caution-line bg-caution-surface px-4 py-3 text-sm text-caution"
        >
          Dos columnas llevan al mismo dato para filtrar
          {shared.length === 1 ? "" : "s"}: {shared.map(destinationLabel).join(", ")}. Se conservará
          el valor de la última columna. Si quieres guardar ambos, dales destinos distintos.
        </p>
      ) : null}

      <ul className="space-y-3">
        {mapping.columns.map((column, index) => {
          const samples = samplesByHeader[column.sourceColumn] ?? [];
          const target = column.target;
          const key = targetKey(target);
          const options =
            target.kind === "ignore"
              ? []
              : destinationOptions(mapping, target.kind, knownFor(known, target.kind), key);
          const naming = namingColumn === index;

          return (
            <li
              key={column.sourceColumn}
              className="rounded-xl border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="font-display text-base font-semibold text-strong">
                  {column.sourceColumn}
                </p>
                <p className="text-xs text-muted">Columna del archivo</p>
              </div>
              <p className="mt-1 text-sm text-muted">
                {samples.length > 0 ? (
                  <>
                    <span className="text-strong">Ejemplos: </span>
                    {samples.join(" · ")}
                  </>
                ) : (
                  "Esta columna viene vacía en las primeras filas."
                )}
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-strong">
                  ¿Qué es este dato?
                  <select
                    value={target.kind}
                    onChange={(event) =>
                      updateTarget(
                        index,
                        targetForKind(event.target.value as DestinationKind, column.sourceColumn),
                      )
                    }
                    className={`${smallControl} mt-1 font-normal`}
                  >
                    {DESTINATION_CHOICES.map((choice) => (
                      <option key={choice.kind} value={choice.kind}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-muted">
                    {DESTINATION_CHOICES.find((choice) => choice.kind === target.kind)?.hint}
                  </span>
                </label>

                {target.kind !== "ignore" ? (
                  <div>
                    <label className="block text-sm font-medium text-strong">
                      ¿Dónde se guarda?
                      <select
                        value={naming ? NEW : key ?? ""}
                        onChange={(event) => {
                          setNewName("");
                          setNewNameError(null);
                          if (event.target.value === NEW) {
                            setNamingColumn(index);
                            return;
                          }
                          setNamingColumn(null);
                          updateTarget(index, withTargetKey(target, event.target.value));
                        }}
                        className={`${smallControl} mt-1 font-normal`}
                      >
                        {options.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                            {option.known ? " · ya usado antes" : ""}
                          </option>
                        ))}
                        <option value={NEW}>Crear uno nuevo…</option>
                      </select>
                    </label>

                    {naming ? (
                      <div className="mt-2 rounded-lg border border-evidence-line bg-evidence-surface p-3">
                        <label className="block text-sm font-medium text-strong">
                          Nombre del nuevo destino
                          <input
                            value={newName}
                            maxLength={64}
                            autoFocus
                            onChange={(event) => {
                              setNewName(event.target.value);
                              setNewNameError(null);
                            }}
                            className={`${smallControl} mt-1 font-normal`}
                          />
                        </label>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={quietButton}
                            onClick={() => {
                              const taken = options.map((option) => option.key);
                              const reason = nameRejectionReason(newName, taken);
                              if (reason) {
                                setNewNameError(reason);
                                return;
                              }
                              const created = keyFromLabel(newName);
                              if (!created) return;
                              updateTarget(index, withTargetKey(target, created));
                              setNamingColumn(null);
                              setNewName("");
                            }}
                          >
                            Usar este nombre
                          </button>
                          <button
                            type="button"
                            className={quietButton}
                            onClick={() => {
                              setNamingColumn(null);
                              setNewName("");
                              setNewNameError(null);
                            }}
                          >
                            Cancelar
                          </button>
                        </div>
                        {newNameError ? (
                          <p role="alert" className="mt-2 text-sm text-danger">
                            {newNameError}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {target.kind === "qualitative" ? (
                <label className="mt-3 block text-sm font-medium text-strong sm:max-w-xs">
                  ¿De dónde salió este comentario?
                  <select
                    value={target.source ?? "encuesta"}
                    onChange={(event) =>
                      updateTarget(index, {
                        ...target,
                        source: event.target.value as QualitativeSource,
                      })
                    }
                    className={`${smallControl} mt-1 font-normal`}
                  >
                    {QUALITATIVE_SOURCE_CHOICES.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {target.kind !== "ignore" ? (
                <details className="mt-3 rounded-lg border border-line bg-surface-sunken px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-strong">
                    Reglas de esta columna
                  </summary>
                  <div className="space-y-3 pb-2">
                    <label className="flex min-h-11 items-center gap-2.5 text-sm text-body">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={target.required ?? false}
                        onChange={(event) =>
                          updateTarget(index, { ...target, required: event.target.checked })
                        }
                      />
                      No puede quedar vacía en ninguna fila
                    </label>

                    {target.kind === "quantitative" ? (
                      <>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="block text-sm text-body">
                            Calificación más baja aceptada
                            <input
                              type="number"
                              value={target.min ?? ""}
                              onChange={(event) =>
                                updateTarget(index, {
                                  ...target,
                                  min: event.target.value === "" ? undefined : Number(event.target.value),
                                })
                              }
                              className={`${smallControl} mt-1`}
                            />
                          </label>
                          <label className="block text-sm text-body">
                            Calificación más alta aceptada
                            <input
                              type="number"
                              value={target.max ?? ""}
                              onChange={(event) =>
                                updateTarget(index, {
                                  ...target,
                                  max: event.target.value === "" ? undefined : Number(event.target.value),
                                })
                              }
                              className={`${smallControl} mt-1`}
                            />
                          </label>
                        </div>
                        <label className="block text-sm text-body">
                          Si la columna trae palabras en vez de números
                          <select
                            value={target.recodingTableId ?? ""}
                            onChange={(event) =>
                              updateTarget(index, {
                                ...target,
                                recodingTableId: event.target.value || undefined,
                              })
                            }
                            className={`${smallControl} mt-1`}
                          >
                            <option value="">Ya viene en números</option>
                            {mapping.recodingTables.map((table) => (
                              <option key={table.id} value={table.id}>
                                {recodingTableLabel(table.id)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-strong">
              Equivalencias de respuesta
            </h3>
            <p className="mt-1 text-sm text-muted">
              Sirven cuando el archivo trae frases como “Muy satisfecho” y hay que guardarlas como
              una calificación.
            </p>
          </div>
          <button type="button" className={quietButton} onClick={addTable}>
            Añadir equivalencias
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {mapping.recodingTables.map((table, tableIndex) => (
            <div key={`${table.id}-${tableIndex}`} className="rounded-lg border border-line bg-surface-sunken p-3">
              <label className="block text-sm font-medium text-strong">
                Nombre de este grupo de equivalencias
                <input
                  value={tableNames[tableIndex] ?? recodingTableLabel(table.id)}
                  maxLength={64}
                  onChange={(event) =>
                    setTableNames((previous) => ({ ...previous, [tableIndex]: event.target.value }))
                  }
                  onBlur={(event) => {
                    const taken = mapping.recodingTables
                      .filter((_, index) => index !== tableIndex)
                      .map((item) => item.id);
                    const reason = nameRejectionReason(event.target.value, taken);
                    if (reason) {
                      setTableNameError((previous) => ({ ...previous, [tableIndex]: reason }));
                      return;
                    }
                    const id = keyFromLabel(event.target.value);
                    setTableNameError((previous) => {
                      const next = { ...previous };
                      delete next[tableIndex];
                      return next;
                    });
                    setTableNames((previous) => {
                      const next = { ...previous };
                      delete next[tableIndex];
                      return next;
                    });
                    if (id && id !== table.id) updateTable(tableIndex, { ...table, id });
                  }}
                  className={`${smallControl} mt-1 font-normal sm:max-w-sm`}
                />
                <span className="mt-1 block text-xs font-normal text-muted">
                  Al cambiar el nombre, las columnas que usan estas equivalencias lo siguen usando.
                </span>
              </label>
              {tableNameError[tableIndex] ? (
                <p role="alert" className="mt-1 text-sm text-danger">
                  {tableNameError[tableIndex]}
                </p>
              ) : null}

              <div className="mt-3 space-y-2">
                {Object.entries(table.values).map(([label, value], valueIndex) => (
                  <div key={`${label}-${valueIndex}`} className="flex flex-wrap items-end gap-2">
                    <label className="min-w-0 flex-1 text-xs font-medium text-muted">
                      Cuando la respuesta dice
                      <input
                        value={label}
                        onChange={(event) => {
                          const entries = Object.entries(table.values);
                          entries[valueIndex] = [event.target.value, value];
                          updateTable(tableIndex, { ...table, values: Object.fromEntries(entries) });
                        }}
                        className={`${smallControl} mt-1 font-normal`}
                      />
                    </label>
                    <label className="w-28 text-xs font-medium text-muted">
                      Se guarda como
                      <input
                        type="number"
                        value={value}
                        onChange={(event) =>
                          updateTable(tableIndex, {
                            ...table,
                            values: { ...table.values, [label]: Number(event.target.value) },
                          })
                        }
                        className={`${smallControl} mt-1 font-normal`}
                      />
                    </label>
                    <button
                      type="button"
                      className="min-h-11 rounded-lg px-3 text-sm font-semibold text-danger underline-offset-4 hover:underline"
                      onClick={() => {
                        const values = { ...table.values };
                        delete values[label];
                        updateTable(tableIndex, { ...table, values });
                      }}
                    >
                      Quitar
                    </button>
                  </div>
                ))}
                {Object.keys(table.values).length === 0 ? (
                  <p className="text-sm text-muted">
                    Todavía no hay equivalencias en este grupo. Añade la primera para poder usarlo.
                  </p>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={quietButton}
                  onClick={() =>
                    updateTable(tableIndex, {
                      ...table,
                      values: {
                        ...table.values,
                        [`Respuesta ${Object.keys(table.values).length + 1}`]: 0,
                      },
                    })
                  }
                >
                  Añadir equivalencia
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-lg px-3 text-sm font-semibold text-danger underline-offset-4 hover:underline"
                  onClick={() =>
                    onChange({
                      ...mapping,
                      columns: mapping.columns.map((column) =>
                        column.target.kind === "quantitative" &&
                        column.target.recodingTableId === table.id
                          ? { ...column, target: { ...column.target, recodingTableId: undefined } }
                          : column,
                      ),
                      recodingTables: mapping.recodingTables.filter(
                        (_, index) => index !== tableIndex,
                      ),
                    })
                  }
                >
                  Quitar este grupo
                </button>
              </div>
            </div>
          ))}
          {mapping.recodingTables.length === 0 ? (
            <p className="text-sm text-muted">
              No hacen falta si el archivo ya trae calificaciones en números.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
