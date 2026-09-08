import "server-only";

/**
 * THE PUBLICATION WORKSPACE — review, publish, restore, and read what is served.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ADDS NO DOOR TO THE CANONICAL LAYER.
 *
 * There are exactly two, and a table in `shadow-boundary-test.mjs` names them
 * rather than counting them. This module holds no canonical reader of its own:
 * it goes through `presentation-workspace.ts`, which is the composer's declared
 * loader, so the publication route's chain to the canonical layer passes through
 * a loader that was already argued for. What this file owns is the PUBLICATION
 * storage — three tables and three functions migration 0030 created — and
 * nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BROWSER NEVER SENDS THE THING BEING PUBLISHED.
 *
 * `publishPresentation` takes a draft revision, a publication version, a list of
 * acknowledged warning codes and an idempotency key. It then does the whole job
 * again on the server: reads the stored draft, reads the study's canonical
 * results, rebuilds the registry, decodes, resolves, runs the preflight, and
 * publishes only if it still passes. A review that went stale between the screen
 * and the click is refused by the numbers.
 *
 * That is not defence in depth for its own sake. The alternative — posting the
 * document and the digests back — would put a tenant uuid, a package key, a plan
 * fingerprint and two digests in a browser, and every one of them is internal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT STORES, AND WHY BOTH HALVES.
 *
 * A publication stores the resolved RENDER MODEL — so the client keeps being
 * served exactly what somebody approved, whatever later happens to the draft,
 * the canonical rows or this code — AND the identity the results had, so drift
 * is visible and attributable rather than silent. Neither substitutes for the
 * other, and migration 0030's header carries the argument.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT CANNOT TOUCH.
 *
 * The legacy experience tables. `study_experience_draft`, `_revision`, `_event`
 * and `_publication` are not named in this file, not named in the body of any
 * function it calls, and unreachable from either. The audit that decided this
 * unit's storage — `scripts/canonical-publication-audit.mjs` — proved on a real
 * PostgreSQL that publishing canonically through the legacy model would have
 * required destroying a legacy draft, and this path cannot even attempt it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildPublicationInventory,
  countVisibleToClient,
  runPublicationPreflight,
  structuralDifference,
  type PublicationHistoryEntry,
  type PublicationIdentity,
  type PublicationIssue,
  type PublicationPreflight,
  type PublicationReview,
  type PublicationReviewPayload,
  type PublicationSubject,
  type PublicationUnavailable,
  type PublicationUnavailableReason,
  type PublishResult,
  type PublishedPresentation,
  type QualitativeBinding,
  type RestoreResult,
} from "@/lib/publication";
import {
  EMPTY_VIEWER_SELECTION,
  serializeDeterministic,
  type PresentationDocument,
  type PresentationRenderModel,
} from "@/lib/presentation";
// EVERYTHING THAT REACHES THE CANONICAL LAYER COMES THROUGH ONE IMPORT, and the
// four names below that look like they belong elsewhere are re-exported by that
// module on purpose. `resolveUnderSelection` lives in `@/lib/viewer`,
// `encodePresentationForStorage` in `@/lib/presentation/server`, and both of
// those reach the canonical layer by their own routes. Importing them directly
// would give this module a second edge into that graph — and the boundary gate's
// door table follows the FIRST path it finds from a page, so which edge it
// followed would depend on the order two import statements happened to be
// written in. One import, one path, one door.
import {
  decodeStoredDraft,
  encodePresentationForStorage,
  readAndBuild,
  readStoredDraftRow,
  refusalFor,
  renderModelDigest,
  resolveUnderSelection,
  type CanonicalPresentationRead,
  type ComposerScope,
  type DraftRow,
} from "./presentation-workspace";

/* -------------------------------------------------------------------------- */
/* the tables this module owns                                                 */
/* -------------------------------------------------------------------------- */

const REVISION_TABLE = "canonical_presentation_revision";
const POINTER_TABLE = "canonical_presentation_publication";
const EVENT_TABLE = "canonical_presentation_publication_event";

