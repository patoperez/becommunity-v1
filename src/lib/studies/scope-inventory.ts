import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { selectAllPages } from "@/lib/supabase/paginate";
import {
  dimensionFallbackLabel,
  EMPTY_INVENTORY,
  type ScopeDimensionOption,
  type TenantScopeInventory,
} from "./scope-picker";

/**
 * What each client's data currently offers the access-scope picker.
 *
 * Read AFTER the caller has proved an internal role — this module is
 * `server-only` and takes an already-created admin client, exactly like the
 * rest of the Studio backoffice. It returns AGGREGATES: characteristic names,
 * their distinct values, and how many people carry each combination. No
 * respondent id, no answer, no quote and no free text ever leaves here, so the
 * browser receives a picker's worth of vocabulary and nothing else.
 *
 * The caps below are defensive, not expected: study volumes are in the
 * thousands of rows. When a client exceeds them the picker degrades honestly —
 * it stops offering a count rather than offering a wrong one.
 */

const MAX_RESPONDENTS = 20_000;
const MAX_DIMENSIONS = 15;
const MAX_VALUES_PER_DIMENSION = 60;
const MAX_COMBINATIONS = 500;

/**
 * A characteristic name has to survive `parseDataScope`, which accepts letters,
 * numbers, `_` and `-` only. A key the stored schema would reject is never
 * offered as a choice, because choosing it could not be saved.
 */
const STORABLE_DIMENSION = /^[\p{L}\p{N}_-]{1,80}$/u;
const MAX_VALUE_LENGTH = 200;

type RespondentSegments = { tenant_id: string; segments: unknown };

export async function loadTenantScopeInventories(
  admin: ReturnType<typeof createAdminClient>,
  tenantIds: string[],
): Promise<Record<string, TenantScopeInventory>> {
  const inventories: Record<string, TenantScopeInventory> = Object.fromEntries(
    tenantIds.map((tenantId) => [tenantId, EMPTY_INVENTORY(tenantId)]),
  );
  if (tenantIds.length === 0) return inventories;

  const data = await selectAllPages<RespondentSegments>(
    "respondent segments",
    (from, to) => admin
      .from("respondent")
      .select("tenant_id, segments")
      .in("tenant_id", tenantIds)
      .range(from, to)
      .returns<RespondentSegments[]>(),
    MAX_RESPONDENTS,
  );

  const perTenant = new Map<string, Map<string, number>>();
  const valueCounts = new Map<string, Map<string, Map<string, number>>>();
  const totals = new Map<string, number>();

  for (const row of data ?? []) {
    const tenantId = String(row.tenant_id);
    if (!(tenantId in inventories)) continue;
    totals.set(tenantId, (totals.get(tenantId) ?? 0) + 1);

    const segments = readSegments(row.segments);
    const combinationKey = JSON.stringify(segments);
    const combinations = perTenant.get(tenantId) ?? new Map<string, number>();
    combinations.set(combinationKey, (combinations.get(combinationKey) ?? 0) + 1);
    perTenant.set(tenantId, combinations);

    const dimensions = valueCounts.get(tenantId) ?? new Map<string, Map<string, number>>();
    for (const [key, value] of Object.entries(segments)) {
      const values = dimensions.get(key) ?? new Map<string, number>();
      values.set(value, (values.get(value) ?? 0) + 1);
      dimensions.set(key, values);
    }
    valueCounts.set(tenantId, dimensions);
  }

  for (const tenantId of tenantIds) {
    const dimensionEntries = [...(valueCounts.get(tenantId) ?? new Map())].sort(
      ([a], [b]) => a.localeCompare(b, "es-MX"),
    );
    const dimensions: ScopeDimensionOption[] = dimensionEntries
      .slice(0, MAX_DIMENSIONS)
      .map(([key, values]) => {
        const sorted = [...values.entries()].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es-MX"),
        );
        return {
          key,
          label: dimensionFallbackLabel(key),
          values: sorted.slice(0, MAX_VALUES_PER_DIMENSION).map(([value, units]) => ({
            value,
            label: value,
            units,
          })),
          truncated: sorted.length > MAX_VALUES_PER_DIMENSION,
        };
      });

    const rawCombinations = [...(perTenant.get(tenantId) ?? new Map())];
    const countable = rawCombinations.length <= MAX_COMBINATIONS;
    inventories[tenantId] = {
      tenantId,
      dimensions,
      combinations: countable
        ? rawCombinations.map(([serialized, units]) => ({
            values: JSON.parse(serialized) as Record<string, string>,
            units,
          }))
        : [],
      totalUnits: totals.get(tenantId) ?? 0,
      countable,
    };
  }
  return inventories;
}

/**
 * Keep only the characteristics the stored scope schema could actually hold,
 * with the keys SORTED: two people with the same characteristics written in a
 * different order are the same combination, and an unsorted serialization would
 * split them into two and understate every count built from it.
 */
function readSegments(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!STORABLE_DIMENSION.test(key)) continue;
    if (value == null) continue;
    const text = String(value).trim();
    if (text === "" || text.length > MAX_VALUE_LENGTH) continue;
    pairs.push([key, text]);
  }
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(pairs);
}
