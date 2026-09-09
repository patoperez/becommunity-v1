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
  CLIENT_SURFACE_IS_LIVE,
  affectedBlocks,
  blockTitle,
  buildPublicationInventory,
  countVisibleToClient,
  pageTitle,
  runPublicationPreflight,
  structuralDifference,
  type PublicationHistoryEntry,
  type PublicationIdentity,
  type PublicationIssue,
  type PublicationPreflight,
  type PublicationReview,
  type PublicationReviewPayload,
  type PublicationPreviewResult,
  type PublicationSubject,
  type PublicationUnavailable,
  type PublicationUnavailableReason,
  type PainReviewPanel,
  type PainReviewSummary,
  type PainDecisionInput,
  type PainDecisionResult,
  type QualitativeCategorySet,
  type QualitativeReviewGroup,
  type QualitativeReviewPanel,
  type QualitativeSignOff,
  type SignOffResult,
  type PublishResult,
  type PublishedPresentation,
  type QualitativeBinding,
  type RestoreResult,
} from "@/lib/publication";
import {
  EMPTY_VIEWER_SELECTION,
  clientSeesBlock,
  serializeDeterministic,
  type PresentationDocument,
  type PresentationRenderModel,
} from "@/lib/presentation";
// EVERYTHING THAT REACHES THE CANONICAL LAYER COMES THROUGH ONE IMPORT, and the
// names below that look like they belong elsewhere are re-exported by that
// module on purpose. `resolveUnderSelection` lives in `@/lib/viewer`,
// `encodePresentationForStorage` in `@/lib/presentation/server`, and both reach
// the canonical layer by their own routes.
//
// WHAT THAT ACTUALLY BUYS, MEASURED RATHER THAN ASSERTED. The boundary gate's
// door table follows the FIRST path a breadth-first walk finds from a page to
// the canonical layer, and requires it to pass through the declared loader. A
// discrimination test tried both ways of breaking that: importing `@/lib/viewer`
// here does NOT break it today, because that module reaches the canonical layer
// two hops down and the loader reaches it in one; importing a canonical module
// DIRECTLY does, immediately and by name.
//
// So the rule is not "an extra import would flip the door" — it would not,
// today. It is that the shortest path from this module to the canonical layer
// should be a FACT ABOUT ITS IMPORTS rather than an accident of how deep two
// other modules happen to reach. One import, one path, one door, and the door
// row fails the moment this file takes an edge of its own.
import {
  decodeStoredDraft,
  encodePresentationForStorage,
  qualitativeEvidenceDigest,
  qualitativeGroupToken,
  qualitativeReviewState,
  qualitativeTokensMatch,
  readAndBuild,
  readStoredDraftRow,
  refusalFor,
  renderModelDigest,
  resolveUnderSelection,
  type CanonicalPresentationRead,
  type ComposerScope,
  type DraftRow,
} from "./presentation-workspace";
// THE PAIN REVIEW IS ITS OWN MODULE AND REACHES THE CANONICAL LAYER THROUGH THE
// SAME ONE DOOR. It imports `./presentation-workspace` and nothing else that
// touches canonical data, so this file taking an import of it adds no edge to
// the graph the boundary gate's door table walks.
import {
  authoredPainContent,
  loadJourneyPainReview,
  recordJourneyPainDecision,
  PAIN_REVIEW_NOT_APPLICABLE,
} from "./journey-pain-workspace";

/* -------------------------------------------------------------------------- */
/* the tables this module owns                                                 */
/* -------------------------------------------------------------------------- */

const SIGNOFF_TABLE = "canonical_qualitative_signoff";
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
  /** The sign-off row behind `subject.qualitativeSignOff`, with its id. */
  storedSignOff: StoredSignOff | null;
  /** The journey pain review, and the content it authorizes when complete. */
  pain: PainReviewPanel;
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
 * The ids of every block whose author marked its content required.
 *
 * A flat list over pages, in document order. The preflight matches it against
 * the resolved model by id and reports the block's authored TITLE, so nothing
 * internal reaches the review screen.
 */
function requiredBlockIdsOf(document: PresentationDocument): string[] {
  const ids: string[] = [];
  for (const page of document.pages) {
    for (const block of page.blocks) if (block.requiredContent === true) ids.push(block.id);
  }
  return ids;
}

