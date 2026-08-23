// =============================================================================
// P7 adversarial harness — fixture lifecycle (docs/P7_HARNESS_DESIGN.md §6).
// =============================================================================
// The ONLY module allowed to hold a service_role client, and only for the three
// narrow uses `docs/P7_PLAN.md` §3 permits: metadata preflight, residue counts,
// and exact-id cleanup. Nothing here ever produces authorization or isolation
// evidence, and nothing here ever creates an object a suite then treats as
// evidence that the application created it (§6.5).
//
// Two rules do the heavy lifting:
//   - the run prefix is an OWNERSHIP/COLLISION namespace, never a deletion key;
//   - cleanup deletes ONLY the exact ids in the ledger, child kinds first (§6.7).
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

/** Objects that are out of bounds for every mutating operation (§6.2). */
export const P6E_STUDY_ID = "ad275928-dbd1-4acf-9de9-fa1623b32a60";
export const P6E_IMPORT_BATCH_ID = "bd4f26db-093a-4e31-8fa9-de8281300c63";

/** Deletion order: every child kind is removed before the throwaway tenant. */
const CLEANUP_ORDER = ["study_template", "import_batch", "study", "tenant"];

/** Tables the residue assertion counts, keyed by ledger kind. */
const RESIDUE_TABLE = {
  tenant: { table: "tenant", column: "name" },
  study: { table: "study", column: "name" },
  study_template: { table: "study_template", column: "name" },
};

function base36(bytes) {
  return [...randomBytes(bytes)].map((b) => (b % 36).toString(36)).join("");
}

/** `P7H-<UTC>-<6 random base36>` — identifies the run, never selects a delete. */
export function newRunPrefix() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `P7H-${stamp}-${base36(6)}`;
}

export function createFixtures({ url, serviceRoleKey, prefix, protectedTenantIds }) {
  if (!url || !serviceRoleKey) {
    throw new Error("fixtures require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const ledger = [];
  const denied = new Set([P6E_STUDY_ID, P6E_IMPORT_BATCH_ID, ...protectedTenantIds.filter(Boolean)]);

  /**
   * Precondition for every mutating operation (§6.2). Aborts BEFORE a request is
   * sent — this is a guard, not a post-hoc check.
   */
  function assertMutable(targetId, what = "target") {
    if (targetId && denied.has(targetId)) {
      throw new Error(`deny-list: refusing to mutate protected ${what} (id withheld)`);
    }
    const tenant = ledger.find((entry) => entry.kind === "tenant");
    if (what === "tenant-scope" && tenant && targetId && targetId !== tenant.id) {
      throw new Error("fixture scope: refusing to place a fixture outside the run's throwaway tenant");
    }
  }

  /** Counts objects carrying the run prefix. Metadata only — never rows (§6.3). */
  async function countPrefixed() {
    const counts = {};
    for (const [kind, spec] of Object.entries(RESIDUE_TABLE)) {
      const { count, error } = await admin
        .from(spec.table)
        .select("id", { count: "exact", head: true })
        .like(spec.column, `${prefix}%`);
      if (error) throw new Error(`preflight ${spec.table}: ${error.message}`);
      counts[kind] = count ?? 0;
    }
    return counts;
  }

  /** Refuses to start when a previous run leaked into this prefix namespace. */
  async function preflight() {
    const counts = await countPrefixed();
    const collisions = Object.entries(counts).filter(([, n]) => n > 0);
    if (collisions.length) {
      throw new Error(
        `preflight collision for prefix ${prefix}: ` +
          collisions.map(([kind, n]) => `${kind}=${n}`).join(", ") +
          " — a previous run leaked; remove those objects manually before re-running",
      );
    }
    return counts;
  }

  function track(record) {
    if (!record?.kind || !record?.id) throw new Error("ledger: kind and id are required");
    if (denied.has(record.id)) throw new Error("ledger: refusing to track a protected object");
    ledger.push({ ...record, prefix, createdAt: new Date().toISOString() });
  }

  /**
   * Read-only metadata for the S6 report-route control (§9.1.1). Returns the
   * fields needed to decide the precondition — never respondent or metric rows.
   */
  async function reportControlMetadata(studyId) {
    const { data, error } = await admin
      .from("study")
      .select("id, tenant_id, status, dashboard_config")
      .eq("id", studyId)
      .maybeSingle();
    if (error) throw new Error(`report control metadata: ${error.message}`);
    if (!data) return null;
    const sections = data.dashboard_config?.sections ?? {};
    return {
      tenantId: data.tenant_id,
      status: data.status,
      reportEnabled: sections.report !== false,
    };
  }

  /** Counts rows the run could have created, for the residue field (§6.4). */
  async function residue(kinds) {
    const counts = {};
    for (const kind of kinds) {
      const spec = RESIDUE_TABLE[kind];
      if (!spec) continue;
      const { count, error } = await admin
        .from(spec.table)
        .select("id", { count: "exact", head: true })
        .like(spec.column, `${prefix}%`);
      if (error) throw new Error(`residue ${spec.table}: ${error.message}`);
      counts[kind] = count ?? 0;
    }
    return counts;
  }

  /**
   * Deletes exactly the ledger's ids, child kinds before the tenant, one
   * `id = <ledger id>` predicate at a time. Never deletes by prefix or name.
   */
  async function cleanup() {
    const leaked = [];
    let removed = 0;
    const ordered = [...ledger].sort(
      (a, b) => CLEANUP_ORDER.indexOf(a.kind) - CLEANUP_ORDER.indexOf(b.kind),
    );
    for (const entry of ordered) {
      const spec = RESIDUE_TABLE[entry.kind];
      if (!spec) {
        leaked.push(entry);
        continue;
      }
      const { error } = await admin.from(spec.table).delete().eq("id", entry.id);
      if (error) leaked.push(entry);
      else removed += 1;
    }
    let residual = {};
    try {
      residual = await countPrefixed();
    } catch {
      residual = { unknown: -1 };
    }
    const stillThere = Object.entries(residual).filter(([, n]) => n !== 0);
    return { removed, leaked, residual, clean: leaked.length === 0 && stillThere.length === 0 };
  }

  return {
    prefix,
    ledger,
    assertMutable,
    preflight,
    track,
    residue,
    reportControlMetadata,
    cleanup,
    isDenied: (id) => denied.has(id),
  };
}