/** One immutable snapshot, as this module reads it back. */
type RevisionRow = {
  id: string;
  version: number;
  source_draft_revision: number;
  published_at: string;
  registry_version: string;
  binding_fingerprint: string;
  results_contract_version: string;
  calculation_version: string;
  spec_id: string;
  mapping_version: number;
  package_idempotency_key: string;
  plan_fingerprint: string;
  render_model: unknown;
};

type PointerRow = { active_revision_id: string };

type EventRow = {
  action: "published" | "restored";
  version: number;
  occurred_at: string;
  revision_id: string;
  replaced_revision_id: string | null;
  draft_revision: number | null;
  note: string | null;
};

/* -------------------------------------------------------------------------- */
/* assembling the subject                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything one review or one publication needs, gathered once.
 *
 * ONE READ, ONE REGISTRY, ONE RESOLUTION — the rule the composer already
 * follows, for the reason it already states: `resolvePresentation` compares
 * identity fields between the registry and the results it is handed, and a
 * registry built from one read resolved against another passes every check while
 * the array positions have moved underneath it.
 */
type Assembled = {
  subject: PublicationSubject;
  built: CanonicalPresentationRead | null;
  document: PresentationDocument | null;
  model: PresentationRenderModel | null;
  row: DraftRow | null;
  identity: PublicationIdentity | null;
  publishedModel: PresentationRenderModel | null;
  current: RevisionRow | null;
  history: PublicationHistoryEntry[];
};

const READ_REFUSAL: Record<string, PublicationSubject["readRefusal"]> = {
  no_canonical_package: "no_canonical_package",
  multiple_canonical_packages: "multiple_canonical_packages",
  specification_not_registered: "specification_not_registered",
  canonical_read_refused: "canonical_read_refused",
};

function identityOf(built: CanonicalPresentationRead): PublicationIdentity {
  const { registry } = built;
  return {
    tenantId: registry.source.tenantId,
    studyId: registry.source.studyId,
    registryVersion: registry.registryVersion,
    bindingFingerprint: registry.binding,
    resultsContractVersion: registry.contractVersion,
    calculationVersion: registry.source.calculationVersion,
    specId: registry.source.specId,
    mappingVersion: registry.source.mappingVersion,
    packageIdempotencyKey: registry.source.packageIdempotencyKey,
    planFingerprint: registry.source.planFingerprint,
  };
}

/**
 * Which qualitative groups this document binds, and whether anybody has reviewed
 * them.
 *
 * The label comes from the RESULTS — the group's own words, which a client is
 * already shown — and never from the handle. `docs/CANONICAL_PRESENTATION_MODEL.md`
 * §3 forbids building a display label out of a handle, and a review screen is
 * not an exception.
 */