/**
 * The contract's own key for the editorial slot a pain review fills.
 *
 * The same constant the resolver matches on, and matched on the KEY rather than
 * on the handle for the same reason: the handle is built from the requirement's
 * section and kind, and would collide with any future editorial slot in the
 * qualitative section.
 */
const JOURNEY_PAIN_REQUIREMENT_KEY = "curated_journey_pain_cloud";

/**
 * Does THIS document publish the journey pain cloud, and require its content?
 *
 * BOTH HALVES, and neither implies the other. A layout may draw the slot without
 * marking it required — in which case an unfinished review is a warning about a
 * block a client will not see, not a refusal to publish — and a layout may mark
 * some OTHER block required while drawing no pain cloud at all, in which case
 * the pain review is internal work with no bearing on publication.
 *
 * The preflight used to test `requiredBlockIds.length > 0`, which conflated the
 * second case with this one. It was right for the approved Cuicuilco layout by
 * accident, because that layout's only required block is this slot.
 */
function painContentIsRequired(
  built: CanonicalPresentationRead,
  document: PresentationDocument,
): boolean {
  for (const page of document.pages) {
    for (const block of page.blocks) {
      if (block.kind !== "editorial" || block.requiredContent !== true || block.slot === null) continue;
      const address = built.registry.addresses.get(block.slot);
      if (!address || address.at !== "configuration.requirement") continue;
      const requirement = built.results.configurationRequired[address.requirementIndex];
      if (requirement?.key === JOURNEY_PAIN_REQUIREMENT_KEY) return true;
    }
  }
  return false;
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
  model: PresentationRenderModel | null,
): QualitativeBinding[] {
  // WHICH BLOCKS A CLIENT WOULD ACTUALLY SEE, by their authored titles.
  //
  // From the RESOLVED MODEL and not from the document, for the same reason the
  // inventory is: a block waiting for content is in the layout and is nothing on
  // the page, and a reviewer asked to sign off on categories a client will never
  // be shown is being asked the wrong question.
  const visibleById = new Map<string, string>();
  if (model) {
    for (const page of model.pages) {
      for (const block of page.blocks) {
        if (!clientSeesBlock(block, CLIENT_SURFACE_IS_LIVE)) continue;
        visibleById.set(block.id, `${pageTitle(page)} · ${blockTitle(block)}`);
      }
    }
  }

  const found = new Map<number, { set: QualitativeCategorySet; blocks: string[] }>();
  for (const page of document.pages) {
    for (const block of page.blocks) {
      if (block.kind !== "result") continue;
      const address = built.registry.addresses.get(block.binding);
      if (!address || address.at !== "qualitative.group") continue;
      const group = built.results.qualitative.groups[address.groupIndex];
      if (!group) continue;
      const where = visibleById.get(block.id);
      const entry = found.get(address.groupIndex);
      if (entry) {
        // THE SAME GROUP, A SECOND BLOCK. The approved layout draws the active
        // group twice — «Miembros activos» and «Razones declaradas de riesgo» —
        // and the old code kept only the first, so the warning named one of the
        // two client-visible blocks carrying unreviewed categories.
        if (where !== undefined && !entry.blocks.includes(where)) entry.blocks.push(where);
        continue;
      }
      found.set(address.groupIndex, {
        set: {
          groupLabel: group.label,
          coding: group.coding,
          // The client's own order, which is the order a reviewer reads them in.
          categories: group.terms.map((term) => term.label),
          excluded: group.excluded.map((entry) => entry.label),
          blocks: [],
        },
        blocks: where === undefined ? [] : [where],
      });
    }
  }
  return [...found.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => ({ ...value.set, blocks: value.blocks }));
}

/**
 * A stored sign-off, with the row id the publication record needs.
 *
 * THE ID STAYS ON THE SERVER. `QualitativeSignOff` — the pure type the review
 * payload carries — has a digest and a time and no id, because a row id is a
 * database identifier and a review screen is held to naming none.
 */
type StoredSignOff = QualitativeSignOff & { id: string };

/**
 * The sign-off this study's CURRENT categories rest on, or the most recent one.
 *
 * TWO READS AND A PREFERENCE, and the preference is a lookup rather than a rule.
 * A sign-off for the exact current digest is the answer whenever one exists —
 * including when the categories changed and later changed back, because a review
 * of those words is a review of those words whatever happened in between. When
 * none exists, the most recent sign-off of ANY digest is returned so the
 * preflight can say «somebody reviewed, and it is no longer what is here» rather
 * than «nobody ever reviewed», which are different facts and need different
 * actions from the person reading them.
 */
