import "server-only";

/**
 * THE CANONICAL PRESENTATION WORKSPACE — the one new door, and everything it
 * refuses to carry through it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE IS.
 *
 * One `server-only` loader that does six things in one place, so no surface can
 * do five of them and improvise the sixth:
 *
 *   1. reads the canonical study results, read-only;
 *   2. builds the canonical presentation registry from THAT document;
 *   3. projects the safe catalogue out of it;
 *   4. chooses and builds an appropriate v4 template;
 *   5. binds it EXPLICITLY;
 *   6. resolves it into a `PresentationRenderModel`.
 *
 * It lives in `src/lib/studio/` and not in `src/lib/presentation/` for a reason
 * the presentation gate enforces: that directory may contain exactly ONE module
 * carrying `import "server-only"`, and that module is its server barrel. A
 * second one there would either be redundant or would quietly make a module a
 * gate needs to import unimportable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CROSSES TO THE BROWSER, AND WHAT CANNOT.
 *
 * `ComposerPayload` is a DELIBERATE projection and every field is listed here
 * on purpose: a bound document, the safe catalogue, a resolved render model,
 * and the handful of display strings the screen puts in its own chrome.
 *
 * It cannot carry `CanonicalStudyResults`, a `CanonicalAddress`, a
 * `RegistrySource`, the registry itself, a canonical row, a respondent, an
 * identifier of a person, a free-text answer, a formula, a calculation input or
 * a credential — not because each is filtered out, but because the projection
 * is built by NAMING what goes in rather than by removing what must not. A
 * filter has to be right every time; a whitelist has to be right once.
 *
 * The registry never leaves this module TOWARDS A BROWSER.
 * `projectPresentationCatalog` is a drop that removes `source` and `addresses`,
 * and `resolvePresentation` returns a model whose types have nowhere to put
 * either.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT DOES LEAVE THIS MODULE TOWARDS ONE OTHER SERVER-ONLY MODULE, AND THAT IS A
 * CORRECTION TO THE SENTENCE ABOVE.
 *
 * Unit 6B.4A added `src/lib/studio/publication-workspace.ts`, which needs the
 * same canonical read: a publication has to be checked against the study's
 * CURRENT results, and the registry those results build is where the binding,
 * the package identity and the plan fingerprint come from. So `readAndBuild`,
 * `readStoredDraftRow`, `decodeStoredDraft` and `refusalFor` are exported.
 *
 * They are exported to a `server-only` module and to nothing else, and the
 * arrangement is deliberate rather than convenient: the alternative was a second
 * module holding its own `SupabaseClient` and doing its own canonical read,
 * which would be a THIRD door to the canonical layer. Sharing this one keeps the
 * door count at two — the publication route's chain passes through this file, and
 * the boundary gate's door table asserts exactly that by name.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT WILL NOT DO WHEN THERE IS NO CANONICAL PACKAGE.
 *
 * It returns a typed unavailable state and stops. It does NOT fall back to
 * `src/lib/dashboard/view.ts` or to any legacy calculation: a composer that
 * silently drew legacy numbers under a canonical heading would be the most
 * expensive kind of wrong, because it would look right. Every refusal below is
 * a named reason with a sentence a person can act on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT WRITES EXACTLY ONE THING, AND NOT THE ONE IT USED TO REFUSE.
 *
 * This paragraph used to read "AND IT WRITES NOTHING", and that was true of
 * Unit 6B.1, which had no storage path at all. Unit 6B.3A gives it one, so the
 * claim is corrected rather than left standing — a header that describes the
 * file's previous life is worse than no header.
 *
 * What it may now write is ONE row in ONE table: `canonical_presentation_draft`,
 * through `save_canonical_presentation_draft`, both created by migration 0029
 * and applied to no hosted project. There is no other insert, update, upsert,
 * delete or `revalidatePath` anywhere in this file.
 *
 * WHAT IT STILL CANNOT WRITE IS THE LEGACY DRAFT. `study_experience_draft`
 * holds the two legacy experience definitions — Cuicuilco at schema version 2
 * revision 72 and P6E at 3 revision 14 — and it is not named in this file, not
 * named in the save function's body, and not reachable from either. Those rows
 * are never read, migrated, reinterpreted or overwritten. That is now a
 * structural fact rather than an abstention: the canonical path addresses a
 * different table, so there is no argument by which it could reach them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { CanonicalReadError } from "@/lib/canonical-source";
import { loadCanonicalResultSource } from "@/lib/canonical-source/server";
import {
  buildPresentationRead,
  resolveUnderSelection,
  type CanonicalPresentationRead,
} from "@/lib/viewer";
import { JOURNEY_ROUTES_VARIANTS, offeredChartVariants } from "@/lib/composer";
// The payload types are declared on the CLIENT-SAFE side and imported here, not
// declared here and imported there. A `"use client"` composer surface has to
// name the shape it receives, and importing it from this module would give that
// surface a static import path to `@/lib/canonical-source`.
import type {
  BlueprintChoice,
  ComposerPayload,
  ComposerUnavailable,
  ComposerWorkspace,
  LoadResult,
  PreviewResult,
  SaveResult,
} from "@/lib/composer";
import {
  EMPTY_VIEWER_SELECTION,
  PresentationError,
  serializeDeterministic,
  type PresentationDocument,
  type PresentationIssue,
  type PresentationRenderModel,
} from "@/lib/presentation";
import { sha256Hex } from "@/lib/ingestion/canonical-commit/sha256";
import {
  bindPresentationDocument,
  buildApprovedCuicuilcoBlueprint,
  buildGenericStartingBlueprint,
  decodePresentationFromStorage,
  encodePresentationForStorage,
  projectPresentationCatalog,
  type CanonicalPresentationRegistry,
} from "@/lib/presentation/server";
import { validatePresentationDocument } from "@/lib/presentation";

/* -------------------------------------------------------------------------- */
/* blueprint selection — by what a study IS, never by which study it is        */
/* -------------------------------------------------------------------------- */

