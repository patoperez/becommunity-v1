import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  boundedDetails,
  EMPTY_TENANT_IMPACT,
  STORAGE_INVENTORY_CEILING,
  type LifecycleDetails,
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
  "El registro administrativo no está disponible en este entorno: falta aplicar la migración 0015. Mientras tanto, ninguna acción del ciclo de vida se ejecuta, porque quedaría sin evidencia.";

/**
 * Permanent client deletion is DISABLED in the product.
 *
 * Not hidden, not "coming soon", not attempted-and-reported: refused, by the
 * server, with the reason. It spans three systems that have no shared
 * transaction — Postgres rows, Supabase Auth identities and Storage objects —
 * and the only order this code could execute them in destroys the tenant row
 * first, which is exactly the order that can leave an Auth account or a stored
 * file behind with nothing left pointing at it. Counting the failures
 * afterwards is a report, not a guarantee.
 *
 * It returns when there is a recoverable, idempotent, resumable cross-system
 * deletion workflow to execute it with. Archiving — reversible, single-system —
 * is the action that stays.
 */
export const TENANT_DELETION_DISABLED_REASON =
  "La eliminación permanente de un cliente está desactivada. Borra datos en tres sistemas que no comparten una transacción, así que un fallo a la mitad dejaría cuentas o archivos sin dueño. Volverá cuando exista un proceso que se pueda reintentar sin duplicar ni perder nada. Mientras tanto, archiva el cliente: es reversible y no destruye nada.";

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

/**
 * Whether the administrative record can be written at all.
 *
 * Every lifecycle mutation is gated on this BEFORE it touches anything. The
 * product promises that suspending, restoring, archiving and deleting leave
 * evidence; without the table that promise cannot be kept, and a mutation that
 * quietly succeeds unrecorded is worse than one that refuses and says why.
 *
 * It is a read probe, so it proves the table exists and is reachable — not that
 * an insert will succeed. The irreversible path does not rely on it: that one
 * writes a real record and refuses if the write fails.
 */
export async function lifecycleAuditAvailable(
  admin: ReturnType<typeof createAdminClient>,
): Promise<boolean> {
  const { error } = await admin
    .from("admin_lifecycle_event")
    .select("id", { count: "exact", head: true })
    .limit(1);
  if (!error) return true;
  if (isMissingSchema(error)) return false;
  throw new Error(`lifecycle audit probe: ${error.message}`);
}

export type LifecycleAction =
  | "client_user_suspended"
  | "client_user_restored"
  /** Written BEFORE the irreversible delete, so intent is durable first. */
  | "client_user_delete_started"
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
  details?: LifecycleDetails;
};

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
export type TenantImpactReport = {
  impact: TenantImpact;
  /** False when the storage inventory hit its ceiling or could not be read. */
  storageInventoryComplete: boolean;
  storageIncompleteReason: string | null;
};

export async function countTenantImpact(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<TenantImpactReport> {
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
    listTenantStorageObjects(admin, tenantId),
  ]);
  const impact = {
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
    storageObjects: storageObjects.paths.length,
  };
  return {
    impact,
    storageInventoryComplete: storageObjects.complete,
    storageIncompleteReason: storageObjects.incompleteReason,
  };
}

/** One page of the branding bucket. Storage caps a single list call anyway. */
const STORAGE_PAGE = 100;

export type TenantStorageInventory = {
  paths: string[];
  /**
   * False when the ceiling was reached, or when the bucket could not be read.
   * An incomplete inventory may never be used to justify a deletion.
   */
  complete: boolean;
  /** Why it is incomplete, for the internal surface. Null when it is complete. */
  incompleteReason: string | null;
};

/**
 * The branding objects that belong to one client, by their real paths.
 *
 * It used to ask for at most 200 in a single call and return whatever came
 * back, so a client with more had its impact summary silently understated —
 * and an understated summary is exactly what a deletion must never be allowed
 * to rest on. It now pages to a stated ceiling and reports whether it finished.
 */
export async function listTenantStorageObjects(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<TenantStorageInventory> {
  const paths: string[] = [];
  const maxPages = Math.ceil(STORAGE_INVENTORY_CEILING / STORAGE_PAGE);
  for (let page = 0; page < maxPages; page += 1) {
    const { data, error } = await admin.storage
      .from("tenant-branding")
      .list(tenantId, { limit: STORAGE_PAGE, offset: page * STORAGE_PAGE });
    if (error) {
      return {
        paths,
        complete: false,
        incompleteReason: "No se pudo leer el almacenamiento del cliente.",
      };
    }
    const entries = data ?? [];
    for (const entry of entries) {
      // A folder placeholder has a null id and is not an object to delete.
      if (entry.name && entry.id !== null) paths.push(`${tenantId}/${entry.name}`);
    }
    // A short page is the end of the listing. The loop is bounded by `maxPages`
    // regardless, so a Storage backend that kept returning full pages could
    // never turn this into a load loop.
    if (entries.length < STORAGE_PAGE) {
      return { paths, complete: true, incompleteReason: null };
    }
  }
  return {
    paths,
    complete: false,
    incompleteReason: `Hay más de ${STORAGE_INVENTORY_CEILING} archivos guardados para este cliente; el inventario está incompleto.`,
  };
}