async function readQualitativeSignOff(
  client: SupabaseClient,
  scope: ComposerScope,
  digest: string | null,
): Promise<StoredSignOff | null> {
  const read = async (exact: string | null): Promise<StoredSignOff | null> => {
    let query = client
      .from(SIGNOFF_TABLE)
      .select("id, evidence_digest, reviewed_at")
      .eq("study_id", scope.studyId)
      .eq("tenant_id", scope.tenantId);
    if (exact !== null) query = query.eq("evidence_digest", exact);
    const { data, error } = await query
      .order("reviewed_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; evidence_digest: string; reviewed_at: string }>();
    // A MISSING TABLE IS NOT A MISSING REVIEW, AND IT IS NOT SILENT EITHER.
    // Until migration 0031 is applied, this read fails and the answer is null —
    // which the preflight reports as «nobody has reviewed these», the safe
    // direction. It must never be reported as «reviewed».
    if (error || !data) return null;
    return { id: data.id, evidenceDigest: data.evidence_digest, reviewedAt: data.reviewed_at };
  };
  if (digest !== null) {
    const exact = await read(digest);
    if (exact) return exact;
  }
  return read(null);
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
      clientSurfaceIsLive: CLIENT_SURFACE_IS_LIVE,
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
      requiredBlockIds: [],
      qualitative: [],
      qualitativeReviewState: "not_applicable",
      // A SUBJECT THAT COULD NOT BE ASSEMBLED HAS NO PAIN QUEUE, and the honest
      // answer is «not applicable, no gaps» rather than «incomplete»: there is
      // no resolved document to require the content, so there is nothing to be
      // incomplete about. The blockers above say what is actually wrong.
      painApplicable: false,
      painGaps: [],
      painContentRequired: false,
      expectedActiveVersion: asserted.expectedActiveVersion,
      actualActiveVersion: null,
      structureChanged: false,
      acknowledged: asserted.acknowledged,
      ...over,
    },
    storedSignOff: null,
    // A REVIEW THAT COULD NOT BE ASSEMBLED HAS NO PAIN QUEUE EITHER, and the
    // honest answer is «not applicable» rather than «incomplete»: there is no
    // document to require the content, so there is nothing to be incomplete
    // about. The blockers above say what is actually wrong.
    pain: PAIN_REVIEW_NOT_APPLICABLE,
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

  // ── THE JOURNEY PAIN REVIEW, AND THE SECOND RESOLUTION IT MAY EARN ────────
  //
  // THE ORDER IS FORCED AND IT IS NOT A LOOP. The review needs to know which
  // touchpoints this document DRAWS, so it needs a resolved model; the model
  // needs the authored content, which only a complete review produces. So:
  // resolve once WITHOUT content to learn the offer, build the review against
  // that, and — only if it comes out complete — resolve again WITH the content.
  //
  // The choices are read from a model resolved without pain content, and adding
  // pain content changes no route and no touchpoint: it fills one editorial
  // slot and attaches badges to points that already exist. So the offer the
  // review was checked against is the offer the second model makes.
  const pain = await loadJourneyPainReview(client, scope, first.model);
  const authored = authoredPainContent(pain);
  const withContent = authored
    ? resolveUnderSelection(built, document, EMPTY_VIEWER_SELECTION, authored)
    : first;
  // A DOCUMENT THAT RESOLVED WITHOUT THE CONTENT AND REFUSES WITH IT IS A
  // REFUSAL, not a reason to fall back. Falling back would publish the empty
  // slot under a review that says it is filled.
  if (!withContent.ok) {
    const assembled = empty({
      ...base,
      bound: document.binding !== null,
      resolutionIssues: withContent.issues,
    });
    return { ...assembled, built, row, identity, document, current: currentRow, history };
  }
  const resolved = withContent;

  // REPRODUCIBILITY, CHECKED RATHER THAN ASSUMED. The resolver is pure and the
  // serialization is deterministic, so this cannot fail — which is precisely why
  // it is worth one more call: a publication is a promise that what was approved
  // is what will be served, and a promise nobody tests is a hope. It is resolved
  // with the SAME inputs as the model actually used, authored content included.
  const second = authored
    ? resolveUnderSelection(built, document, EMPTY_VIEWER_SELECTION, authored)
    : resolveUnderSelection(built, document, EMPTY_VIEWER_SELECTION);
  const reproducible =
    second.ok && serializeDeterministic(second.model) === serializeDeterministic(resolved.model);

  const publishedModel = currentRow ? (currentRow.render_model as PresentationRenderModel) : null;

  // THE CATEGORIES, THEN THE DIGEST, THEN THE SIGN-OFF THAT MATCHES IT.
  //
  // In that order, because the digest is a fact about the categories and the
  // sign-off is a fact about the digest. Reading the sign-off first would mean
  // choosing which review to believe before knowing what it had to be about.
  const qualitative = qualitativeBindings(built, document, resolved.model);
  const qualitativeSignOff = await readQualitativeSignOff(
    client,
    scope,
    qualitative.length === 0 ? null : qualitativeEvidenceDigest(qualitative),
  );

  const subject: PublicationSubject = {
    authorized: true,
    clientSurfaceIsLive: CLIENT_SURFACE_IS_LIVE,
    readRefusal: null,
    ...base,
    reviewedRevision: asserted.reviewedRevision,
    decodeIssues: null,
    bound: document.binding !== null,
    resolutionIssues: null,
    model: resolved.model,
    reproducible,
    // READ FROM THE DOCUMENT, WHICH IS THE ONLY PLACE IT EXISTS. A required
    // block is an authoring decision, and the resolved render model carries no
    // authoring material — so the ids travel beside the model rather than
    // inside it, and only the block's own TITLE ever reaches a screen.
    requiredBlockIds: requiredBlockIdsOf(document),
    qualitative,
    qualitativeReviewState: qualitativeReviewState(qualitative, qualitativeSignOff),
    // WHAT THE JOURNEY PAIN REVIEW LEFT UNFINISHED, in the preflight's own
    // closed vocabulary. `painApplicable` is separate from an empty gap list
    // because «this study has no pain material» and «its pain material is all
    // decided» are different facts that need different sentences.
    painApplicable: pain.applicable,
    painGaps: pain.gaps,
    painContentRequired: painContentIsRequired(built, document),
    expectedActiveVersion: asserted.expectedActiveVersion,
    structureChanged:
      publishedModel === null
        ? false
        : !structuralDifference(publishedModel, resolved.model).identical,
    acknowledged: asserted.acknowledged,
  };

  return {
    subject,
    storedSignOff: qualitativeSignOff,
    pain,
    built,
    document,
    model: resolved.model,
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
    // THE SAME FACT THE PREVIEW IS MOUNTED WITH. `PublicationReviewView` hands
    // the renderer viewer controls, so the count and the picture are taken over
    // the same surface — which is what makes «los ve el cliente: 23» a
    // statement about the 23 cards below it rather than about a different
    // screen.
    visibleBlockCount: model ? countVisibleToClient(model, CLIENT_SURFACE_IS_LIVE) : 0,
    inventory: model ? buildPublicationInventory(model, CLIENT_SURFACE_IS_LIVE) : [],
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
    // THE WORDS, THE BLOCKS THAT DRAW THEM, AND WHO READ THEM.
    //
    // The whole card, not a group label. A reviewer signing off has to see the
    // categories a client will read and every block that carries them, and the
    // preflight's warning above names the same blocks from the same source.
    qualitative: {
      state: subject.qualitativeReviewState,
      reviewedAt: assembled.storedSignOff?.reviewedAt ?? null,
      // THE WORDS AND AN OPAQUE IDENTITY PER GROUP, and no digest.
      //
      // The panel used to carry `evidenceDigest` and the browser echoed it back
      // to sign off. It does not any more: a sign-off recorded against a value
      // the browser supplied is a sign-off whose subject the browser chose, and
      // recomputing before comparing does not fix that — it compares the
      // client's memory with itself. The token below is per group, is base32
      // rather than hexadecimal, and is CHECKED against tokens the server mints
      // from its own read rather than kept.
      groups: subject.qualitative.map(
        (group): QualitativeReviewGroup => ({ ...group, token: qualitativeGroupToken(group) }),
      ),
    } satisfies QualitativeReviewPanel,
    // HOW FAR THE PAIN REVIEW HAS GOT, in counts and closed codes. The queue
    // itself is loaded by the editor screen, so a curated phrase reaches a
    // browser exactly where somebody is deciding about it.
    pain: {
      applicable: assembled.pain.applicable,
      complete: assembled.pain.complete,
      gaps: assembled.pain.gaps,
      counts: assembled.pain.counts,
    } satisfies PainReviewSummary,
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
/* the preview, under a reviewer's own selection                               */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the STORED draft under one reader's selection, and return only that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE REVIEW PREVIEW HAS TO BE OPERABLE.
 *
 * The screen's promise is «esta es la pantalla real». It was not: the renderer
 * was mounted without viewer controls, so every filter panel in the approved
 * layout was dropped from the preview as an unfinished edge — while the
 * inventory beside it counted all three as client-visible. Twenty drawn,
 * twenty-three reported, and both halves believed themselves.
 *
 * A reviewer approving a page with three working controls has to be able to
 * work them. Otherwise «revisé la vista del cliente» is a statement about a
 * screen no client will ever be served.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT WRITES NOTHING, AND IT DOES NOT RE-BIND.
 *
 * The document is decoded from storage and resolved AS STORED, exactly as the
 * publish path does. There is no insert, update, upsert, delete, RPC or
 * revalidation anywhere on this path; the draft's revision, bytes and digest
 * are identical before and after, and no publication row is read for it or
 * written by it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT REFUSES RATHER THAN APPROXIMATING.
 *
 * A selection naming a panel this document does not have, a dimension that
 * panel does not offer, or an ordinal position this study never minted is
 * refused by `resolveUnderSelection` with a typed issue. Nothing is dropped
 * quietly: a control that filtered by less than it said would be the one
 * failure a reader could never see.
 */
export async function previewStoredPresentationUnderSelection(
  client: SupabaseClient,
  scope: ComposerScope,
  selection: unknown,
): Promise<PublicationPreviewResult> {
  let built: CanonicalPresentationRead;
  try {
    built = await readAndBuild(client, scope);
  } catch (caught) {
    const refusal = refusalFor(caught);
    const reason: PublicationUnavailableReason =
      (READ_REFUSAL[refusal.reason] as PublicationUnavailableReason | undefined) ??
      "canonical_read_refused";
    return { ok: false, unavailable: unavailable(reason) };
  }

  const stored = await readStoredDraftRow(client, scope);
  if (!stored.ok) return { ok: false, unavailable: unavailable("canonical_read_refused") };
  if (!stored.row) return { ok: false, unavailable: unavailable("no_stored_draft") };

  const decoded = decodeStoredDraft(stored.row, scope);
  if (!decoded.ok) {
    return {
      ok: false,
      unavailable: unavailable(
        "review_refused",
        decoded.errors.map((issue) => ({ code: issue.code, path: issue.path })),
      ),
    };
  }

  const resolved = resolveUnderSelection(built, decoded.value, selection);
  if (!resolved.ok) {
    return { ok: false, unavailable: unavailable("review_refused", [...resolved.issues]) };
  }

  return {
    ok: true,
    payload: {
      model: resolved.model,
      // THE SAME PREDICATE, THE SAME SURFACE. A filtered view can leave a block
      // with nothing in it, so the count follows the selection rather than
      // staying at whatever the unfiltered document reported.
      visibleBlockCount: countVisibleToClient(resolved.model, CLIENT_SURFACE_IS_LIVE),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* recording a qualitative sign-off                                            */
/* -------------------------------------------------------------------------- */

/**
 * Record that a person read this study's exact current qualitative categories.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DIGEST THE BROWSER SENDS IS AN ASSERTION, AND IT IS CHECKED.
 *
 * The whole job is done again here, over a fresh read: the study's canonical
 * results are read, the registry is rebuilt, the stored draft is decoded and
 * resolved, the bound groups are collected, and the digest is recomputed. Only
 * if it equals what the screen sent is anything recorded — so a category set
 * that moved between the reading and the click is refused rather than signed,
 * and a sign-off always names words somebody actually saw.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT WRITES EXACTLY ONE THING, THROUGH THE ONE PATH THAT MAY.
 *
 * `record_canonical_qualitative_signoff`, from migration 0031. The table grants
 * `service_role` SELECT and nothing else, so this RPC is the only way a row is
 * created — a caller that could INSERT directly could manufacture a review
 * nobody performed. It touches no draft, no publication and no legacy table.
 *
 * REVIEWING THE SAME WORDS TWICE IS NOT TWO DECISIONS. The function returns the
 * existing record rather than writing a second one, which is also what makes a
 * retry after a lost response safe.
 */
export async function recordQualitativeSignOff(
  client: SupabaseClient,
  scope: ComposerScope,
  actorUserId: string,
  reviewedDraftRevision: number,
  groupTokens: readonly string[],
): Promise<SignOffResult> {
  // 1. RELOAD. The draft, the canonical results, the registry, the resolution
  //    and the bound groups — all of it, here, now. Nothing the browser sent
  //    takes part in producing any of it.
  const assembled = await assemble(client, scope, {
    reviewedRevision: reviewedDraftRevision,
    expectedActiveVersion: null,
    acknowledged: [],
  });

  // 2. THE REVIEW HAS TO BE OF A DRAFT THAT EXISTS, AND OF THIS ONE.
  //
  // A revision that moved means somebody saved while the screen was open, so
  // the categories on that screen may belong to a different document. Refusing
  // is «look again» rather than «something is wrong»: the two need different
  // sentences and this is the first.
  if (assembled.subject.stored === null || assembled.row === null) {
    return {
      ok: false,
      reason: "draft_moved",
      detail:
        "Este estudio ya no tiene un borrador canónico guardado, así que no hay categorías que revisar. Vuelve a cargar la pantalla.",
    };
  }
  if (assembled.subject.stored.revision !== reviewedDraftRevision) {
    return {
      ok: false,
      reason: "draft_moved",
      detail:
        "El borrador cambió mientras leías. No se registra una revisión de una versión que ya no es la actual: vuelve a cargar la pantalla y míralas otra vez.",
    };
  }

  // 3. AND THE DOCUMENT HAS TO STILL DESCRIBE THIS STUDY. A binding that no
  //    longer matches the registry built from the study's CURRENT results means
  //    the categories on screen were addressed through a map that has moved, and
  //    `assemble` has already refused to produce a model for it.
  if (assembled.subject.bound !== true || assembled.model === null) {
    return {
      ok: false,
      reason: "evidence_moved",
      detail:
        "La presentación ya no se resuelve contra los resultados actuales del estudio, así que no está claro qué categorías se estarían revisando. Vuelve a cargar la pantalla.",
    };
  }

  const groups = assembled.subject.qualitative;
  if (groups.length === 0) {
    return {
      ok: false,
      reason: "evidence_moved",
      detail:
        "Esta presentación ya no publica ninguna categoría cualitativa, así que no hay nada que revisar. Vuelve a cargar la pantalla.",
    };
  }

  // 4. FRESHNESS, DECIDED BY COMPARING WHAT THE REVIEWER SAW WITH WHAT IS HERE.
  //
  // The browser named the groups it was showing, in opaque tokens derived from
  // those groups' own words. The server mints the same tokens from the groups it
  // has just read, and the two sets must match exactly. A category added,
  // removed or renamed moves a token, the sets differ, and the sign-off is
  // refused — which is the same fact the digest comparison used to establish,
  // established without the digest ever crossing.
  if (!qualitativeTokensMatch(groups, groupTokens)) {
    return {
      ok: false,
      reason: "evidence_moved",
      detail:
        "Las categorías cambiaron mientras las leías, así que no se registra una revisión de algo que no viste. Vuelve a cargar la pantalla y míralas otra vez.",
    };
  }

  // 5. THE DIGEST, DERIVED HERE, FROM WHAT WAS JUST READ.
  //
  // This is the value the record is written against, and it exists only on this
  // side of the wire. There is no parameter on this function, on the Server
  // Action above it, or on the type the browser calls, by which a caller could
  // supply, influence or observe it.
  const digest = qualitativeEvidenceDigest(groups);

  const { data, error } = await client.rpc("record_canonical_qualitative_signoff", {
    p_study_id: scope.studyId,
    p_actor: actorUserId,
    p_evidence_digest: digest,
    // THE WORDS THEMSELVES, so an auditor reads what was approved rather than a
    // hash of it. Closed-coded category labels only — the same short vocabulary
    // a client is shown in the term cloud.
    p_category_labels: groups.flatMap((group) => [...group.categories, ...group.excluded]),
    p_block_titles: affectedBlocks(groups),
    p_note: null,
  });

  if (error) {
    return {
      ok: false,
      reason: "storage_refused",
      // The database's own message is NOT forwarded: a constraint violation
      // quotes the values that violated it, and those values are the words.
      detail: "No se pudo registrar la revisión. No cambió nada; puedes volver a intentarlo.",
    };
  }
  const answer = data as { reviewedAt?: unknown; created?: unknown } | null;
  if (!answer || typeof answer.reviewedAt !== "string") {
    return {
      ok: false,
      reason: "storage_refused",
      detail: "El registro de la revisión no devolvió una fecha, así que no se da por hecho.",
    };
  }
  return { ok: true, reviewedAt: answer.reviewedAt, replayed: answer.created !== true };
}

/* -------------------------------------------------------------------------- */
/* the journey pain editor                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Load the pain review queue for the editor screen.
 *
 * IT GOES THROUGH `assemble` RATHER THAN READING ON ITS OWN, so the touchpoints
 * a reviewer is offered are the ones THIS document draws, checked against the
 * study's current results — and so the editor and the publication screen can
 * never disagree about which points exist or about how far the review has got.
 */
export async function loadJourneyPainEditor(
  client: SupabaseClient,
  scope: ComposerScope,
): Promise<
  { ok: true; panel: PainReviewPanel } | { ok: false; unavailable: PublicationUnavailable }
> {
  const assembled = await assemble(client, scope, {
    reviewedRevision: null,
    expectedActiveVersion: null,
    acknowledged: [],
  });
  if (assembled.subject.readRefusal !== null) {
    return { ok: false, unavailable: unavailable(assembled.subject.readRefusal) };
  }
  if (assembled.subject.stored === null || assembled.row === null) {
    return { ok: false, unavailable: unavailable("no_stored_draft") };
  }
  return { ok: true, panel: assembled.pain };
}

/**
 * Record one reviewer's decision about one curated pain item.
 *
 * IT RE-READS EVERYTHING FIRST, exactly as the sign-off does: the draft, the
 * study's current results, the resolved document and the curated evidence. The
 * touchpoints the decision may name are the ones THIS document draws right now,
 * and the source digest the decision is stored against is computed on this side
 * from the rows that are here. The browser named an item and a choice; it did
 * not name the words, the digest, or the offer.
 */
export async function recordStoredJourneyPainDecision(
  client: SupabaseClient,
  scope: ComposerScope,
  actorUserId: string,
  input: PainDecisionInput,
): Promise<PainDecisionResult> {
  const assembled = await assemble(client, scope, {
    reviewedRevision: null,
    expectedActiveVersion: null,
    acknowledged: [],
  });
  if (assembled.subject.stored === null || assembled.model === null) {
    return {
      ok: false,
      reason: "invalid_scope",
      detail:
        "Este estudio todavía no tiene una presentación canónica resuelta, así que no hay puntos de contacto a los que asignar nada.",
    };
  }
  return recordJourneyPainDecision(client, scope, actorUserId, assembled.model, input);
}

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

  // THE QUALITATIVE DECISION, RECORDED WITH THE PUBLICATION AND IN ITS
  // TRANSACTION.
  //
  // 0031's wrapper does not reimplement publishing: it calls
  // `publish_canonical_presentation` — every refusal that function makes still
  // applies — and writes the qualitative record beside the snapshot in the same
  // transaction, so a publication without one cannot exist. A claim that the
  // categories were signed off names the sign-off row, and the database checks
  // that it belongs to this study and carries this digest before believing it.
  const signOffState = assembled.subject.qualitativeReviewState;
  const signOffDigest =
    assembled.subject.qualitative.length === 0
      ? null
      : qualitativeEvidenceDigest(assembled.subject.qualitative);

  const { data, error } = await client.rpc("publish_canonical_presentation_with_qualitative", {
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
    p_qualitative_review_state: signOffState,
    p_qualitative_digest: signOffDigest,
    // NAMED ONLY WHEN THE CLAIM IS «current». The database refuses that state
    // without a sign-off row of this study carrying this digest, so the
    // strongest thing a publication can record is also the hardest to assert.
    p_qualitative_signoff_id: signOffState === "current" ? assembled.storedSignOff?.id ?? null : null,
    // THE SET THE PREFLIGHT REQUIRED, WHICH IS THE SET THAT WAS GIVEN.
    //
    // `canPublish` is false while any required acknowledgement is missing, and
    // this line is only reached when it is true — so these are exactly the codes
    // a person ticked. It is written as the REQUIRED set rather than as what the
    // browser sent, because what the browser sent is an assertion and what the
    // preflight required is a fact; a caller acknowledging codes this document
    // does not have would otherwise write them into an audit record.
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