function qualitativeBindings(
  built: CanonicalPresentationRead,
  document: PresentationDocument,
): QualitativeBinding[] {
  const found = new Map<number, QualitativeBinding>();
  for (const page of document.pages) {
    for (const block of page.blocks) {
      if (block.kind !== "result") continue;
      const address = built.registry.addresses.get(block.binding);
      if (!address || address.at !== "qualitative.group") continue;
      const group = built.results.qualitative.groups[address.groupIndex];
      if (!group) continue;
      found.set(address.groupIndex, { label: group.label, reviewStatus: group.reviewStatus });
    }
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
}

/** Read the current publication pointer and the snapshot it names. */
async function readCurrentPublication(
  client: SupabaseClient,
  scope: ComposerScope,
): Promise<{ ok: true; row: RevisionRow | null } | { ok: false }> {
  const pointer = await client
    .from(POINTER_TABLE)
    .select("active_revision_id")
    .eq("study_id", scope.studyId)
    .eq("tenant_id", scope.tenantId)
    .maybeSingle<PointerRow>();
  if (pointer.error) return { ok: false };
  if (!pointer.data) return { ok: true, row: null };

  const revision = await client
    .from(REVISION_TABLE)
    .select(
      "id, version, source_draft_revision, published_at, registry_version, binding_fingerprint, " +
        "results_contract_version, calculation_version, spec_id, mapping_version, " +
        "package_idempotency_key, plan_fingerprint, render_model",
    )
    .eq("id", pointer.data.active_revision_id)
    // TENANT AND STUDY AS WELL AS THE ID. The id came from this study's own
    // pointer and is already enough; both scopes are added because every read in
    // this codebase is scoped by both, and a read that relies on one of two
    // available scopes stops being safe the day the other is the only one left.
    .eq("study_id", scope.studyId)
    .eq("tenant_id", scope.tenantId)
    .maybeSingle<RevisionRow>();
  if (revision.error) return { ok: false };
  return { ok: true, row: revision.data ?? null };
}

/**
 * The lifecycle log, newest first, as a reviewer reads it.
 *
 * NO ACTOR. Every other field here is about the study; who pressed the button is
 * about a person, and a review surface is held to «no PII». The database records
 * it for an audit that has a different reader.
 */
async function readHistory(
  client: SupabaseClient,
  scope: ComposerScope,
  currentRevisionId: string | null,
): Promise<PublicationHistoryEntry[]> {
  const { data, error } = await client
    .from(EVENT_TABLE)
    .select("action, version, occurred_at, revision_id, replaced_revision_id, draft_revision, note")
    .eq("study_id", scope.studyId)
    .eq("tenant_id", scope.tenantId)
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error || !data) return [];

  // The replaced revision is stored as a row id and shown as a VERSION, because
  // a version is what a person can say out loud and an id is storage. The map is
  // built from the events themselves, which is enough: every revision that was
  // ever replaced was first published, and a publication is an event.
  const versionById = new Map<string, number>();
  for (const row of data as EventRow[]) versionById.set(row.revision_id, row.version);

  return (data as EventRow[]).map((row) => ({
    version: row.version,
    action: row.action,
    occurredAt: row.occurred_at,
    replacedVersion:
      row.replaced_revision_id === null ? null : versionById.get(row.replaced_revision_id) ?? null,
    draftRevision: row.draft_revision,
    note: row.note,
    current: row.revision_id === currentRevisionId && row.action === "published",
  }));
}

/**
 * Do the whole job once: read, decode, resolve twice, and describe.
 *
 * `reviewedRevision` and `expectedActiveVersion` are what a REVIEWER asserted.
 * On the review path they are null — nothing has been asserted yet — and on the
 * publish path they carry what the screen was showing, which is what turns a
 * stale approval into a refusal instead of into a publication.
 */
