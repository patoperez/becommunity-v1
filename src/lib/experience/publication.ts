import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { EXPERIENCE_SCHEMA_VERSION, type ExperienceDefinitionV1 } from "./definition";
import { migrateExperienceDefinition } from "./migrate";
import { serializedBytes } from "./serialize";
import { EXPERIENCE_LIMITS } from "./limits";

/**
 * Reading and writing the publication side of a composed experience
 * (migration 0025).
 *
 * WHERE THE AUTHORIZATION IS. Not here — the same contract `storage.ts` states
 * for the draft. Every caller runs `requireInternal()` first and hands this
 * module the admin client that check produced. The database repeats it anyway:
 * RLS denies `anon` and `authenticated` outright on all four tables,
 * `service_role` holds SELECT and nothing else, and every write goes through a
 * `security definer` function that re-reads the actor's role from
 * `public.profiles` and derives the tenant from the study row.
 *
 * WHAT THE THREE WRITE FUNCTIONS GUARANTEE, so that this file does not have to
 * re-implement any of it and cannot get it subtly different:
 *
 *   prepare   the snapshot IS the stored draft at the named revision, compared
 *             as `jsonb` inside the transaction under `for update`;
 *   publish   the prepared revision still matches the draft, the acknowledged
 *             warnings are exactly the ones the revision recorded, the active
 *             pointer is the one the caller believed, and the event and the
 *             pointer move together or not at all;
 *   restore   the same, minus the staleness rule, plus a required reason.
 *
 * All three are idempotent per `(study, idempotency key)` through a unique
 * index, so a retried request returns the event the first attempt wrote rather
 * than writing a second one.
 *
 * WHAT NEVER CROSSES INTO A CLIENT PAYLOAD. `preparedNote`, `acknowledged*`,
 * `preparedBy` and every event are INTERNAL. `activeExperience()` is the one
 * reader a client-facing route uses and it returns the definition and the
 * revision number only — see the comment on its return type.
 */

// ---------------------------------------------------------------------------
// What a revision is, read back
// ---------------------------------------------------------------------------

export type StoredRevision = {
  id: string;
  revision: number;
  schemaVersion: number;
  definition: ExperienceDefinitionV1;
  definitionSha256: string;
  sourceDraftRevision: number;
  studyFingerprint: string;
  preparedBy: string | null;
  preparedAt: string;
  preparedNote: string | null;
  acknowledgedWarnings: string[];
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
};

/** A revision whose stored document this version of the product cannot read. */
export type UnreadableRevision = {
  id: string;
  revision: number;
  schemaVersion: number;
  definitionSha256: string;
  preparedAt: string;
  reason: string;
};

type RevisionRow = {
  id: string;
  revision: number;
  schema_version: number;
  definition: unknown;
  definition_sha256: string;
  source_draft_revision: number;
  study_fingerprint: string;
  prepared_by: string | null;
  prepared_at: string;
  prepared_note: string | null;
  acknowledged_warnings: string[] | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
};

const REVISION_COLUMNS =
  "id, revision, schema_version, definition, definition_sha256, source_draft_revision, "
  + "study_fingerprint, prepared_by, prepared_at, prepared_note, acknowledged_warnings, "
  + "acknowledged_by, acknowledged_at";

function readRevision(row: RevisionRow): StoredRevision | UnreadableRevision {
  const migrated = migrateExperienceDefinition(row.definition);
  if (!migrated.ok) {
    return {
      id: row.id,
      revision: Number(row.revision),
      schemaVersion: Number(row.schema_version),
      definitionSha256: row.definition_sha256,
      preparedAt: row.prepared_at,
      reason:
        migrated.reason === "unknown_version"
          ? `Esta revisión se guardó con una versión que este producto no entiende (${migrated.detail}).`
          : `La revisión guardada ya no es válida: ${migrated.detail}`,
    };
  }
  return {
    id: row.id,
    revision: Number(row.revision),
    schemaVersion: Number(row.schema_version),
    definition: migrated.definition,
    definitionSha256: row.definition_sha256,
    sourceDraftRevision: Number(row.source_draft_revision),
    studyFingerprint: row.study_fingerprint,
    preparedBy: row.prepared_by,
    preparedAt: row.prepared_at,
    preparedNote: row.prepared_note,
    acknowledgedWarnings: [...(row.acknowledged_warnings ?? [])].sort(),
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
  };
}

