import "server-only";

/**
 * THE CANONICAL PUBLICATION, AS AN AUTHORIZED CLIENT RECEIVES IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE IS FOR.
 *
 * Until Unit 6B.4B2I nothing read a canonical publication from a client-facing
 * route. The storage existed, the review existed, the publish path existed and
 * the database's own client projection existed — and `/insights/e/[studyId]`
 * still rendered the legacy P8 dashboard, so a publication would have changed
 * nothing a client could see. This is the missing half: the read a client route
 * performs, and the only one it may.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DRAFT IS NOT A FALLBACK, AND NEITHER IS ANYTHING ELSE.
 *
 * `canonical_presentation_draft` is not named in this file, is not named in the
 * body of anything this file calls on the publication path, and has no column
 * this module could read. A client is served an IMMUTABLE SNAPSHOT or the
 * documented fallback; there is no third branch in which a reader is quietly
 * given the thing an editor is still working on.
 *
 * The one place the frozen DEFINITION is read is the filtered path below, and
 * it is read from `canonical_presentation_revision` — the immutable table —
 * never from the draft.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTHORIZATION IS DONE HERE, NOT TRUSTED FROM A CALLER.
 *
 * Every entry point takes the REQUEST-SCOPED client and re-reads the study row
 * through it, so RLS decides — `published_study_select` gives a client a study
 * only when the row is their own tenant's AND its status is `published`. The
 * tenant used for every publication read afterwards comes from THAT ROW and
 * never from an argument, so a caller cannot name somebody else's tenant, and a
 * caller that got the authorization wrong cannot make this module leak.
 *
 * The publication tables themselves grant `select` to `service_role` alone and
 * deny both browser roles outright, so the admin client below is not a
 * convenience: it is the only role that can read them at all. It is constructed
 * AFTER the request-scoped authorization has succeeded, never before.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FILTERED PATH, AND THE ONE CHECK THAT MAKES IT SAFE.
 *
 * A publication stores the render model resolved under the NEUTRAL selection.
 * The moment a reader ticks a filter, a figure has to be RECOMPUTED, and a
 * recomputation is only honest if it is the published study's own arithmetic —
 * same evidence, same registry build, same editorial content, same resolver.
 *
 * Rather than test those four things one at a time and hope the list is
 * complete, this module recomputes the WHOLE publication from scratch under the
 * neutral selection and requires the result to digest to `render_model_sha256`
 * — the digest stored at publication. If it reproduces the published bytes
 * exactly, then every input that could change a number is provably the one that
 * was published, and recomputing under a filter is that same study filtered. If
 * it does not, the selection is REFUSED and the immutable snapshot is served
 * unchanged, with a sentence saying so.
 *
 * That is a proof rather than a heuristic, and it is deliberately stricter than
 * comparing binding fingerprints: a binding digests the package and the address
 * map, and would not notice a change to an approved journey-pain phrase or to
 * the resolver itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY NUMBER IS COMPUTED HERE, WHICH IS TO SAY ON THE SERVER.
 *
 * The browser receives a finished render model and a count. It holds no
 * threshold, no base, no formula, no address and no canonical key, and it is
 * handed no results — so there is nothing for a client component to aggregate
 * even if somebody tried. Contract C1, unchanged from the internal preview.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ADDS NO DOOR TO THE CANONICAL LAYER.
 *
 * Everything that touches canonical data comes from `presentation-workspace.ts`
 * — the composer's declared loader — and from `journey-pain-workspace.ts`,
 * which reaches the canonical layer through that same loader and nothing else.
 * This module holds no canonical reader of its own, and the boundary gate's
 * door table names the insights page beside both of its approved loaders and
 * proves, by CUTTING them out of the import graph, that no other path exists.
 *
 * It also takes no import from `publication-workspace.ts`, deliberately: that
 * module can publish and restore, and a client-facing route should not have a
 * write function in its import graph even one that the database would refuse.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EMPTY_VIEWER_SELECTION,
  type JourneyPainContent,
  type PresentationDocument,
  type PresentationRenderModel,
} from "@/lib/presentation";
import {
  CLIENT_SURFACE_IS_LIVE,
  countVisibleToClient,
  type PublishedClientRead,
  type PublishedPreviewResult,
  type PublishedStudyPayload,
  type PublishedSelectionRefusal,
} from "@/lib/publication";
import { PUBLISHED_SELECTION_DETAIL } from "@/lib/publication";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authoredPainContent,
  loadJourneyPainReview,
} from "@/lib/studio/journey-pain-workspace";
import {
  decodeStoredDraft,
  readAndBuild,
  renderModelDigest,
  resolveUnderSelection,
  type CanonicalPresentationRead,
  type ComposerScope,
} from "@/lib/studio/presentation-workspace";

/* -------------------------------------------------------------------------- */
/* the two tables this module may read, and no other                           */
/* -------------------------------------------------------------------------- */