/**
 * A layout somebody designed, and the shape of study it was designed for.
 *
 * SELECTION IS NOT BY STUDY UUID, and there is no study id anywhere in this
 * file. A uuid switch says "this study gets the good layout" and says nothing
 * about why; the next study of the same shape then gets the generic one and
 * nobody can tell whether that was a decision or an omission.
 *
 * What a layout actually depends on is the SPECIFICATION its numbers were
 * produced under — `registry.source.specId` and `mappingVersion`, the same pair
 * that keys `CANONICAL_RESULTS_SPECS` — and then, beyond that, whether the
 * registry publishes the handles the layout names. The second half is not
 * declared here: `buildApprovedCuicuilcoBlueprint` already throws
 * `unknown_handle` when a handle it requires is missing, and that throw IS the
 * capability check. Re-declaring the sixteen handles in a table beside it would
 * create a second list to keep in step with the first.
 */
type BlueprintRegistration = {
  id: string;
  label: string;
  specIds: readonly string[];
  mappingVersions: readonly number[];
  build: (registry: CanonicalPresentationRegistry) => PresentationDocument;
};

const REGISTERED_BLUEPRINTS: readonly BlueprintRegistration[] = [
  {
    id: "cuicuilco-aprobado",
    label: "Plano aprobado",
    specIds: ["cuicuilco"],
    mappingVersions: [1],
    build: buildApprovedCuicuilcoBlueprint,
  },
];