async function assemble(
  client: SupabaseClient,
  scope: ComposerScope,
  asserted: {
    reviewedRevision: number | null;
    expectedActiveVersion: number | null;
    acknowledged: readonly string[];
  },
): Promise<Assembled> {
  const empty = (
    over: Partial<PublicationSubject>,
  ): Assembled => ({
    subject: {
      authorized: true,
      readRefusal: null,
      stored: null,
      reviewedRevision: asserted.reviewedRevision,
      decodeIssues: null,
      bound: null,
      resolutionIssues: null,
      model: null,
      reproducible: null,
      current: null,
      authored: null,
      lastPublished: null,
      qualitative: [],
      expectedActiveVersion: asserted.expectedActiveVersion,
      actualActiveVersion: null,
      structureChanged: false,
      acknowledged: asserted.acknowledged,
      ...over,
    },
    built: null,
    document: null,
    model: null,
    row: null,
    identity: null,
    publishedModel: null,
    current: null,
    history: [],
  });

  let built: CanonicalPresentationRead;
  try {
    built = await readAndBuild(client, scope);
  } catch (caught) {
    const refusal = refusalFor(caught);
    return empty({ readRefusal: READ_REFUSAL[refusal.reason] ?? "canonical_read_refused" });
  }
  const identity = identityOf(built);

  const stored = await readStoredDraftRow(client, scope);
  if (!stored.ok) return empty({ readRefusal: "canonical_read_refused", current: identity });
  if (!stored.row) return empty({ current: identity });
  const row = stored.row;

  const publication = await readCurrentPublication(client, scope);
  if (!publication.ok) return empty({ readRefusal: "canonical_read_refused", current: identity });
  const currentRow = publication.row;
  const history = await readHistory(client, scope, currentRow?.id ?? null);

  const lastPublished: PublicationIdentity | null = currentRow
    ? {
        tenantId: scope.tenantId,
        studyId: scope.studyId,
        registryVersion: currentRow.registry_version,
        bindingFingerprint: currentRow.binding_fingerprint,
        resultsContractVersion: currentRow.results_contract_version,
        calculationVersion: currentRow.calculation_version,
        specId: currentRow.spec_id,
        mappingVersion: currentRow.mapping_version,
        packageIdempotencyKey: currentRow.package_idempotency_key,
        planFingerprint: currentRow.plan_fingerprint,
      }
    : null;

  const base = {
    stored: {
      revision: row.revision,
      definitionSha256: row.definition_sha256,
      registryVersion: row.registry_version,
      bindingFingerprint: row.binding_fingerprint,
    },
    current: identity,
    authored: {
      registryVersion: row.registry_version,
      bindingFingerprint: row.binding_fingerprint,
    },
    lastPublished,
    actualActiveVersion: currentRow?.version ?? null,
  };

  const decoded = decodeStoredDraft(row, scope);
  if (!decoded.ok) {
    const assembled = empty({
      ...base,
      decodeIssues: decoded.errors.map(
        (issue): PublicationIssue => ({ code: issue.code, path: issue.path }),
      ),
    });
    return { ...assembled, built, row, identity, current: currentRow, history };
  }
  const document = decoded.value;

  // AS STORED, NOT RE-BOUND. A binding made on the read path agrees by
  // construction and proves nothing — and a publication is the one operation
  // where a silent re-binding would file a layout authored against one package
  // as though it had been authored against another, permanently.
  const first = resolveUnderSelection(built, document, EMPTY_VIEWER_SELECTION);
  if (!first.ok) {
    const assembled = empty({
      ...base,
      bound: document.binding !== null,
      resolutionIssues: first.issues,
    });
    return { ...assembled, built, row, identity, document, current: currentRow, history };
  }

  // REPRODUCIBILITY, CHECKED RATHER THAN ASSUMED. The resolver is pure and the
  // serialization is deterministic, so this cannot fail — which is precisely why
  // it is worth one more call: a publication is a promise that what was approved
  // is what will be served, and a promise nobody tests is a hope.
  const second = resolveUnderSelection(built, document, EMPTY_VIEWER_SELECTION);
  const reproducible =
    second.ok && serializeDeterministic(second.model) === serializeDeterministic(first.model);

  const publishedModel = currentRow ? (currentRow.render_model as PresentationRenderModel) : null;

  const subject: PublicationSubject = {
    authorized: true,
    readRefusal: null,
    ...base,
    reviewedRevision: asserted.reviewedRevision,
    decodeIssues: null,
    bound: document.binding !== null,
    resolutionIssues: null,
    model: first.model,
    reproducible,
    qualitative: qualitativeBindings(built, document),
    expectedActiveVersion: asserted.expectedActiveVersion,
    structureChanged:
      publishedModel === null
        ? false
        : !structuralDifference(publishedModel, first.model).identical,
    acknowledged: asserted.acknowledged,
  };

  return {
    subject,
    built,
    document,
    model: first.model,
    row,
    identity,
    publishedModel,
    current: currentRow,
    history,
  };
}

/* -------------------------------------------------------------------------- */
/* the review                                                                  */
/* -------------------------------------------------------------------------- */

const UNAVAILABLE_DETAIL: Record<PublicationUnavailableReason, string> = {
  no_canonical_package:
    "Este estudio todavía no tiene un paquete canónico confirmado, así que no hay resultados que publicar.",
  multiple_canonical_packages:
    "Este estudio tiene más de un paquete canónico confirmado y no está dicho cuál es el suyo.",
  specification_not_registered:
    "La especificación de resultados de este estudio no está registrada en esta versión.",
  canonical_read_refused:
    "No se pudieron leer los resultados canónicos de este estudio, así que no hay nada que revisar.",
  no_stored_draft:
    "Este estudio todavía no tiene una presentación guardada. Compón una en Construcción y guárdala antes de publicar.",
  review_refused: "No se pudo preparar la revisión de esta presentación.",
};

const unavailable = (
  reason: PublicationUnavailableReason,
  issues?: { code: string; path: string }[],
): PublicationUnavailable => ({ reason, detail: UNAVAILABLE_DETAIL[reason], issues });