const POINTER_TABLE = "canonical_presentation_publication";
const REVISION_TABLE = "canonical_presentation_revision";

/**
 * The frozen half, read only for a recomputation and NEVER sent to a browser.
 *
 * Named column by column. A `select("*")` here would put the definition, both
 * digests, the acknowledgement list and the publisher's user id one careless
 * spread away from a prop.
 */
const REVISION_COLUMNS =
  "schema_version, document_kind, registry_version, binding_fingerprint, " +
  "definition, definition_sha256, render_model_sha256, version, published_at";

type RevisionRow = {
  schema_version: number;
  document_kind: string;
  registry_version: string;
  binding_fingerprint: string;
  definition: unknown;
  definition_sha256: string;
  render_model_sha256: string;
  version: number;
  published_at: string;
};

/* -------------------------------------------------------------------------- */
/* authorization                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The study row, read with the READER'S OWN session so RLS decides.
 *
 * Null means «this person may not see this study», and every caller turns that
 * into the route's ordinary not-found. It deliberately cannot distinguish «no
 * such study» from «not yours»: telling a stranger that a study id exists is
 * itself a disclosure.
 */
async function authorizeStudy(
  requestClient: SupabaseClient,
  studyId: string,
): Promise<{ id: string; tenant_id: string; name: string } | null> {
  const { data, error } = await requestClient
    .from("study")
    .select("id, tenant_id, name")
    .eq("id", studyId)
    .maybeSingle<{ id: string; tenant_id: string; name: string }>();
  if (error || !data) return null;
  return data;
}

/* -------------------------------------------------------------------------- */
/* the client-visible read                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Read the study's current publication exactly as the database projects it.
 *
 * It goes through `read_canonical_publication`, whose whole body is one
 * `jsonb_build_object` of three keys. That is the point: the projection is
 * expressed in SQL, so it cannot gradually acquire a fourth field by somebody
 * widening a `select *` here — and a gate can assert the shape against the
 * function rather than against this file's good intentions.
 *
 * `null` is ambiguous on purpose at this level — no publication and a refused
 * read are both «nothing came back» — and the caller resolves it by asking the
 * pointer table, which distinguishes them.
 */