function chooseBlueprint(
  registry: CanonicalPresentationRegistry,
  studyName: string,
): { document: PresentationDocument; choice: BlueprintChoice } {
  for (const registration of REGISTERED_BLUEPRINTS) {
    if (!registration.specIds.includes(registry.source.specId)) continue;
    if (!registration.mappingVersions.includes(registry.source.mappingVersion)) continue;
    try {
      return {
        document: registration.build(registry),
        choice: {
          id: registration.id,
          label: registration.label,
          because: `Este estudio se calculó con la especificación «${registry.source.specId}», que es la que este plano describe, y publica todos los resultados que el plano nombra.`,
        },
      };
    } catch (error) {
      // A registered layout whose handles this registry does not publish is a
      // MISS, not a failure: the study is of the right family and of the wrong
      // shape. It falls through to the generic layout rather than taking the
      // whole screen down with it. Anything that is not a presentation refusal
      // is a real defect and is rethrown.
      if (!(error instanceof PresentationError)) throw error;
    }
  }
  return {
    document: buildGenericStartingBlueprint(registry, {
      // Per SEMANTIC, not a global union. `offeredChartVariants` already is
      // the intersection of what the authority permits for a semantic with what
      // this build genuinely draws FOR IT, which is the only list a starting
      // document may choose from.
      drawableFor: offeredChartVariants,
      drawableForRoutes: JOURNEY_ROUTES_VARIANTS,
      title: studyName,
    }),
    choice: {
      id: "inicio-generico",
      label: "Inicio genérico",
      because:
        "Ningún plano registrado corresponde a la especificación de este estudio, así que se parte de una página construida con lo que este estudio sí publica. No se inventa la estructura de otro estudio.",
    },
  };
}

/* -------------------------------------------------------------------------- */
/* what crosses, and what does not                                             */
/* -------------------------------------------------------------------------- */

export type { ComposerPayload, ComposerUnavailable, ComposerWorkspace, LoadResult, PreviewResult, SaveResult };

const READ_REFUSALS: Record<string, ComposerUnavailable> = {
  NO_COMMITTED_PACKAGE: {
    reason: "no_canonical_package",
    detail:
      "Este estudio todavía no tiene un paquete canónico confirmado, así que no hay resultados canónicos que componer. No se dibuja nada con el cálculo heredado.",
  },
  MULTIPLE_COMMITTED_PACKAGES: {
    reason: "multiple_canonical_packages",
    detail:
      "Este estudio tiene más de un paquete canónico confirmado y no está dicho cuál es el suyo. Elegir uno aquí sería una decisión del producto disfrazada de detalle técnico.",
  },
  SPEC_NOT_REGISTERED: {
    reason: "specification_not_registered",
    detail:
      "La especificación de resultados de este estudio no está registrada en esta versión, así que no se puede saber qué significan sus números.",
  },
};

/* -------------------------------------------------------------------------- */
/* the loader                                                                  */
/* -------------------------------------------------------------------------- */

export type ComposerScope = {
  tenantId: string;
  studyId: string;
  /** The study's own name, for the starting document's title. */
  studyName: string;
};

/**
 * The registry and the results TOGETHER, or neither.
 *
 * `resolvePresentation` compares seven identity fields between the registry and
 * the results it is handed, and the applied-filter selection is in none of
 * them — so a registry built from one read and resolved against another read
 * passes every check while the array positions have moved underneath it. One
 * read, one registry, one resolution: that is why they are built here and not
 * fetched separately by whoever needs them.
 */
export async function readAndBuild(
  client: SupabaseClient,
  scope: ComposerScope,
): Promise<CanonicalPresentationRead> {
  // ONE READ, MANY BUILDS.
  //
  // The source is read from the database once and every filtered recomputation
  // is built from that same in-memory object. Reading again per selection would
  // multiply the twenty-six paged queries by the number of panels a page has,
  // and — worse — two reads could disagree, which is the one way two registries
  // built in the same request could address different things.
  //
  // This function is the ONLY thing in the filtered path that touches a
  // transport; everything after it is `src/lib/viewer`, which is pure and which
  // an offline gate therefore drives for real rather than in copy.
  const source = await loadCanonicalResultSource(client, {
    tenantId: scope.tenantId,
    studyId: scope.studyId,
  });
  return buildPresentationRead(source);
}

export function refusalFor(error: unknown): ComposerUnavailable {
  if (error instanceof CanonicalReadError) {
    return (
      READ_REFUSALS[error.code] ?? {
        reason: "canonical_read_refused",
        detail: `La lectura canónica se negó con el código ${error.code}. No se dibuja nada con el cálculo heredado.`,
      }
    );
  }
  throw error;
}