/**
 * Everything the review screen needs, or a named reason there is nothing to show.
 *
 * A study with no canonical package and a study with no saved draft get their
 * own answers rather than an empty review with a blocker in it: neither is a
 * problem with a presentation, and showing an empty page and page inventory
 * beside «no hay paquete» would be describing a document that does not exist.
 *
 * EVERY OTHER CONDITION IS A FINDING ON A REAL REVIEW, not an unavailable state.
 * A document that does not resolve still has an inventory, a history and a
 * current publication worth seeing, and the reviewer needs all three to work out
 * what to do about it.
 */
export async function loadPublicationReview(
  client: SupabaseClient,
  scope: ComposerScope,
): Promise<PublicationReview> {
  const assembled = await assemble(client, scope, {
    reviewedRevision: null,
    expectedActiveVersion: null,
    acknowledged: [],
  });
  const { subject } = assembled;

  if (subject.readRefusal !== null) {
    return { ok: false, unavailable: unavailable(subject.readRefusal) };
  }
  if (subject.stored === null || assembled.row === null) {
    return { ok: false, unavailable: unavailable("no_stored_draft") };
  }

  // THE POINTER IS ECHOED, NOT ASSERTED, ON A REVIEW. A review has not decided
  // anything yet, so `expectedActiveVersion` is set to what the store holds —
  // which is what stops the review itself reporting a conflict against a
  // decision nobody has made.
  const preflight = runPublicationPreflight({
    ...subject,
    expectedActiveVersion: subject.actualActiveVersion,
  });

  const model = assembled.model;
  const payload: PublicationReviewPayload = {
    draftRevision: assembled.row.revision,
    draftSavedAt: assembled.row.updated_at,
    pageCount: model?.pages.length ?? 0,
    blockCount: model?.pages.reduce((total, page) => total + page.blocks.length, 0) ?? 0,
    visibleBlockCount: model ? countVisibleToClient(model) : 0,
    inventory: model ? buildPublicationInventory(model) : [],
    // A REFUSED RESOLUTION STILL SHOWS THE CLIENT VIEW OF NOTHING. There is no
    // model to preview, and inventing an empty one would be a preview of a page
    // that does not exist; the blockers say why, and the screen draws no preview.
    model: model ?? EMPTY_MODEL,
    blockers: preflight.blockers,
    warnings: preflight.warnings,
    required: preflight.required,
    current: assembled.current
      ? {
          version: assembled.current.version,
          publishedAt: assembled.current.published_at,
          sourceDraftRevision: assembled.current.source_draft_revision,
        }
      : null,
    difference:
      assembled.publishedModel && model
        ? structuralDifference(assembled.publishedModel, model)
        : null,
    history: assembled.history,
    publishable: preflight.blockers.length === 0,
  };

  return { ok: true, payload };
}

/**
 * What a screen is handed when there is nothing to draw.
 *
 * A shape with no pages, never a fabricated one. The screen tests
 * `blockers.length` before it draws a preview, so this is never rendered; it
 * exists because the payload's type says a model is always present, and the
 * alternative — making it nullable — would let a future surface draw `null`
 * pages by forgetting a check.
 */
const EMPTY_MODEL: PresentationRenderModel = {
  schemaVersion: 4,
  contractVersion: "",
  registryVersion: "",
  title: "",
  locale: "es-MX",
  pages: [],
};

/* -------------------------------------------------------------------------- */
/* publishing                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Publish the stored draft, or refuse for a named reason.
 *
 * The whole preflight runs again HERE, on the server, over a fresh read. What
 * the browser sent is treated as an ASSERTION about what a person reviewed —
 * "revision 7, over publication version 2" — and the assertion is checked, not
 * believed.
 */