export function revisionIsReadable(
  revision: StoredRevision | UnreadableRevision,
): revision is StoredRevision {
  return "definition" in revision;
}

/** The table this milestone added does not exist in every environment yet. */
function missingTable(code: string | undefined): boolean {
  return code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883";
}

// ---------------------------------------------------------------------------
// The active published revision
// ---------------------------------------------------------------------------

export type ActiveExperience = {
  revisionId: string;
  revision: number;
  definition: ExperienceDefinitionV1;
  definitionSha256: string;
  publishedAt: string;
};

export type ActiveExperienceResult =
  | { ok: true; active: ActiveExperience | null }
  /**
   * The study HAS an active revision and this build cannot read it. The
   * distinction from `active: null` is load-bearing: one means "this study is
   * a legacy study", the other means "somebody is being served the legacy
   * dashboard even though a composed experience was published", and only the
   * second is something an internal screen must shout about.
   */
  | { ok: false; reason: string; revisionId: string | null };

/**
 * What a client-facing route reads.
 *
 * IT RETURNS THE DEFINITION AND THE REVISION AND NOTHING ELSE. No prepared-by,
 * no note, no acknowledgement, no event, no draft — the internal record of how
 * a decision was made is not part of the decision's result, and a client route
 * that could reach it would eventually print it.
 *
 * IT NEVER READS A DRAFT and it never reads an unprepared revision: the pointer
 * is the only way in, and only `publish_`/`restore_` can move the pointer.
 */
export async function activeExperience(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
): Promise<ActiveExperienceResult> {
  const { data: pointer, error: pointerError } = await admin
    .from("study_experience_publication")
    .select("active_revision_id, updated_at")
    .eq("study_id", studyId)
    .maybeSingle<{ active_revision_id: string; updated_at: string }>();

  if (pointerError) {
    if (missingTable(pointerError.code)) return { ok: true, active: null };
    return {
      ok: false,
      reason: `No se pudo leer la publicación: ${pointerError.message}`,
      revisionId: null,
    };
  }
  if (!pointer) return { ok: true, active: null };

  const { data: row, error } = await admin
    .from("study_experience_revision")
    .select(REVISION_COLUMNS)
    // Scoped by BOTH, so a pointer that somehow named another study's revision
    // resolves to nothing rather than to that study's experience.
    .eq("id", pointer.active_revision_id)
    .eq("study_id", studyId)
    .maybeSingle<RevisionRow>();

  if (error) {
    return {
      ok: false,
      reason: `No se pudo leer la revisión publicada: ${error.message}`,
      revisionId: pointer.active_revision_id,
    };
  }
  if (!row) {
    return {
      ok: false,
      reason: "La revisión publicada no se encontró para este estudio.",
      revisionId: pointer.active_revision_id,
    };
  }

  const revision = readRevision(row);
  if (!revisionIsReadable(revision)) {
    return { ok: false, reason: revision.reason, revisionId: row.id };
  }
  return {
    ok: true,
    active: {
      revisionId: revision.id,
      revision: revision.revision,
      definition: revision.definition,
      definitionSha256: revision.definitionSha256,
      publishedAt: pointer.updated_at,
    },
  };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export const PUBLICATION_ACTIONS = [
  "revision_prepared",
  "published",
  "restored",
  "unpublished",
] as const;
export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number];

export type PublicationEvent = {
  id: string;
  action: PublicationAction;
  revisionId: string | null;
  replacedRevisionId: string | null;
  actorUserId: string | null;
  note: string | null;
  acknowledgedWarnings: string[];
  occurredAt: string;
};