export async function loadPresentationComposerWorkspace(
  client: SupabaseClient,
  scope: ComposerScope,
  /**
   * Unit 6B.3A. When true, a STORED draft is preferred over the blueprint.
   *
   * It is an option on this function rather than a second loader because of the
   * "one read, many builds" rule directly above: a separate loader would do its
   * own `readAndBuild`, and the page would pay twenty-six paged queries twice
   * to answer one question. The stored document is resolved against the SAME
   * `built` the blueprint would have been.
   *
   * A stored draft that cannot be decoded or resolved does NOT fall back to the
   * blueprint. Falling back would put a fresh layout on screen under the same
   * heading as an hour of somebody's saved work, and the first autosave would
   * write it over the top. The refusal is shown instead.
   */
  options: { restoreStoredDraft?: boolean } = {},
): Promise<ComposerWorkspace> {
  let built;
  try {
    built = await readAndBuild(client, scope);
  } catch (error) {
    return { ok: false, unavailable: refusalFor(error) };
  }
  const { registry } = built;

  if (options.restoreStoredDraft) {
    const stored = await readStoredDraftRow(client, scope);
    if (!stored.ok) return { ok: false, unavailable: stored.unavailable };
    if (stored.row) {
      const restored = decodeStoredDraft(stored.row, scope);
      if (!restored.ok) return { ok: false, unavailable: unresolved(restored.errors) };
      const resolved = resolveUnderSelection(built, restored.value, EMPTY_VIEWER_SELECTION);
      if (!resolved.ok) return { ok: false, unavailable: unresolvedIssues(resolved.issues) };
      return {
        ok: true,
        payload: {
          document: restored.value,
          catalog: projectPresentationCatalog(registry),
          model: resolved.model,
          blueprint: {
            id: "borrador-almacenado",
            label: "Borrador guardado",
            because:
              "Se restauró el borrador que ya estaba guardado para este estudio, en la revisión " +
              `${stored.row.revision}. No se partió de un plano nuevo: hacerlo habría puesto una ` +
              "presentación en blanco encima de trabajo que alguien ya hizo.",
          },
        },
        persistence: { revision: stored.row.revision, restored: true },
      };
    }
  }

  let chosen;
  try {
    chosen = chooseBlueprint(registry, scope.studyName);
  } catch (error) {
    if (error instanceof PresentationError) {
      return {
        ok: false,
        unavailable: {
          reason: "nothing_to_present",
          detail:
            "Este estudio no publica todavía ningún resultado que una presentación pueda nombrar, así que no hay nada que componer.",
        },
      };
    }
    throw error;
  }

  // Validate the template before binding it. A blueprint is code, and code that
  // produced an invalid document should say so here rather than at the resolver,
  // where the message would be about a binding.
  const validated = validatePresentationDocument(JSON.parse(JSON.stringify(chosen.document)));
  if (!validated.ok) {
    return { ok: false, unavailable: unresolved(validated.errors) };
  }

  // THE BINDING IS AN ACT, AND IT HAPPENS HERE, ONCE, ON THE SERVER.
  // The blueprint is emitted unbound on purpose — a layout is a layout, and
  // which registry it answers for is the publisher's decision. Resolution
  // refuses an unbound document rather than binding one on the way past,
  // because a binding made on the read path agrees by construction and proves
  // nothing.
  const bound = bindPresentationDocument(validated.value, registry);
  // A FIRST LOAD IS THE NEUTRAL SELECTION, resolved by the same one function a
  // reader's filter change goes through. Two paths here would be two sets of
  // refusals, and the neutral one is the path nobody would think to test.
  const resolved = resolveUnderSelection(built, bound, EMPTY_VIEWER_SELECTION);
  if (!resolved.ok) return { ok: false, unavailable: unresolvedIssues(resolved.issues) };

  return {
    ok: true,
    payload: { document: bound, catalog: projectPresentationCatalog(registry), model: resolved.model, blueprint: chosen.choice },
    // NOTHING IS STORED, and the screen is told so rather than left to infer it
    // from a null. `restored: false` is what opens the save session in «Cambios
    // sin guardar»: a freshly built blueprint nobody has saved IS unsaved work.
    persistence: { revision: null, restored: false },
  };
}