export async function publishStoredPresentation(
  client: SupabaseClient,
  scope: ComposerScope,
  actorUserId: string,
  reviewedDraftRevision: number,
  expectedCurrentVersion: number | null,
  acknowledged: readonly string[],
  idempotencyKey: string,
): Promise<PublishResult> {
  // [0] A RETRY IS ANSWERED BEFORE ANYTHING IS RE-JUDGED, and this is not an
  //     optimisation.
  //
  // A retry after a lost response arrives at a world the FIRST attempt already
  // changed: the pointer has moved to the version that attempt created. So a
  // preflight run on the retry sees `expectedActiveVersion: null` against an
  // actual version 1 and raises `publication_pointer_moved` — a conflict — and
  // the operator is told to reload and look again after a publication that
  // succeeded. The database's own replay branch, which exists precisely for
  // this, was unreachable from the product: nothing ever got as far as the RPC.
  //
  // Found by the browser QA pressing publish twice, which is what a person does
  // when a response does not come back.
  //
  // THE LEDGER IS THE AUTHORITY, NOT THIS READ. It is not taken under the
  // study's advisory lock, so two simultaneous retries could both miss it — and
  // the RPC's own replay branch, which IS under that lock, catches that. This
  // read exists so a retry gets the honest answer instead of a conflict, not so
  // the database can stop checking.
  const alreadyPublished = await readReplayedPublication(client, scope, idempotencyKey);
  if (alreadyPublished) return alreadyPublished;

  const assembled = await assemble(client, scope, {
    reviewedRevision: reviewedDraftRevision,
    expectedActiveVersion: expectedCurrentVersion,
    acknowledged,
  });
  const preflight: PublicationPreflight = runPublicationPreflight(assembled.subject);

  if (!preflight.canPublish) {
    // A STALE REVIEW IS ITS OWN ANSWER. It is the only refusal where nothing is
    // wrong and the honest instruction is «vuelve a mirar», so it must not
    // arrive wearing the same clothes as «este documento no resuelve».
    const stale = preflight.blockers.some(
      (entry) => entry.code === "draft_revision_moved" || entry.code === "publication_pointer_moved",
    );
    return {
      ok: false,
      reason: stale ? "conflict" : "preflight_refused",
      detail: stale
        ? "Lo que revisaste ya no es lo que hay guardado. Vuelve a cargar esta pantalla y míralo otra vez antes de publicar."
        : "No se publicó: hay cosas que lo impiden o falta confirmar algo. Están listadas arriba.",
      blockers: preflight.blockers,
      unacknowledged: preflight.unacknowledged,
    };
  }

  const { built, document, model, identity, row } = assembled;
  if (!built || !document || !model || !identity || !row) {
    // Unreachable: `canPublish` implies every one of these. It refuses rather
    // than asserting, because a non-null assertion here would be a promise the
    // type system cannot keep on a path that writes.
    return {
      ok: false,
      reason: "preflight_refused",
      detail: "No se publicó: la revisión no quedó completa. Vuelve a cargar esta pantalla.",
    };
  }

  // THE ENVELOPE, sealed here and only here, exactly as the draft save seals it.
  // The digest is computed over the finished bytes rather than over the object.
  const encoded = encodePresentationForStorage(document, {
    tenantId: scope.tenantId,
    studyId: scope.studyId,
  });
  if (!encoded.ok) {
    return {
      ok: false,
      reason: "storage_refused",
      detail: "El documento no se puede almacenar en la forma que exige la columna.",
    };
  }

  const { data, error } = await client.rpc("publish_canonical_presentation", {
    p_study_id: scope.studyId,
    p_actor: actorUserId,
    p_source_draft_revision: row.revision,
    p_definition: encoded.value.definition,
    p_definition_sha256: encoded.value.definitionSha256,
    p_render_model: model,
    p_render_model_sha256: renderModelDigest(model),
    p_registry_version: identity.registryVersion,
    p_binding_fingerprint: identity.bindingFingerprint,
    p_results_contract_version: identity.resultsContractVersion,
    p_calculation_version: identity.calculationVersion,
    p_spec_id: identity.specId,
    p_mapping_version: identity.mappingVersion,
    p_package_idempotency_key: identity.packageIdempotencyKey,
    p_plan_fingerprint: identity.planFingerprint,
    p_acknowledged_warnings: [...preflight.required].sort(),
    p_blocking_codes: [],
    p_unacknowledged_codes: [],
    p_expected_active_revision_id: assembled.current?.id ?? null,
    p_idempotency_key: idempotencyKey,
    p_note: null,
  });

  if (error) {
    // 55000 IS THE PRECONDITION, AND ONLY THE PRECONDITION. Migration 0024
    // established the code and its reason: PostgREST retries 40001 transparently,
    // so a serialization failure never reaches a caller and cannot be the code a
    // conflict travels under.
    if (error.code === "55000") {
      return {
        ok: false,
        reason: "conflict",
        detail:
          "Algo cambió entre que revisaste y que decidiste: el borrador se guardó otra vez, o alguien publicó. Vuelve a cargar esta pantalla y míralo antes de publicar.",
      };
    }
    return {
      ok: false,
      reason: "storage_refused",
      // The database's own message is NOT forwarded. A constraint violation
      // quotes the values that violated it, and those values are the document.
      detail: "No pudimos publicar. No se cambió nada de lo que el cliente ve; puedes volver a intentarlo.",
    };
  }

  const answer = data as {
    version?: unknown;
    revisionId?: unknown;
    currentRevisionId?: unknown;
    replacedRevisionId?: unknown;
    replayed?: unknown;
  } | null;
  if (!answer || typeof answer.version !== "number") {
    return {
      ok: false,
      reason: "storage_refused",
      detail: "La publicación no devolvió una versión, así que no se da por publicada.",
    };
  }

  // WHERE THE POINTER IS NOW, and not only what this key produced. A replay says
  // "the publication under this key happened, at version N"; it does not say the
  // study is serving it. The two are read back so the screen can say which.
  const replayed = answer.replayed === true;
  let currentVersion = answer.version;
  if (replayed) {
    // A REAL WRITE SERVES WHAT IT JUST WROTE, by construction: this transaction
    // held the study's advisory lock and moved the pointer itself. A REPLAY did
    // not, and between the original attempt and this one somebody may have
    // published again — so the pointer is read back on that path and only on it.
    const now = await readCurrentPublication(client, scope);
    if (now.ok && now.row) currentVersion = now.row.version;
  }

  return {
    ok: true,
    version: answer.version,
    currentVersion,
    replacedVersion: assembled.current?.version ?? null,
    replayed,
  };
}

