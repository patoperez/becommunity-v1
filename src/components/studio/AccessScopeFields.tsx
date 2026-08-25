"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { DataScope } from "@/lib/studies/scope";
import {
  countMatchingUnits,
  dimensionFallbackLabel,
  isSelectionComplete,
  reconcileScope,
  scopeSummarySentence,
  serializeScope,
  type ScopeMode,
  type ScopeSelection,
  type TenantScopeInventory,
} from "@/lib/studies/scope-picker";

/**
 * The no-code access-scope picker (P8.2).
 *
 * It replaces the two raw textareas the CEO used to type an object into. What
 * it submits is byte-compatible with what those textareas submitted: one hidden
 * `data_scope` field carrying the same serialized shape, read by the same
 * Server Action, parsed by the same fail-closed `parseDataScope` and enforced
 * by the same `applyDataScope`. This component is convenience, never a control:
 * a request that skips it entirely is validated exactly as before.
 *
 * It owns the client `<select>` on purpose. Access is only meaningful relative
 * to one client's data, so choosing a different client has to reconcile the
 * selection in the same interaction — never carry one client's restriction
 * silently into another.
 */

const field =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";

export type TenantChoice = { id: string; name: string };

export function AccessScopeFields({
  idPrefix,
  tenants,
  inventories,
  initialTenantId = "",
  initialScope = {},
  tenantPlaceholder,
  submitLabel,
  submitClassName,
  children,
}: {
  /** Unique per form on the page: two pickers coexist on `/admin/clients`. */
  idPrefix: string;
  tenants: TenantChoice[];
  inventories: Record<string, TenantScopeInventory>;
  initialTenantId?: string;
  initialScope?: DataScope;
  /** Shown as the empty option when no client has been chosen yet. */
  tenantPlaceholder?: string;
  submitLabel: string;
  submitClassName: string;
  /** Identity fields that belong between the client and the access choice. */
  children?: ReactNode;
}) {
  const initial = useMemo(
    () => reconcileScope(initialScope, inventories[initialTenantId] ?? null),
    [initialScope, inventories, initialTenantId],
  );

  const [tenantId, setTenantId] = useState(initialTenantId);
  const [mode, setMode] = useState<ScopeMode>(initial.selection.mode);
  const [values, setValues] = useState<Record<string, string[]>>(initial.selection.values);
  const [reconciled, setReconciled] = useState(false);

  const inventory = inventories[tenantId] ?? null;
  const clientName = tenants.find((tenant) => tenant.id === tenantId)?.name ?? "este cliente";
  const selection: ScopeSelection = { mode, values };
  const serialized = serializeScope(selection);
  const summary = scopeSummarySentence(selection, inventory, clientName);
  const matching = countMatchingUnits(selection, inventory);
  const complete = isSelectionComplete(selection);
  const offersDimensions = (inventory?.dimensions.length ?? 0) > 0;

  const { unavailable } = reconcileScope(values as DataScope, inventory);
  const unavailableByDimension = new Map<string, string[]>();
  for (const entry of unavailable) {
    unavailableByDimension.set(entry.dimension, [
      ...(unavailableByDimension.get(entry.dimension) ?? []),
      entry.value,
    ]);
  }
  const offeredKeys = new Set((inventory?.dimensions ?? []).map((dimension) => dimension.key));
  const historicalDimensions = [...unavailableByDimension.entries()].filter(
    ([key]) => !offeredKeys.has(key),
  );

  function changeTenant(nextTenantId: string) {
    setTenantId(nextTenantId);
    // A restriction written for one client's characteristics has no meaning for
    // another's. Returning to the person's own client restores exactly what was
    // stored; any other client starts from full access, and says so.
    if (nextTenantId === initialTenantId) {
      setMode(initial.selection.mode);
      setValues(initial.selection.values);
      setReconciled(false);
      return;
    }
    const changed = mode === "part" && Object.keys(values).length > 0;
    setMode("all");
    setValues({});
    setReconciled(changed);
  }

  function toggleValue(dimension: string, value: string, checked: boolean) {
    setReconciled(false);
    setValues((previous) => {
      const current = previous[dimension] ?? [];
      const next = checked
        ? [...new Set([...current, value])]
        : current.filter((item) => item !== value);
      const updated = { ...previous };
      if (next.length > 0) updated[dimension] = next;
      else delete updated[dimension];
      return updated;
    });
  }

  const checkbox = (
    key: string,
    option: { value: string; label: string; units?: number },
    historical: boolean,
  ) => {
    const checked = (values[key] ?? []).includes(option.value);
    return (
      <label
        key={`${key}:${option.value}`}
        className="flex min-h-11 items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-body has-[:checked]:border-evidence-line has-[:checked]:bg-evidence-surface"
      >
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0"
          checked={checked}
          onChange={(event) => toggleValue(key, option.value, event.target.checked)}
        />
        <span className="min-w-0">
          <span className="block truncate">{option.label}</span>
          {historical ? (
            <span className="block text-xs text-caution">
              Ya no aparece en los datos actuales
            </span>
          ) : option.units !== undefined ? (
            <span className="block text-xs text-muted">
              {option.units} {option.units === 1 ? "persona" : "personas"}
            </span>
          ) : null}
        </span>
      </label>
    );
  };

  return (
    <>
      <label className="block text-sm font-medium text-strong" htmlFor={`${idPrefix}-tenant`}>
        Cliente
        <select
          id={`${idPrefix}-tenant`}
          className={`${field} mt-1 font-normal`}
          name="tenant_id"
          required
          value={tenantId}
          onChange={(event) => changeTenant(event.target.value)}
        >
          {tenantPlaceholder ? <option value="">{tenantPlaceholder}</option> : null}
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
      </label>

      {children}

      <fieldset className="mt-4 border-t border-line pt-4">
        <legend className="text-sm font-semibold text-strong">¿Qué podrá ver esta persona?</legend>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(
            [
              ["all", "Todo el cliente", "Ve los resultados completos de la organización."],
              ["part", "Solo una parte", "Ve únicamente las respuestas que elijas."],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className="flex min-h-11 items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm has-[:checked]:border-evidence-line has-[:checked]:bg-evidence-surface"
            >
              <input
                type="radio"
                name={`${idPrefix}-scope-mode`}
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={mode === value}
                disabled={value === "part" && !offersDimensions}
                onChange={() => {
                  setMode(value);
                  setReconciled(false);
                }}
              />
              <span>
                <span className="block font-medium text-strong">{label}</span>
                <span className="block text-xs text-muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>

        {!tenantId ? (
          <p className="mt-3 text-sm text-muted">
            Elige primero un cliente para ver qué partes se pueden separar.
          </p>
        ) : !offersDimensions ? (
          <p className="mt-3 rounded-lg border border-line bg-surface-sunken px-3 py-2.5 text-sm text-muted">
            Las respuestas de {clientName} todavía no distinguen áreas, niveles ni campus, así que
            no hay partes que separar. Esta persona verá todo el cliente.
          </p>
        ) : mode === "part" ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted">
              Elige uno o más valores de cada característica. Dentro de una característica basta con
              que la respuesta coincida con cualquiera de los valores marcados; entre características
              distintas se deben cumplir todas a la vez.
            </p>

            {inventory?.dimensions.map((dimension) => {
              const historical = (unavailableByDimension.get(dimension.key) ?? []).filter(
                (value) => !dimension.values.some((option) => option.value === value),
              );
              return (
                <fieldset key={dimension.key} className="rounded-xl border border-line bg-surface-sunken p-3">
                  <legend className="px-1 text-sm font-semibold text-strong">{dimension.label}</legend>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    {dimension.values.map((option) => checkbox(dimension.key, option, false))}
                    {historical.map((value) =>
                      checkbox(dimension.key, { value, label: value }, true),
                    )}
                  </div>
                  {dimension.truncated ? (
                    <p className="mt-2 text-xs text-muted">
                      Se muestran los valores más frecuentes de esta característica.
                    </p>
                  ) : null}
                </fieldset>
              );
            })}

            {historicalDimensions.map(([key, entries]) => (
              <fieldset key={key} className="rounded-xl border border-caution-line bg-caution-surface p-3">
                <legend className="px-1 text-sm font-semibold text-caution">
                  {dimensionFallbackLabel(key)} · característica anterior
                </legend>
                <p className="mt-1 text-xs text-caution">
                  Se guardó antes y ya no aparece en los datos actuales. Se conserva tal cual hasta
                  que alguien la cambie aquí.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {entries.map((value) => checkbox(key, { value, label: value }, true))}
                </div>
              </fieldset>
            ))}
          </div>
        ) : null}

        <div className="mt-4 rounded-lg border border-evidence-line bg-evidence-surface px-3 py-3">
          <p className="text-sm font-medium text-strong">{summary}</p>
          {matching !== null && inventory ? (
            <p className="mt-1 text-xs text-muted">
              Hoy son {matching} de {inventory.totalUnits}{" "}
              {inventory.totalUnits === 1 ? "persona" : "personas"} con respuestas registradas. Es
              la foto de hoy: cambia cuando se cargan datos nuevos.
            </p>
          ) : mode === "part" && complete ? (
            <p className="mt-1 text-xs text-muted">
              Por ahora no se puede estimar a cuántas personas alcanza.
            </p>
          ) : null}
        </div>

        {reconciled ? (
          <p role="status" className="mt-3 rounded-lg border border-caution-line bg-caution-surface px-3 py-2 text-sm text-caution">
            Cambiaste de cliente, así que el acceso volvió a “Todo el cliente”. Vuelve a elegir la
            parte si hace falta.
          </p>
        ) : null}

        {!complete ? (
          <p role="alert" className="mt-3 rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-sm text-danger">
            Marca al menos un valor, o elige “Todo el cliente”.
          </p>
        ) : null}
      </fieldset>

      {/* The Server Action contract, unchanged. Never shown to anyone. */}
      <input type="hidden" name="data_scope" value={serialized} />

      <button className={submitClassName} disabled={!complete}>
        {submitLabel}
      </button>
    </>
  );
}