function unresolved(errors: readonly PresentationIssue[]): ComposerUnavailable {
  // CODES AND PATHS, never `detail`. The contract's own prose is written for
  // a reviewer auditing a document and 6A.1 already decided it stops at the
  // server; this keeps that decision even though the reader here IS internal,
  // because the payload is the same shape the client route will eventually use.
  return unresolvedIssues(errors.map((issue) => ({ code: issue.code, path: issue.path })));
}

function unresolvedIssues(issues: { code: string; path: string }[]): ComposerUnavailable {
  return {
    reason: "presentation_unresolved",
    detail:
      "El documento de partida no resuelve contra los resultados de este estudio. Se muestran los códigos para que alguien lo revise; no se dibuja una aproximación.",
    issues,
  };
}

/* -------------------------------------------------------------------------- */
/* the explicit preview refresh                                                */
/* -------------------------------------------------------------------------- */

/**
 * Re-resolve a document the BROWSER edited, treating it as untrusted input.
 *
 * The document arriving here was in a browser's memory and may be anything. It
 * is validated against the strict v4 schema before it is looked at, re-bound
 * from a registry built HERE — never from a binding the client sent, which
 * would let a caller pin a document to a registry it was not authored against —
 * and resolved on the server. What comes back is a render model or typed
 * issues, and never a half-drawn page.
 *
 * It writes nothing. This is a read that ends in a value.
 */
export async function resolveEditedPresentation(
  client: SupabaseClient,
  scope: ComposerScope,
  candidate: unknown,
  viewerCandidate: unknown = EMPTY_VIEWER_SELECTION,
): Promise<PreviewResult> {
  const validated = validatePresentationDocument(candidate);
  if (!validated.ok) return { ok: false, unavailable: unresolved(validated.errors) };

  let built;
  try {
    built = await readAndBuild(client, scope);
  } catch (error) {
    return { ok: false, unavailable: refusalFor(error) };
  }

  // Re-bind rather than trust. The client's document may carry a stale binding,
  // a fabricated one, or none; binding it here from the registry this request
  // built means the fingerprint describes THIS study's THIS package, and the
  // resolver's own refusals still apply to everything else in the document.
  const bound = bindPresentationDocument(validated.value, built.registry);
  const resolved = resolveUnderSelection(built, bound, viewerCandidate);
  if (!resolved.ok) return { ok: false, unavailable: unresolvedIssues(resolved.issues) };
  return { ok: true, model: resolved.model, document: bound, selection: resolved.selection };
}

/* -------------------------------------------------------------------------- */
/* PERSISTENCE — Unit 6B.3A                                                    */
/* -------------------------------------------------------------------------- */

/**
 * THE DURABLE DRAFT, THROUGH THE DOOR THAT ALREADY EXISTS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS IN THIS FILE AND NOT IN A NEW ONE.
 *
 * There are exactly TWO doors from the application to the canonical layer, and
 * a table in `shadow-boundary-test.mjs` names them rather than counting them.
 * A `src/lib/studio/presentation-persistence.ts` holding its own
 * `SupabaseClient` would be a third, and "it is only a draft table" is exactly
 * the argument that turns two doors into five. So the load and the save live
 * behind the loader that already reads this study's canonical results — which
 * is also the only place that can build the registry a stored document has to
 * be checked against.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TABLE THESE FUNCTIONS TOUCH, AND THE ONE THEY CANNOT.
 *
 * `canonical_presentation_draft`, created by migration 0029 and applied to no
 * hosted project. It is a DIFFERENT table from `study_experience_draft`, which
 * holds the two legacy experience drafts — Cuicuilco at schema version 2
 * revision 72 and P6E at 3 revision 14. Neither of those rows is read, written,
 * migrated or named here, and the save function's own body does not name that
 * table either, so this path cannot reach them even by mistake.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SAVE DOES NOT RE-BIND, AND THE PREVIEW DOES.
 *
 * `resolveEditedPresentation` re-binds because a preview answers "what do this
 * study's numbers say about this layout, now" — and re-binding is how it stops
 * a browser pinning a document to a registry it was not authored against.
 *
 * A SAVE is the opposite. Re-binding on the way to storage would take a layout
 * authored against one package and silently file it as though it had been
 * authored against another — which is precisely the retargeting the binding
 * fingerprint exists to prevent, performed by the one operation that makes it
 * permanent. So the save resolves the document AS IT ARRIVED. A binding that no
 * longer matches is `binding_fingerprint_mismatch`, the author is told the
 * ground moved under them, and nothing is written.
 */