export type RevisionHistoryEntry = {
  revision: StoredRevision | UnreadableRevision;
  /** Every publication and restoration of this exact revision, newest first. */
  publications: PublicationEvent[];
  /** True for the one revision the study is serving right now. */
  active: boolean;
  /**
   * True when this revision was active and a later event replaced it. Derived
   * from the event log, never stored — see migration 0025's header.
   */
  superseded: boolean;
  /** The event that replaced it, when it was replaced. */
  supersededBy: PublicationEvent | null;
};

export type RevisionHistory = {
  entries: RevisionHistoryEntry[];
  /** Every revision this study has, so paging can say what it left out. */
  total: number;
  page: number;
  pageSize: number;
  activeRevisionId: string | null;
  /** Ordinary problems reading the history, said rather than swallowed. */
  problem: string | null;
};

export const HISTORY_PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_HISTORY_PAGE_SIZE = 10;

export async function loadRevisionHistory(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<RevisionHistory> {
  const pageSize = HISTORY_PAGE_SIZES.includes(options.pageSize as (typeof HISTORY_PAGE_SIZES)[number])
    ? (options.pageSize as number)
    : DEFAULT_HISTORY_PAGE_SIZE;
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const from = (page - 1) * pageSize;

  const empty: RevisionHistory = {
    entries: [],
    total: 0,
    page,
    pageSize,
    activeRevisionId: null,
    problem: null,
  };

  const { data: pointer, error: pointerError } = await admin
    .from("study_experience_publication")
    .select("active_revision_id")
    .eq("study_id", studyId)
    .maybeSingle<{ active_revision_id: string }>();
  if (pointerError && !missingTable(pointerError.code)) {
    return { ...empty, problem: `No se pudo leer la publicación: ${pointerError.message}` };
  }
  const activeRevisionId = pointer?.active_revision_id ?? null;

  const { data: rows, error, count } = await admin
    .from("study_experience_revision")
    .select(REVISION_COLUMNS, { count: "exact" })
    .eq("study_id", studyId)
    .order("revision", { ascending: false })
    .range(from, from + pageSize - 1)
    .returns<RevisionRow[]>();

  if (error) {
    if (missingTable(error.code)) return { ...empty, activeRevisionId };
    return { ...empty, activeRevisionId, problem: `No se pudo leer el historial: ${error.message}` };
  }

  const revisionIds = (rows ?? []).map((row) => row.id);
  let events: PublicationEvent[] = [];
  if (revisionIds.length > 0) {
    const { data: eventRows, error: eventError } = await admin
      .from("study_experience_event")
      .select(
        "id, action, revision_id, replaced_revision_id, actor_user_id, note, acknowledged_warnings, occurred_at",
      )
      .eq("study_id", studyId)
      .in("action", ["published", "restored", "unpublished"])
      .order("occurred_at", { ascending: false })
      .returns<
        {
          id: string;
          action: PublicationAction;
          revision_id: string | null;
          replaced_revision_id: string | null;
          actor_user_id: string | null;
          note: string | null;
          acknowledged_warnings: string[] | null;
          occurred_at: string;
        }[]
      >();
    if (eventError && !missingTable(eventError.code)) {
      return {
        ...empty,
        activeRevisionId,
        problem: `No se pudo leer el registro de publicaciones: ${eventError.message}`,
      };
    }
    events = (eventRows ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      revisionId: row.revision_id,
      replacedRevisionId: row.replaced_revision_id,
      actorUserId: row.actor_user_id,
      note: row.note,
      acknowledgedWarnings: [...(row.acknowledged_warnings ?? [])].sort(),
      occurredAt: row.occurred_at,
    }));
  }

  const entries: RevisionHistoryEntry[] = (rows ?? []).map((row) => {
    const revision = readRevision(row);
    const publications = events.filter((event) => event.revisionId === row.id);
    const supersededBy = events.find((event) => event.replacedRevisionId === row.id) ?? null;
    return {
      revision,
      publications,
      active: activeRevisionId === row.id,
      superseded: activeRevisionId !== row.id && supersededBy !== null,
      supersededBy,
    };
  });

  return { entries, total: count ?? entries.length, page, pageSize, activeRevisionId, problem: null };
}