/**
 * Has a publication already been recorded for this study under this key?
 *
 * Answers with the outcome the first attempt produced — the version it created,
 * where the pointer is NOW, and what it replaced — or null when this key names
 * nothing. A replay's `version` and `currentVersion` differ when somebody has
 * published again since, and a caller that ignored the second would report its
 * own work live while a different version was being served.
 */
async function readReplayedPublication(
  client: SupabaseClient,
  scope: ComposerScope,
  idempotencyKey: string,
): Promise<PublishResult | null> {
  const { data, error } = await client
    .from(EVENT_TABLE)
    .select("action, version, replaced_revision_id")
    .eq("study_id", scope.studyId)
    .eq("tenant_id", scope.tenantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle<{ action: string; version: number; replaced_revision_id: string | null }>();
  if (error || !data || data.action !== "published") return null;

  const current = await readCurrentPublication(client, scope);
  let replacedVersion: number | null = null;
  if (data.replaced_revision_id !== null) {
    const previous = await client
      .from(REVISION_TABLE)
      .select("version")
      .eq("id", data.replaced_revision_id)
      .eq("study_id", scope.studyId)
      .eq("tenant_id", scope.tenantId)
      .maybeSingle<{ version: number }>();
    replacedVersion = previous.data?.version ?? null;
  }

  return {
    ok: true,
    version: data.version,
    currentVersion: current.ok && current.row ? current.row.version : data.version,
    replacedVersion,
    replayed: true,
  };
}

/* -------------------------------------------------------------------------- */
/* restoring                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Bring an approved publication back into the working draft, as a NEW revision.
 *
 * IT PUBLISHES NOTHING. The pointer does not move, no snapshot is edited,
 * superseded, unpublished or deleted, and what a client is served is exactly
 * what it was a second earlier. Making the restored document live means
 * reviewing and publishing it, through the whole preflight, against the study's
 * results as they are today — which is the only honest way to serve a document
 * approved against results that have since changed.
 */
export async function restoreStoredPublication(
  client: SupabaseClient,
  scope: ComposerScope,
  actorUserId: string,
  version: number,
  expectedDraftRevision: number | null,
  reason: string,
  idempotencyKey: string,
): Promise<RestoreResult> {
  // A VERSION IS RESOLVED TO A ROW INSIDE THIS STUDY'S SCOPE. The browser names
  // a number; a number from another study's history therefore cannot reach a row.
  const { data, error } = await client
    .from(REVISION_TABLE)
    .select("id, version")
    .eq("study_id", scope.studyId)
    .eq("tenant_id", scope.tenantId)
    .eq("version", version)
    .maybeSingle<{ id: string; version: number }>();

  if (error) {
    return {
      ok: false,
      reason: "storage_refused",
      detail: "No pudimos leer esa versión. No se cambió nada; puedes volver a intentarlo.",
    };
  }
  if (!data) {
    return {
      ok: false,
      reason: "restore_refused",
      detail: "Ese número de versión no corresponde a ninguna publicación de este estudio.",
    };
  }

  const call = await client.rpc("restore_canonical_presentation", {
    p_study_id: scope.studyId,
    p_actor: actorUserId,
    p_revision_id: data.id,
    p_expected_draft_revision: expectedDraftRevision,
    p_idempotency_key: idempotencyKey,
    p_reason: reason,
  });

  if (call.error) {
    if (call.error.code === "55000") {
      const stored = await readStoredDraftRow(client, scope);
      return {
        ok: false,
        reason: "conflict",
        detail:
          "Alguien guardó el borrador mientras mirabas esta pantalla. No se sobrescribe: vuelve a cargar y decide con lo que hay ahora.",
        storedRevision: stored.ok ? stored.row?.revision : undefined,
      };
    }
    if (call.error.code === "22023") {
      return {
        ok: false,
        reason: "restore_refused",
        detail: "Una restauración tiene que decir por qué, en una frase corta.",
      };
    }
    return {
      ok: false,
      reason: "storage_refused",
      detail: "No pudimos restaurar esa versión. No se cambió nada; puedes volver a intentarlo.",
    };
  }

  const answer = call.data as { version?: unknown; draftRevision?: unknown; replayed?: unknown } | null;
  if (!answer || typeof answer.draftRevision !== "number") {
    return {
      ok: false,
      reason: "storage_refused",
      detail: "La restauración no devolvió una revisión, así que no se da por hecha.",
    };
  }

  return {
    ok: true,
    version: data.version,
    draftRevision: answer.draftRevision,
    replayed: answer.replayed === true,
  };
}

/* -------------------------------------------------------------------------- */
/* what a client would be served                                               */
/* -------------------------------------------------------------------------- */

/**
 * Read the study's current publication as a CLIENT would receive it.
 *
 * It goes through `read_canonical_publication`, whose whole body is one
 * `jsonb_build_object` of three keys. That is the point: the projection is
 * expressed in SQL, so it cannot gradually acquire a fourth field by somebody
 * widening a `select *` here — and a gate can assert the shape against the
 * function rather than against this file's good intentions.
 *
 * NOTHING IN THIS PHASE CALLS IT FROM A CLIENT ROUTE. The production client
 * route is not switched by this unit; this exists so the read that will serve it
 * is written, proved and unable to leak before anybody wires it.
 */
export async function readPublishedPresentation(
  client: SupabaseClient,
  scope: Pick<ComposerScope, "tenantId" | "studyId">,
): Promise<PublishedPresentation | null> {
  const { data, error } = await client.rpc("read_canonical_publication", {
    p_study_id: scope.studyId,
    p_tenant_id: scope.tenantId,
  });
  if (error || data === null || typeof data !== "object") return null;
  const answer = data as { version?: unknown; publishedAt?: unknown; renderModel?: unknown };
  if (typeof answer.version !== "number" || typeof answer.publishedAt !== "string") return null;
  if (typeof answer.renderModel !== "object" || answer.renderModel === null) return null;
  return {
    version: answer.version,
    publishedAt: answer.publishedAt,
    renderModel: answer.renderModel as PresentationRenderModel,
  };
}