/* -------------------------------------------------------------------------- */
/* THE ONE WAY THROUGH — Unit 6B.4A                                            */
/* -------------------------------------------------------------------------- */

/**
 * WHY THIS FILE RE-EXPORTS THREE THINGS IT DOES NOT OWN.
 *
 * `src/lib/studio/publication-workspace.ts` needs to resolve a document, seal a
 * storage envelope and digest a render model. Every one of those reaches the
 * canonical layer — `@/lib/viewer` through the registry, `@/lib/presentation/server`
 * through persistence — and importing them THERE would give that module its own
 * edge into the canonical graph.
 *
 * That is not a style problem. The boundary gate's door table asserts that each
 * approved page reaches the canonical layer THROUGH ITS DECLARED LOADER, and it
 * follows the first path it finds. A publication module with its own direct edge
 * would sometimes be found by that path and sometimes by this one, depending on
 * the order two imports happen to be written in — a door that is approved on
 * Tuesday and unapproved on Wednesday because somebody sorted an import block.
 *
 * So the publication workspace imports from HERE and from nothing else that
 * touches the canonical layer, and its route's path to that layer is this file,
 * always, by construction rather than by luck.
 */
export { resolveUnderSelection } from "@/lib/viewer";
export type { CanonicalPresentationRead } from "@/lib/viewer";
export { encodePresentationForStorage } from "@/lib/presentation/server";

/**
 * SHA-256 over the canonical, key-sorted serialization of a render model.
 *
 * The same digest, from the same helper, that every other identity in this
 * system uses. It lives here rather than in the presentation layer because that
 * layer must not grow a reason to hash a render model: a render model is an
 * OUTPUT, and hashing it is a storage concern.
 */
export function renderModelDigest(model: PresentationRenderModel): string {
  return sha256Hex(serializeDeterministic(model));
}

const DRAFT_TABLE = "canonical_presentation_draft";

/** The row shape read back. Every column is named; none is a respondent's. */
export type DraftRow = {
  schema_version: number;
  document_kind: string;
  registry_version: string;
  binding_fingerprint: string;
  revision: number;
  definition: unknown;
  definition_sha256: string;
  /** When this revision was written. Read so a review can say WHICH revision. */
  updated_at: string;
};

/**
 * Absence is not a failure — most studies have never been saved, and inventing
 * an empty document for them would be a blank page that overwrites a real one
 * the first time somebody presses save. So "no row" is a success carrying null,
 * and only a transport refusal is `ok: false`.
 */
export type StoredDraftRead =
  | { ok: true; row: DraftRow | null }
  | { ok: false; unavailable: ComposerUnavailable };