export async function readPublishedPresentation(
  client: SupabaseClient,
  scope: Pick<ComposerScope, "tenantId" | "studyId">,
): Promise<{ version: number; publishedAt: string; renderModel: PresentationRenderModel } | null> {
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

/** Does this study have an active canonical publication at all? */
async function pointerState(
  admin: SupabaseClient,
  scope: { tenantId: string; studyId: string },
): Promise<"present" | "absent" | "refused"> {
  const { data, error } = await admin
    .from(POINTER_TABLE)
    .select("active_revision_id")
    .eq("study_id", scope.studyId)
    // TENANT AND STUDY BOTH, although `study_id` is the primary key. Every read
    // in this codebase is scoped by both, and a read that relies on one of two
    // available scopes stops being safe the day the other is the only one left.
    .eq("tenant_id", scope.tenantId)
    .maybeSingle<{ active_revision_id: string }>();
  if (error) return "refused";
  return data ? "present" : "absent";
}

/** The frozen snapshot row, for a recomputation only. */
async function readActiveRevision(
  admin: SupabaseClient,
  scope: { tenantId: string; studyId: string },
): Promise<RevisionRow | null> {
  const pointer = await admin
    .from(POINTER_TABLE)
    .select("active_revision_id")
    .eq("study_id", scope.studyId)
    .eq("tenant_id", scope.tenantId)
    .maybeSingle<{ active_revision_id: string }>();
  if (pointer.error || !pointer.data) return null;

  const revision = await admin
    .from(REVISION_TABLE)
    .select(REVISION_COLUMNS)
    .eq("id", pointer.data.active_revision_id)
    .eq("study_id", scope.studyId)
    .eq("tenant_id", scope.tenantId)
    .maybeSingle<RevisionRow>();
  if (revision.error || !revision.data) return null;
  return revision.data;
}

/* -------------------------------------------------------------------------- */
/* the reproduction check                                                      */
/* -------------------------------------------------------------------------- */

type Reproduction =
  | {
      ok: true;
      built: CanonicalPresentationRead;
      document: PresentationDocument;
      authored: JourneyPainContent | null;
    }
  | { ok: false; refusal: PublishedSelectionRefusal };

/**
 * Recompute the whole publication under the neutral selection and require it to
 * reproduce the published bytes.
 *
 * THE ORDER IS THE SAME ORDER THE PUBLICATION USED, and that is not a
 * coincidence — it is the only way the digests can be compared at all.
 * `publishStoredPresentation` resolves once without the authored journey-pain
 * content to learn which touchpoints the document draws, builds the review
 * against that model, and resolves again WITH the content. So does this.
 *
 * A DIFFERENCE IS NOT AN ERROR. It is the ordinary consequence of a study being
 * re-imported, an editor changing an approved phrase, or this code being
 * deployed in a new version. The publication is unaffected in every one of
 * those cases; what is refused is only the recomputation.
 */
async function reproducePublication(
  admin: SupabaseClient,
  scope: ComposerScope,
  row: RevisionRow,
): Promise<Reproduction> {
  const decoded = decodeStoredDraft(
    {
      schema_version: row.schema_version,
      document_kind: row.document_kind,
      registry_version: row.registry_version,
      binding_fingerprint: row.binding_fingerprint,
      // The publication's own sequence, which the decoder does not read; it is
      // supplied because the row shape it shares with the draft has the field.
      revision: row.version,
      definition: row.definition,
      definition_sha256: row.definition_sha256,
      updated_at: row.published_at,
    },
    scope,
  );
  if (!decoded.ok) return { ok: false, refusal: "study_moved_since_publication" };

  let built: CanonicalPresentationRead;
  try {
    built = await readAndBuild(admin, scope);
  } catch {
    // `refusalFor` re-throws anything that is not a canonical read refusal, and
    // this path must never turn a programming error into a polite sentence —
    // so the refusal is derived from the fact of failure and nothing is
    // swallowed beyond it.
    return { ok: false, refusal: "recomputation_refused" };
  }

  const first = resolveUnderSelection(built, decoded.value, EMPTY_VIEWER_SELECTION);
  if (!first.ok) return { ok: false, refusal: "study_moved_since_publication" };
  const authored = authoredPainContent(await loadJourneyPainReview(admin, scope, first.model));
  const neutral = authored
    ? resolveUnderSelection(built, decoded.value, EMPTY_VIEWER_SELECTION, authored)
    : first;
  if (!neutral.ok) return { ok: false, refusal: "study_moved_since_publication" };

  // THE ONE COMPARISON. Everything above exists to make this line meaningful.
  if (renderModelDigest(neutral.model) !== row.render_model_sha256) {
    return { ok: false, refusal: "study_moved_since_publication" };
  }
  return { ok: true, built, document: decoded.value, authored };
}

/* -------------------------------------------------------------------------- */
/* what the route calls                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The client's study, unfiltered: the immutable snapshot, and whether this
 * publication can be recomputed under a reader's filters right now.
 */
export async function loadPublishedClientExperience(
  requestClient: SupabaseClient,
  studyId: string,
): Promise<PublishedClientRead> {
  const study = await authorizeStudy(requestClient, studyId);
  if (!study) return { state: "not_published" };
  const scope: ComposerScope = {
    tenantId: study.tenant_id,
    studyId: study.id,
    studyName: study.name,
  };

  const admin = createAdminClient();
  const pointer = await pointerState(admin, scope);
  if (pointer === "refused") return { state: "unreadable", reason: "publication_read_refused" };
  if (pointer === "absent") return { state: "not_published" };

  // THERE IS A PUBLICATION. From here a failure is a FAILURE — never a quiet
  // fall-through to the legacy experience, which would answer a client's
  // request for their published study with different numbers computed by a
  // different engine and say nothing about it.
  const published = await readPublishedPresentation(admin, scope);
  if (!published) return { state: "unreadable", reason: "publication_malformed" };

  const row = await readActiveRevision(admin, scope);
  if (!row) return { state: "unreadable", reason: "publication_read_refused" };
  const reproduction = await reproducePublication(admin, scope, row);

  return {
    state: "published",
    payload: {
      publishedAt: published.publishedAt,
      // ALWAYS THE STORED MODEL, never the recomputed one — even when the two
      // are provably identical. What a client is served is the snapshot; the
      // recomputation exists to decide whether FILTERING is safe, and letting
      // its output become the served bytes would quietly make the served thing
      // a function of today's code.
      model: published.renderModel,
      visibleBlockCount: countVisibleToClient(
        published.renderModel,
        reproduction.ok && CLIENT_SURFACE_IS_LIVE,
      ),
      filtersLive: reproduction.ok,
    },
  };
}

/**
 * The same publication under a reader's own selection.
 *
 * IT WRITES NOTHING. There is no insert, update, upsert, delete, RPC other than
 * the read projection, or revalidation on this path; the selection is never
 * stored, and the publication's revision, bytes and digests are identical
 * before and after.
 */
export async function previewPublishedPresentationUnderSelection(
  requestClient: SupabaseClient,
  studyId: string,
  selection: unknown,
): Promise<PublishedPreviewResult> {
  const refuse = (refusal: PublishedSelectionRefusal): PublishedPreviewResult => ({
    ok: false,
    refusal,
    detail: PUBLISHED_SELECTION_DETAIL[refusal],
  });

  const study = await authorizeStudy(requestClient, studyId);
  if (!study) return refuse("recomputation_refused");
  const scope: ComposerScope = {
    tenantId: study.tenant_id,
    studyId: study.id,
    studyName: study.name,
  };

  const admin = createAdminClient();
  // THE PROJECTION FIRST, so `publishedAt` is the same string the page was
  // given: the database formats that value, and reading the column directly
  // here would put two spellings of one moment on one screen.
  const published = await readPublishedPresentation(admin, scope);
  if (!published) return refuse("recomputation_refused");
  const row = await readActiveRevision(admin, scope);
  if (!row) return refuse("recomputation_refused");

  const reproduction = await reproducePublication(admin, scope, row);
  if (!reproduction.ok) return refuse(reproduction.refusal);

  const resolved = reproduction.authored
    ? resolveUnderSelection(
        reproduction.built,
        reproduction.document,
        selection,
        reproduction.authored,
      )
    : resolveUnderSelection(reproduction.built, reproduction.document, selection);
  if (!resolved.ok) return refuse("selection_not_available");

  const payload: PublishedStudyPayload = {
    publishedAt: published.publishedAt,
    model: resolved.model,
    // THE SAME PREDICATE, THE SAME SURFACE. A filtered view can leave a block
    // with nothing in it, so the count follows the selection rather than
    // staying at whatever the unfiltered publication reported.
    visibleBlockCount: countVisibleToClient(resolved.model, CLIENT_SURFACE_IS_LIVE),
    filtersLive: true,
  };
  return { ok: true, payload };
}
