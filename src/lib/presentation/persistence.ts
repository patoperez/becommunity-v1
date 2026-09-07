/**
 * THE PERSISTENCE ENVELOPE — everything the database owns, and nothing a person authors.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT UNIT 6A GOT WRONG.
 *
 * A presentation document carried `metadata.studyId`, `metadata.tenantId` and a
 * whole publication block: status, source draft revision, a SHA-256 of itself, a
 * study fingerprint, acknowledged warning codes and a prepared note. The
 * reasoning was sound about the RPC — `prepare_study_experience_revision`
 * genuinely refuses a definition whose `metadata` disagrees with the study row
 * (`0025…sql:410-413`) — and wrong about the layering, in three ways.
 *
 *   A DATABASE IDENTIFIER BECAME AUTHORABLE. A tenant and a study uuid sat in a
 *   type whose entire premise is that it names nothing the warehouse knows.
 *
 *   LIFECYCLE STATE WAS DUPLICATED. Migration 0025 owns publication: the active
 *   pointer is a table, revisions are immutable rows, and history is an
 *   append-only event log. A `status` field inside the definition is a second,
 *   writable copy of a fact the database derives — and the two can disagree.
 *
 *   A HASH SAT INSIDE THE THING IT HASHES. `definitionSha256` cannot be kept
 *   true of a document that contains it: writing the hash changes the bytes the
 *   hash covers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SO THERE ARE TWO SHAPES.
 *
 * `PresentationDocument` is what a person authors and what an editor edits.
 * The ENVELOPE below is what a row looks like. Nothing converts between them
 * implicitly: `encodePresentationForStorage` stamps the scope immediately before
 * a write, `decodePresentationFromStorage` strips it immediately after a read
 * and REFUSES a scope that is not the one the caller asked for.
 *
 * NOTHING HERE WRITES. Unit 6A.1 builds the encoder and the decoder and stops;
 * there is no Supabase client in this file, no RPC call, and no transport of any
 * kind. Wiring is Unit 6B's, and it will have these to wire.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  PRESENTATION_DOCUMENT_SCHEMA_VERSION,
  validatePresentationDocument,
  type PresentationDocument,
} from "./document";
import { failure, issue, success, type PresentationOutcome } from "./errors";
import { serializeDeterministic } from "./serialize";
import { sha256Hex } from "../ingestion/canonical-commit/sha256";

/**
 * The tenant and study a stored document belongs to.
 *
 * DATABASE IDENTIFIERS, and they live only here. No render model has a field
 * for them, `projectPresentationCatalog` never sees one, and the boundary gate
 * scans the client-reachable output for both.
 */
export type PresentationScope = {
  tenantId: string;
  studyId: string;
};

/**
 * Publication state, as the DATABASE derives it.
 *
 * Read back, never authored. It is typed here so a server surface can describe
 * what it read without inventing a shape, and it is deliberately not reachable
 * from `PresentationDocument`.
 */
export type PresentationPublicationState = {
  status: "draft" | "prepared" | "published";
  /** The draft's optimistic-concurrency token, or a revision's number. */
  revision: number;
  sourceDraftRevision: number | null;
  definitionSha256: string | null;
  studyFingerprint: string | null;
  acknowledgedWarnings: string[];
  preparedNote: string | null;
};

/** A row as it is written: the scope, the version, and the JSON definition. */
export type StoredPresentation = {
  scope: PresentationScope;
  /** Mirrors `study_experience_draft.schema_version`, which is NOT NULL. */
  schemaVersion: number;
  /** The stored `definition` jsonb, with its persistence metadata stamped in. */
  definition: Record<string, unknown>;
  /** SHA-256 over the stored definition, computed OUTSIDE it. */
  definitionSha256: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stamp the scope and produce the row.
 *
 * The document is validated FIRST: a definition that would not survive being
 * read back has no business being written. `metadata` is added here and only
 * here, in the shape `0025` cross-checks, and the hash is computed over the
 * finished bytes — outside the object, where it can stay true.
 */
export function encodePresentationForStorage(
  document: PresentationDocument,
  scope: PresentationScope,
  options: { subtitle?: string | null } = {},
): PresentationOutcome<StoredPresentation> {
  if (!UUID.test(scope.tenantId) || !UUID.test(scope.studyId)) {
    return failure([
      issue("persistence_scope_invalid", "$", "el alcance de almacenamiento no es un par de UUID válidos."),
    ]);
  }
  const validated = validatePresentationDocument(JSON.parse(serializeDeterministic(document)));
  if (!validated.ok) return failure(validated.errors);

  const definition: Record<string, unknown> = {
    ...(JSON.parse(serializeDeterministic(validated.value)) as Record<string, unknown>),
    metadata: {
      studyId: scope.studyId,
      tenantId: scope.tenantId,
      subtitle: options.subtitle ?? null,
    },
  };
  return success({
    scope,
    schemaVersion: PRESENTATION_DOCUMENT_SCHEMA_VERSION,
    definition,
    definitionSha256: sha256Hex(serializeDeterministic(definition)),
  });
}

/**
 * Read a row back as an authorable document, or refuse.
 *
 * Three refusals, and they are separate on purpose. A row whose stored
 * `schema_version` column disagrees with the JSON's own field is CORRUPT — the
 * save RPC enforces that they match (`0024…sql:86`), so a disagreement means
 * something wrote around it. A row belonging to another study is a SCOPE
 * violation and must never be silently rendered for the study that asked. And a
 * definition that does not validate is refused by the document's own rules,
 * including the legacy-family refusal, so nothing is ever reinterpreted.
 */
export function decodePresentationFromStorage(
  stored: { schemaVersion: number; definition: unknown },
  expectedScope: PresentationScope,
): PresentationOutcome<PresentationDocument> {
  const definition = stored.definition;
  if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
    return failure([issue("malformed_document", "$", "la definición almacenada no es un objeto.")]);
  }
  const record = definition as Record<string, unknown>;

  const declared = record.schemaVersion;
  if (typeof declared !== "number" || declared !== stored.schemaVersion) {
    return failure([
      issue(
        "persistence_scope_invalid",
        "$.schemaVersion",
        `la columna almacena la versión ${stored.schemaVersion} y el documento declara ` +
          `${String(declared)}. La función de guardado exige que coincidan, así que algo escribió ` +
          "sin pasar por ella.",
      ),
    ]);
  }

  const metadata = record.metadata;
  const scope =
    typeof metadata === "object" && metadata !== null
      ? (metadata as { studyId?: unknown; tenantId?: unknown })
      : {};
  if (scope.studyId !== expectedScope.studyId || scope.tenantId !== expectedScope.tenantId) {
    return failure([
      issue(
        "persistence_scope_mismatch",
        "$.metadata",
        "la definición almacenada pertenece a otro alcance del que se pidió. No se lee: un " +
          "documento de otro estudio resolvería sin fallar y respondería con las cifras equivocadas.",
      ),
    ]);
  }

  // Strip the persistence metadata; what comes back is authorable and nothing else.
  const authorable: Record<string, unknown> = { ...record };
  delete authorable.metadata;
  return validatePresentationDocument(authorable);
}