/** The transport half: one row, or none, or a named refusal. Decodes nothing. */
export async function readStoredDraftRow(
  client: SupabaseClient,
  scope: ComposerScope,
): Promise<StoredDraftRead> {
  const { data, error } = await client
    .from(DRAFT_TABLE)
    .select(
      "schema_version, document_kind, registry_version, binding_fingerprint, revision, definition, definition_sha256, updated_at",
    )
    .eq("study_id", scope.studyId)
    // TENANT AS WELL AS STUDY. The study id is a primary key and is already
    // enough to identify the row; the tenant is added because every read in
    // this codebase is scoped by both, and a read that relies on one of two
    // available scopes is a read that stops being safe the day the other one
    // is the only one that was checked.
    .eq("tenant_id", scope.tenantId)
    .maybeSingle<DraftRow>();

  if (error) {
    return {
      ok: false,
      unavailable: {
        reason: "canonical_read_refused",
        detail:
          "No se pudo leer el borrador almacenado de este estudio. No se parte de un documento en " +
          "blanco, porque un documento en blanco guardado encima del almacenado sería una pérdida " +
          "de trabajo disfrazada de comienzo.",
      },
    };
  }
  return { ok: true, row: data ?? null };
}

/** The decoding half: pure over a row, so both callers refuse identically. */
export function decodeStoredDraft(row: DraftRow, scope: ComposerScope) {
  return decodePresentationFromStorage(
    {
      schemaVersion: row.schema_version,
      definition: row.definition,
      definitionSha256: row.definition_sha256,
      documentKind: row.document_kind,
      registryVersion: row.registry_version,
      binding: row.binding_fingerprint,
    },
    { tenantId: scope.tenantId, studyId: scope.studyId },
  );
}

/**
 * Read the stored draft, decode it, and resolve it against THIS study.
 *
 * This is the DELIBERATE reload — what the conflict flow calls. It does its own
 * canonical read, because it runs long after the page's, and resolving a stored
 * document against a registry built minutes ago would be resolving it against
 * results that may no longer be the study's.
 */
export async function loadStoredPresentation(
  client: SupabaseClient,
  scope: ComposerScope,
): Promise<LoadResult> {
  const stored = await readStoredDraftRow(client, scope);
  if (!stored.ok) return { ok: false, unavailable: stored.unavailable };
  if (!stored.row) return { ok: true, present: false };
  const data = stored.row;

  const decoded = decodeStoredDraft(data, scope);
  if (!decoded.ok) return { ok: false, unavailable: unresolved(decoded.errors) };

  let built;
  try {
    built = await readAndBuild(client, scope);
  } catch (caught) {
    return { ok: false, unavailable: refusalFor(caught) };
  }

  // AS STORED, NOT RE-BOUND. If the package changed since this draft was
  // written, the binding no longer matches and the resolver says so. That is a
  // fact the author has to see, not one to paper over on the way to the screen.
  const resolved = resolveUnderSelection(built, decoded.value, EMPTY_VIEWER_SELECTION);
  if (!resolved.ok) return { ok: false, unavailable: unresolvedIssues(resolved.issues) };

  return {
    ok: true,
    present: true,
    document: decoded.value,
    revision: data.revision,
    model: resolved.model,
  };
}

/**
 * Store a document the browser edited, or refuse for a named reason.
 *
 * The order is the argument. Nothing is written until the document has proved
 * it is a canonical presentation of THIS study, authored against THIS registry,
 * that resolves against THESE results — because a row that cannot be read back
 * is a row that turns an author's next visit into an error page.
 */
