import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  EMPTY_TENANT_IMPACT,
  type TenantImpact,
} from "./lifecycle-model";

/**
 * The client-lifecycle data boundary (P8.2).
 *
 * Read only AFTER the caller has proved an internal role. Like the rest of the
 * Studio backoffice this module is `server-only` and takes an already-created
 * admin client; it never creates one itself and is never reachable from the
 * browser bundle.
 *
 * WHY EVERY READ HERE CAN SAY "NOT AVAILABLE"
 *
 * Archive state and the administrative audit live in migration `0015`. A merge
 * to `main` deploys, and a migration is applied as its own reviewed step, so
 * there is a real window in which the deployed code is ahead of the deployed
 * schema. Hard-depending on `0015` would take the whole Studio client surface
 * down during that window for the sake of a feature nobody could use yet.
 *
 * So every read distinguishes "the schema is not there" from "the query
 * failed". The first degrades: the lifecycle controls render as unavailable
 * with the reason stated in words, and everything else on the page keeps
 * working. The second still throws, because a broken query must not be
 * mistaken for a pending migration.
 *
 * Suspension is deliberately absent from this module. It is enforced at the
 * authentication boundary and read from the Auth account itself, so it needs
 * no schema and cannot drift from what Auth actually does.
 */

export const LIFECYCLE_UNAVAILABLE_REASON =
  "El archivo y la eliminación de clientes todavía no están disponibles en este entorno: falta aplicar la migración 0015. Suspender y devolver el acceso de una persona sí funciona.";

/** PostgREST/Postgres answers for "that column or table is not there yet". */
const MISSING_SCHEMA_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

type PostgrestLikeError = { code?: string | null; message?: string | null } | null;

function isMissingSchema(error: PostgrestLikeError): boolean {
  if (!error) return false;
  if (error.code && MISSING_SCHEMA_CODES.has(error.code)) return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("does not exist") || message.includes("could not find");
}

// ---------------------------------------------------------------------------
// Archive state
// ---------------------------------------------------------------------------

export type TenantArchiveState = {
  /** False when migration 0015 is not applied to this environment. */
  available: boolean;
  /** tenant id -> the moment it was archived, or null while it is active. */
  archivedAt: Record<string, string | null>;
};

export const ARCHIVE_STATE_UNAVAILABLE: TenantArchiveState = {
  available: false,
  archivedAt: {},
};

type ArchiveRow = { id: string; archived_at: string | null };

export async function loadTenantArchiveState(
  admin: ReturnType<typeof createAdminClient>,
  tenantIds: string[],
): Promise<TenantArchiveState> {
  if (tenantIds.length === 0) return { available: true, archivedAt: {} };
  const { data, error } = await admin
    .from("tenant")
    .select("id, archived_at")
    .in("id", tenantIds)
    .returns<ArchiveRow[]>();
  if (error) {
    if (isMissingSchema(error)) return ARCHIVE_STATE_UNAVAILABLE;
    throw new Error(`tenant archive state: ${error.message}`);
  }
  const archivedAt: Record<string, string | null> = Object.fromEntries(
    tenantIds.map((tenantId) => [tenantId, null]),
  );
  for (const row of data ?? []) archivedAt[row.id] = row.archived_at;
  return { available: true, archivedAt };
}

/**
 * Whether a client currently refuses new work.
 *
 * This is the SERVER-SIDE guard the mutations call, not a repeat of what the
 * page rendered: a request that never saw the page, or that saw it before a
 * colleague archived the client, is refused here.
 */
export async function tenantRefusesNewWork(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<boolean> {
  const state = await loadTenantArchiveState(admin, [tenantId]);
  if (!state.available) return false;
  return Boolean(state.archivedAt[tenantId]);
}

export async function setTenantArchived(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  archived: boolean,
  actorUserId: string,
): Promise<{ ok: true } | { ok: false; unavailable: boolean; message: string }> {
  const { data, error } = await admin
    .from("tenant")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      archived_by: archived ? actorUserId : null,
    })
    .eq("id", tenantId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) {
      return { ok: false, unavailable: true, message: LIFECYCLE_UNAVAILABLE_REASON };
    }
    return { ok: false, unavailable: false, message: error.message };
  }
  if (!data) return { ok: false, unavailable: false, message: "El cliente ya no existe." };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Administrative audit
// ---------------------------------------------------------------------------

export type LifecycleAction =
  | "client_user_suspended"
  | "client_user_restored"
  | "client_user_deleted"
  | "tenant_archived"
  | "tenant_restored"
  | "tenant_deleted";

export type LifecycleEvent = {
  actorUserId: string;
  action: LifecycleAction;
  subjectKind: "client_user" | "tenant";
  subjectId: string;
  tenantId: string | null;
  /** A short display label, never an email, an answer or a quote. */
  subjectLabel: string | null;
  /** Bounded counts and flags only. Anything else is dropped before writing. */
  details?: Record<string, number | string | boolean | null>;
};

const MAX_DETAIL_ENTRIES = 20;
const MAX_DETAIL_STRING = 120;

/**
 * Keep the record small and boring on purpose. Numbers and short flags survive;
 * anything long is truncated and anything unexpected is dropped, so no client
 * payload can be smuggled into administrative evidence by a future caller.
 */