/** One revision by id, scoped to its study so a foreign id resolves to nothing. */
export async function loadRevision(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
  revisionId: string,
): Promise<StoredRevision | UnreadableRevision | null> {
  const { data, error } = await admin
    .from("study_experience_revision")
    .select(REVISION_COLUMNS)
    .eq("id", revisionId)
    .eq("study_id", studyId)
    .maybeSingle<RevisionRow>();
  if (error || !data) return null;
  return readRevision(data);
}

/** The newest prepared revision, which is what the review screen opens on. */
export async function latestRevision(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
): Promise<StoredRevision | UnreadableRevision | null> {
  const { data, error } = await admin
    .from("study_experience_revision")
    .select(REVISION_COLUMNS)
    .eq("study_id", studyId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle<RevisionRow>();
  if (error || !data) return null;
  return readRevision(data);
}

// ---------------------------------------------------------------------------
// The three writes
// ---------------------------------------------------------------------------

export type WriteOutcome<T> =
  | ({ ok: true } & T)
  /** Somebody else moved something. Reload and look again. */
  | { ok: false; kind: "conflict"; message: string }
  /** The request itself is not one this study can accept. */
  | { ok: false; kind: "rejected"; message: string }
  /** The actor may not do this. */
  | { ok: false; kind: "forbidden"; message: string }
  | { ok: false; kind: "unavailable"; message: string };

/**
 * One place that turns a SQLSTATE into a sentence.
 *
 * `55000` is the project's one code for "the thing you are writing to has moved
 * on" — chosen in migration 0024 because PostgREST retries `40001` until the
 * gateway gives up, so a `40001` refusal never reaches a browser. Every other
 * refusal keeps its own distinct code so this mapping never has to guess.
 */
function refusal(
  error: { code?: string; message?: string } | null,
  conflictMessage: string,
): { ok: false; kind: "conflict" | "rejected" | "forbidden" | "unavailable"; message: string } {
  const code = error?.code;
  if (code === "55000") return { ok: false, kind: "conflict", message: conflictMessage };
  if (code === "42501") {
    return { ok: false, kind: "forbidden", message: "Tu cuenta no puede publicar este estudio." };
  }
  if (code === "P0002") {
    return { ok: false, kind: "rejected", message: "Ese estudio o esa revisión ya no existe." };
  }
  if (code === "22023") {
    return { ok: false, kind: "rejected", message: "La solicitud no se pudo aceptar tal como está." };
  }
  if (missingTable(code)) {
    return {
      ok: false,
      kind: "unavailable",
      message: "La publicación de experiencias todavía no está disponible en esta base.",
    };
  }
  return {
    ok: false,
    kind: "unavailable",
    message: "No se pudo completar en este momento. Vuelve a intentarlo.",
  };
}

export async function prepareRevision(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    studyId: string;
    actorId: string;
    definition: ExperienceDefinitionV1;
    sourceDraftRevision: number;
    definitionSha256: string;
    studyFingerprint: string;
    acknowledgedWarnings: readonly string[];
    blockingCodes: readonly string[];
    note?: string | null;
    idempotencyKey: string;
  },
): Promise<WriteOutcome<{ revisionId: string; revision: number; created: boolean }>> {
  if (serializedBytes(input.definition) > EXPERIENCE_LIMITS.serializedBytes) {
    return {
      ok: false,
      kind: "rejected",
      message: "Esta experiencia es demasiado grande para publicarse. Quita bloques o páginas.",
    };
  }

  const { data, error } = await admin.rpc("prepare_study_experience_revision", {
    p_study_id: input.studyId,
    p_actor: input.actorId,
    p_definition: input.definition,
    p_schema_version: EXPERIENCE_SCHEMA_VERSION,
    p_source_draft_revision: input.sourceDraftRevision,
    p_definition_sha256: input.definitionSha256,
    p_study_fingerprint: input.studyFingerprint,
    p_acknowledged_warnings: [...input.acknowledgedWarnings].sort(),
    p_blocking_codes: [...input.blockingCodes].sort(),
    p_note: input.note ?? null,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return refusal(
      error,
      "El borrador cambió mientras preparabas esta revisión. Vuelve a abrir la revisión para tomar lo último.",
    );
  }
  const result = data as { revisionId?: string; revision?: number; created?: boolean } | null;
  if (!result?.revisionId || typeof result.revision !== "number") {
    return {
      ok: false,
      kind: "unavailable",
      message: "La preparación no confirmó una revisión. Vuelve a intentarlo.",
    };
  }
  return {
    ok: true,
    revisionId: result.revisionId,
    revision: result.revision,
    created: Boolean(result.created),
  };
}

export type SelectionResult = {
  revisionId: string;
  eventId: string;
  replacedRevisionId: string | null;
  created: boolean;
};

export async function publishRevision(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    studyId: string;
    actorId: string;
    revisionId: string;
    expectedActiveRevisionId: string | null;
    acknowledgedWarnings: readonly string[];
    blockingCodes: readonly string[];
    note?: string | null;
    idempotencyKey: string;
  },
): Promise<WriteOutcome<SelectionResult>> {
  const { data, error } = await admin.rpc("publish_study_experience_revision", {
    p_study_id: input.studyId,
    p_actor: input.actorId,
    p_revision_id: input.revisionId,
    p_expected_active_revision_id: input.expectedActiveRevisionId,
    p_acknowledged_warnings: [...input.acknowledgedWarnings].sort(),
    p_blocking_codes: [...input.blockingCodes].sort(),
    p_note: input.note ?? null,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return refusal(
      error,
      "Algo cambió mientras decidías: el borrador o la versión publicada ya no son los que revisaste. Vuelve a abrir la revisión.",
    );
  }
  return readSelection(data);
}

export async function restoreRevision(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    studyId: string;
    actorId: string;
    revisionId: string;
    expectedActiveRevisionId: string | null;
    reason: string;
    idempotencyKey: string;
  },
): Promise<WriteOutcome<SelectionResult>> {
  const { data, error } = await admin.rpc("restore_study_experience_revision", {
    p_study_id: input.studyId,
    p_actor: input.actorId,
    p_revision_id: input.revisionId,
    p_expected_active_revision_id: input.expectedActiveRevisionId,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return refusal(
      error,
      "La versión publicada cambió mientras decidías. Vuelve a abrir el historial y mira qué está activo ahora.",
    );
  }
  return readSelection(data);
}

function readSelection(data: unknown): WriteOutcome<SelectionResult> {
  const result = data as
    | { revisionId?: string; eventId?: string; replacedRevisionId?: string | null; created?: boolean }
    | null;
  if (!result?.revisionId || !result.eventId) {
    return {
      ok: false,
      kind: "unavailable",
      message: "La operación no confirmó un resultado. Recarga para ver qué quedó publicado.",
    };
  }
  return {
    ok: true,
    revisionId: result.revisionId,
    eventId: result.eventId,
    replacedRevisionId: result.replacedRevisionId ?? null,
    created: Boolean(result.created),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle state, derived
// ---------------------------------------------------------------------------

export type RevisionState = "prepared" | "published" | "superseded";

/**
 * Which lifecycle state one revision is in, right now.
 *
 * DERIVED FROM THE POINTER AND THE EVENT LOG, never stored on the revision.
 * A `status` column would have to be UPDATEd on a table whose entire purpose is
 * that it is never updated — and it would be the field that goes stale the one
 * time somebody restores an older revision without the code path that maintains
 * it. Two small reads cannot drift.
 *
 *   published   the study's pointer names it;
 *   superseded  it was active once and a later event replaced it;
 *   prepared    it was frozen and has never been served.
 */
export async function revisionState(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
  revisionId: string,
): Promise<RevisionState> {
  const { data: pointer } = await admin
    .from("study_experience_publication")
    .select("active_revision_id")
    .eq("study_id", studyId)
    .maybeSingle<{ active_revision_id: string }>();
  if (pointer?.active_revision_id === revisionId) return "published";

  const { data: replaced } = await admin
    .from("study_experience_event")
    .select("id")
    .eq("study_id", studyId)
    .eq("replaced_revision_id", revisionId)
    .limit(1)
    .maybeSingle<{ id: string }>();
  return replaced ? "superseded" : "prepared";
}