export async function storeEditedPresentation(
  client: SupabaseClient,
  scope: ComposerScope,
  actorUserId: string,
  candidate: unknown,
  expectedRevision: number | null,
  idempotencyKey: string,
): Promise<SaveResult> {
  // [1] IS IT A CANONICAL PRESENTATION AT ALL? A legacy v1-v3 blob is refused
  //     here, by name, before anything else looks at it.
  const validated = validatePresentationDocument(candidate);
  if (!validated.ok) {
    return {
      ok: false,
      reason: "document_refused",
      detail:
        "El documento no es una presentación canónica válida, así que no se guarda. Tus cambios " +
        "siguen en esta pestaña.",
      issues: validated.errors.map((entry) => ({ code: entry.code, path: entry.path })),
    };
  }

  // [2] DOES IT DESCRIBE THIS STUDY'S RESULTS? This is where binding, registry
  //     version, calculation version, package identity and study identity are
  //     all checked — seven comparisons inside `resolvePresentation`, each with
  //     its own code, none of them repeated here in a weaker form.
  let built;
  try {
    built = await readAndBuild(client, scope);
  } catch (caught) {
    const unavailable = refusalFor(caught);
    return { ok: false, reason: "storage_refused", detail: unavailable.detail };
  }
  const resolved = resolveUnderSelection(built, validated.value, EMPTY_VIEWER_SELECTION);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: "document_refused",
      detail:
        "El documento ya no corresponde a los resultados de este estudio, así que no se guarda. " +
        "Tus cambios siguen en esta pestaña.",
      issues: resolved.issues,
    };
  }

  // [3] THE ENVELOPE. The scope is stamped here and only here, and the digest is
  //     computed over the finished bytes rather than over the object.
  const encoded = encodePresentationForStorage(validated.value, {
    tenantId: scope.tenantId,
    studyId: scope.studyId,
  });
  if (!encoded.ok) {
    return {
      ok: false,
      reason: "document_refused",
      detail: "El documento no se puede almacenar en la forma que exige la columna.",
      issues: encoded.errors.map((entry) => ({ code: entry.code, path: entry.path })),
    };
  }

  const { data, error } = await client.rpc("save_canonical_presentation_draft", {
    p_study_id: scope.studyId,
    p_actor: actorUserId,
    p_definition: encoded.value.definition,
    p_registry_version: encoded.value.registryVersion,
    p_binding_fingerprint: encoded.value.binding,
    p_definition_sha256: encoded.value.definitionSha256,
    p_expected_revision: expectedRevision,
    p_idempotency_key: idempotencyKey,
    p_note: null,
  });

  if (error) {
    // 55000 IS THE CONFLICT, AND ONLY THE CONFLICT. Migration 0024 established
    // the code and its reason: PostgREST retries 40001 transparently, so a
    // serialization failure never reaches a caller and cannot be the code a
    // conflict travels under. Anything else is a refusal the operator may retry.
    if (error.code === "55000") {
      // WHICH REVISION, so the screen can say how far behind the operator is.
      //
      // A `raise` cannot carry data, so the number is read back — a plain SELECT
      // on a row this caller may already read, taken only on the conflict path.
      // A failure to read it is not a failure to report the conflict: the
      // conflict is the answer either way and the number is an refinement.
      const { data: latest } = await client
        .from(DRAFT_TABLE)
        .select("revision")
        .eq("study_id", scope.studyId)
        .eq("tenant_id", scope.tenantId)
        .maybeSingle<{ revision: number }>();
      return {
        ok: false,
        reason: "conflict",
        detail:
          "Alguien guardó una versión más reciente de este documento. No se sobrescribe: tus " +
          "cambios siguen aquí y puedes cargar la versión almacenada cuando decidas hacerlo.",
        storedRevision: latest?.revision ?? undefined,
      };
    }
    return {
      ok: false,
      reason: "storage_refused",
      // The database's own message is NOT forwarded. A constraint violation
      // quotes the values that violated it, and those values are the document.
      detail: "No pudimos guardar. Tus cambios siguen en esta pestaña; puedes volver a intentarlo.",
    };
  }

  const answer = data as {
    revision?: unknown;
    currentRevision?: unknown;
    created?: unknown;
    replayed?: unknown;
  } | null;
  if (!answer || typeof answer.revision !== "number") {
    return {
      ok: false,
      reason: "storage_refused",
      detail: "El guardado no devolvió una revisión, así que no se da por guardado.",
    };
  }

  return {
    ok: true,
    revision: answer.revision,
    // A function that did not report where the row is now is one this build does
    // not know. Falling back to `revision` would silently restore the very
    // assumption the field exists to remove, so the absence is treated as
    // "the same", which is true of every write and of a replay nobody superseded.
    currentRevision:
      typeof answer.currentRevision === "number" ? answer.currentRevision : answer.revision,
    created: answer.created === true,
    replayed: answer.replayed === true,
  };
}