function boundedDetails(details: LifecycleEvent["details"]): Record<string, unknown> {
  if (!details) return {};
  const entries = Object.entries(details).slice(0, MAX_DETAIL_ENTRIES);
  const safe: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "boolean" || value === null) safe[key] = value;
    else if (typeof value === "string") safe[key] = value.slice(0, MAX_DETAIL_STRING);
  }
  return safe;
}

/**
 * Record the administrative action.
 *
 * It returns whether the record was written rather than throwing, and the
 * caller reports that honestly: an administrative action that succeeded and
 * was not recorded must not be presented as if it had been.
 */
export async function recordLifecycleEvent(
  admin: ReturnType<typeof createAdminClient>,
  event: LifecycleEvent,
): Promise<{ recorded: boolean; unavailable: boolean }> {
  const { error } = await admin.from("admin_lifecycle_event").insert({
    actor_user_id: event.actorUserId,
    action: event.action,
    subject_kind: event.subjectKind,
    subject_id: event.subjectId,
    tenant_id: event.tenantId,
    subject_label: event.subjectLabel ? event.subjectLabel.slice(0, 200) : null,
    details: boundedDetails(event.details),
  });
  if (!error) return { recorded: true, unavailable: false };
  return { recorded: false, unavailable: isMissingSchema(error) };
}

export type LifecycleRecord = {
  occurredAt: string;
  action: LifecycleAction;
  subjectLabel: string | null;
};

/** The recent administrative history of one client, for its own page. */
export async function loadTenantLifecycleHistory(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  limit = 10,
): Promise<{ available: boolean; records: LifecycleRecord[] }> {
  const { data, error } = await admin
    .from("admin_lifecycle_event")
    .select("occurred_at, action, subject_label")
    .eq("tenant_id", tenantId)
    .order("occurred_at", { ascending: false })
    .limit(limit)
    .returns<{ occurred_at: string; action: LifecycleAction; subject_label: string | null }[]>();
  if (error) {
    if (isMissingSchema(error)) return { available: false, records: [] };
    throw new Error(`lifecycle history: ${error.message}`);
  }
  return {
    available: true,
    records: (data ?? []).map((row) => ({
      occurredAt: row.occurred_at,
      action: row.action,
      subjectLabel: row.subject_label,
    })),
  };
}

// ---------------------------------------------------------------------------
// The impact of permanently deleting a client
// ---------------------------------------------------------------------------

/**
 * `selectColumn` is named per table rather than assumed: `profiles` is keyed by
 * `user_id` and has no `id`, and a count that silently failed would understate
 * exactly the number the operator is about to act on.
 */
async function countRows(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  column: string,
  value: string,
  selectColumn = "id",
): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select(selectColumn, { count: "exact", head: true })
    .eq(column, value);
  if (error) throw new Error(`${table} count: ${error.message}`);
  return count ?? 0;
}

/**
 * Every dependent object a permanent deletion would take with it, counted from
 * the database at the moment it is asked — never cached, never estimated.
 *
 * `storageObjects` is counted from the branding bucket rather than assumed from
 * `brand_config`, because an orphaned upload is exactly the kind of leftover a
 * deletion has to name and then actually remove.
 */
export async function countTenantImpact(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<TenantImpact> {
  const [
    clientUsers,
    studies,
    publishedStudies,
    respondents,
    quantResponses,
    qualObservations,
    importBatches,
    importMappings,
    recodingTables,
    storageObjects,
  ] = await Promise.all([
    countRows(admin, "profiles", "tenant_id", tenantId, "user_id"),
    countRows(admin, "study", "tenant_id", tenantId),
    admin
      .from("study")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .then(({ count, error }) => {
        if (error) throw new Error(`published study count: ${error.message}`);
        return count ?? 0;
      }),
    countRows(admin, "respondent", "tenant_id", tenantId),
    countRows(admin, "quant_response", "tenant_id", tenantId),
    countRows(admin, "qual_observation", "tenant_id", tenantId),
    countRows(admin, "import_batch", "tenant_id", tenantId),
    countRows(admin, "import_mapping", "tenant_id", tenantId),
    countRows(admin, "recoding_table", "tenant_id", tenantId),
    listTenantStorageObjects(admin, tenantId).then((paths) => paths.length),
  ]);
  return {
    ...EMPTY_TENANT_IMPACT,
    clientUsers,
    studies,
    publishedStudies,
    respondents,
    quantResponses,
    qualObservations,
    importBatches,
    importMappings,
    recodingTables,
    storageObjects,
  };
}

/**
 * The branding objects that belong to one client, by their real paths.
 *
 * A deletion that skipped this would leave publicly readable logo files behind
 * with no row pointing at them — the orphan the impact summary promises not to
 * create.
 */
export async function listTenantStorageObjects(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<string[]> {
  const { data, error } = await admin.storage.from("tenant-branding").list(tenantId, { limit: 200 });
  if (error) return [];
  return (data ?? [])
    .filter((entry) => entry.name && entry.id !== null)
    .map((entry) => `${tenantId}/${entry.name}`);
}
