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
import { CategoryLedgerError, readCategoryLedger, resolutionOf } from "./category-ledger";
import type { CategoryLedgerState } from "@/lib/category-review";
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
  presentationBindingFingerprint,
  projectPresentationCatalog,
  type CanonicalPresentationRegistry,
  type StoredPresentation,
} from "@/lib/presentation/server";
import { validatePresentationDocument } from "@/lib/presentation";
// The search space of the rebind's exhibition proof — see `assessPresentationRebind`.
import { SUPERSEDED_RESULTS_CONTRACT_VERSIONS } from "@/lib/results/contract";

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
  return (await readAndBuildWithLedger(client, scope)).read;
}

/**
 * The same read, plus the ledger STATE the projection was derived from.
 *
 * Only the category review surface needs the state itself: it has to tell a
 * reviewer that this environment cannot record a decision, which the projection
 * alone cannot say — an unprovisioned ledger and a study nobody has decided
 * anything about both project to nothing, and they are not the same sentence.
 * Every other caller takes the resolution and is right not to care.
 */
export async function readAndBuildWithLedger(
  client: SupabaseClient,
  scope: ComposerScope,
): Promise<{ read: CanonicalPresentationRead; ledger: CategoryLedgerState }> {
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

  // THE EDITORIAL CATEGORY PROJECTION, READ HERE AND NOWHERE ELSE.
  //
  // It costs exactly ONE outbound request whatever the study holds, and it is
  // read at the door rather than by each caller on purpose: a surface that
  // forgot it would publish the source's ungrouped categories while the review
  // screen beside it showed the grouped ones, and nothing would say so. One
  // read, one registry, one resolution.
  //
  // A LEDGER THAT COULD NOT BE READ FAILS THE WHOLE LOAD. `refusalFor` turns it
  // into the typed unavailable every caller already renders, which is the
  // opposite of the defect Unit 6B.4B2K removed: an unknown projection must
  // never quietly become the empty one, because the empty one is a real answer
  // that means «nobody has decided anything».
  const ledger = await readCategoryLedger(client, {
    tenantId: scope.tenantId,
    studyId: scope.studyId,
  });
  const projection = resolutionOf(ledger);
  if (!projection.ok) throw new CategoryLedgerError(projection.code, projection.detail);

  return { read: buildPresentationRead(source, projection.resolution), ledger };
}

export function refusalFor(error: unknown): ComposerUnavailable {
  // A LEDGER FAILURE IS A READ REFUSAL, and it is reported as one rather than
  // as an absence of decisions. The code is closed and the sentence is prepared;
  // neither the database's message nor the study's own state appears in it.
  if (error instanceof CategoryLedgerError) {
    return { reason: "canonical_read_refused", detail: error.detail };
  }
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
 * follows the first path a breadth-first walk finds. A publication module with a
 * DIRECT edge into the canonical layer is found by that edge instead, and the
 * door is then reported as skipping the loader it was approved for — which a
 * discrimination test makes happen on purpose, so the rule is known to bite.
 *
 * So the publication workspace imports from HERE and from nothing else that
 * touches the canonical layer, and its route's path to that layer is this file,
 * always, by construction rather than by luck.
 */
export { resolveUnderSelection } from "@/lib/viewer";
export type { CanonicalPresentationRead } from "@/lib/viewer";
export { encodePresentationForStorage } from "@/lib/presentation/server";
/**
 * THE QUALITATIVE EVIDENCE DIGEST, re-exported through the declared loader.
 *
 * `src/lib/publication/evidence-digest.ts` hashes a set of category labels with
 * the product's own SHA-256, which lives under `canonical-commit/`. Importing it
 * from `publication-workspace.ts` gave that module a one-hop edge into the
 * canonical graph, and the boundary gate's door table refused it by name: the
 * publication route's shortest path to that layer stopped running through this
 * file.
 *
 * That is the rule working, not the rule being awkward. `resolveUnderSelection`
 * and `encodePresentationForStorage` are here for exactly the same reason. One
 * import statement, one path, one door.
 */
export {
  qualitativeEvidenceDigest,
  qualitativeGroupToken,
  qualitativeReviewState,
  qualitativeTokensMatch,
} from "@/lib/publication/evidence-digest";
/**
 * THE JOURNEY-PAIN IDENTITIES AND DIGESTS, re-exported for the same reason.
 *
 * `src/lib/publication/journey-pain-digest.ts` mints an item token and hashes
 * the source words with the same SHA-256, so importing it directly from
 * `publication-workspace.ts` would give that module its own edge into the
 * canonical graph — exactly what the evidence digest above was moved here to
 * avoid. One import statement, one path, one door.
 */
export { painItemToken, painSourceDigest, painSourceVersion } from "@/lib/publication/journey-pain-digest";
/**
 * THE CATEGORY FAMILY DIGESTS AND THE SOURCE VOCABULARY, for the same reason
 * twice over.
 *
 * `src/lib/category-review/digest.ts` reaches the product's SHA-256, and
 * `buildCategorySourceCounts` is a results build. Importing either directly
 * from the category review workspace would give that module its own edge into
 * the canonical graph — exactly what the two blocks above were moved here to
 * avoid. One import statement, one path, one door.
 */
export { categorySourceDigest, categorySourceVersion } from "@/lib/category-review/digest";
export { buildCategorySourceCounts } from "@/lib/results";
/**
 * THE CURATED PAIN EVIDENCE READER, likewise, and it is the one that matters
 * most: it is a genuine canonical read, so it MUST arrive through the declared
 * loader rather than through an edge of the publication module's own.
 *
 * It is a separate read from `loadCanonicalResultSource` and adds nothing to
 * it: the canonical read model still excludes `pain_point`'s text columns, the
 * results contract does not move, and golden parity is untouched. What it adds
 * is the internal editorial read a named reviewer needs in order to decide.
 */
export { loadCuratedPainReviewEvidence } from "@/lib/canonical-source/server";
export type { CuratedPainEvidence } from "@/lib/canonical-source/server";

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
/**
 * The append-only log 0029 writes beside every draft revision.
 *
 * Read — never written — by the rebind, to tell a RETRY apart from a CONFLICT.
 * The save RPC owns the writes to it.
 */
const DRAFT_EVENT_TABLE = "canonical_presentation_draft_event";

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

  return saveEncodedPresentation(
    client,
    scope,
    actorUserId,
    encoded.value,
    expectedRevision,
    idempotencyKey,
    null,
  );
}

/**
 * The WRITE, extracted so there is exactly one of it.
 *
 * Unit 6B.4B2E added a second caller — the explicit rebind — and the tempting
 * shape was a second `client.rpc(...)` beside this one. Two call sites would be
 * two places to keep the conflict code, the replay flags and the shape of the
 * answer true, and the second would be the one nobody re-read. So the envelope
 * is produced by whoever owns the document, and the write is here, once.
 *
 * `note` is the one thing the two callers differ on: a composed save has
 * nothing to add beyond the event itself, and a rebind records which contract
 * versions it moved between, which is the fact an auditor will want and cannot
 * reconstruct from the row.
 */
async function saveEncodedPresentation(
  client: SupabaseClient,
  scope: ComposerScope,
  actorUserId: string,
  encoded: StoredPresentation,
  expectedRevision: number | null,
  idempotencyKey: string,
  note: string | null,
): Promise<SaveResult> {
  const { data, error } = await client.rpc("save_canonical_presentation_draft", {
    p_study_id: scope.studyId,
    p_actor: actorUserId,
    p_definition: encoded.definition,
    p_registry_version: encoded.registryVersion,
    p_binding_fingerprint: encoded.binding,
    p_definition_sha256: encoded.definitionSha256,
    p_expected_revision: expectedRevision,
    p_idempotency_key: idempotencyKey,
    p_note: note,
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

/* -------------------------------------------------------------------------- */
/* THE EXPLICIT REBIND — Unit 6B.4B2E                                          */
/* -------------------------------------------------------------------------- */

/**
 * WHY A REBIND IS A SEPARATE ACT, AND WHY IT IS NOT A REGENERATION.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SITUATION IT EXISTS FOR.
 *
 * A stored draft names its handles against the registry it was authored under,
 * and pins that registry by fingerprint. When the RESULTS CONTRACT VERSION is
 * raised — `CANONICAL_RESULTS_CONTRACT_VERSION`, which is one of the nine
 * inputs to `presentationBindingFingerprint` — every stored binding stops
 * matching at once, on every study, without a single number, handle or address
 * having moved. The composer then refuses to open the draft at all
 * (`binding_fingerprint_mismatch`), which is correct and is also a dead end:
 * the save path deliberately does not re-bind, so there is no sequence of
 * clicks that gets an author out of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SAVE PATH STILL MUST NOT RE-BIND, AND THIS MAY.
 *
 * Re-binding ON SAVE would take a layout authored against one package and file
 * it as though it had been authored against another, permanently, as a side
 * effect of an unrelated act. That is the retargeting the fingerprint exists to
 * prevent and the reason `storeEditedPresentation` resolves the document AS IT
 * ARRIVED.
 *
 * This function is the opposite in every way that matters: it is asked for on
 * purpose, it changes NOTHING an author wrote, and it refuses unless it can
 * PROVE that the only input which moved is the contract version.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW "ONLY THE CONTRACT VERSION MOVED" IS PROVED RATHER THAN ASSUMED.
 *
 * A digest says that something moved, never which thing. So the stored binding
 * is EXHIBITED: recomputed from today's registry — today's address map, today's
 * seven source-identity fields, today's registry version — with nothing
 * substituted but the contract version, once per version this product has
 * shipped (`SUPERSEDED_RESULTS_CONTRACT_VERSIONS`). If one of them reproduces
 * the stored fingerprint, then every other input is identical bit for bit: the
 * tenant, the study, the spec, the mapping version, the calculation version,
 * the package key, the plan fingerprint and all 279 handle-to-address entries.
 * That is a proof, not an inference.
 *
 * If NONE reproduces it, something else moved — a package, a mapping, a
 * calculation, a renamed label, a reordered group — and this refuses. A rebind
 * is then the wrong instrument, and saying so is the entire point.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE AUTHORED CONTENT IS COMPARED BYTE FOR BYTE ANYWAY.
 *
 * The exhibition proves the REGISTRY did not move. A separate, independent
 * check proves the DOCUMENT did not: the authored projection — every field
 * except `binding` and `registryVersion` — is serialized deterministically
 * before and after and must be byte-identical. Two proofs of two different
 * facts, because a single check that happened to cover both would stop covering
 * one of them the day it changed.
 */

/** Why a rebind cannot proceed. Closed, and every member is reachable. */
export type RebindRefusalReason =
  | "no_stored_draft"
  | "storage_refused"
  | "document_refused"
  | "source_identity_differs"
  | "authored_content_would_change"
  | "does_not_resolve_after_rebind"
  | "conflict";

/** The one field a rebind moves, and what it moves it from and to. */
export type RebindChange = {
  field: "binding" | "registryVersion";
  from: string;
  to: string;
};

/**
 * What a rebind would do, in the words an operator needs.
 *
 * IT CARRIES NO DATABASE IDENTIFIER. No tenant, no study, no package key, no
 * plan fingerprint: this value is rendered in a browser, and the boundary gate
 * scans client-reachable output for exactly those. What it carries instead are
 * the two opaque digests the operator is being asked to approve the change
 * between, and counts of what survives untouched.
 */
export type RebindPlan = {
  status: "ready";
  storedRevision: number;
  /** The contract version the stored binding was computed under — PROVED, not guessed. */
  supersededContractVersion: string;
  currentContractVersion: string;
  /** Exactly the fields that move. Anything else here would be a defect. */
  changes: RebindChange[];
  /** What does NOT move, so the screen can say so in specifics rather than in promises. */
  preserved: {
    title: string;
    pages: number;
    blocks: number;
    samplePolicyMode: string;
    methodologyDisclosure: string;
    /** Bytes of the authored projection — identical before and after, by construction. */
    authoredBytes: number;
    /** Digest of that projection. The same value appears in the post-write proof. */
    authoredDigest: string;
  };
};

export type RebindUnavailable = {
  status: "not_needed" | "refused";
  reason: RebindRefusalReason | "already_current";
  detail: string;
  /**
   * Code and path only, exactly as `ComposerUnavailable` carries them.
   *
   * A `PresentationIssue` also holds a `detail` sentence written for this
   * layer's own diagnostics; this value is rendered in a browser, and the
   * screen already has a sentence of its own to show. Narrowing here rather
   * than at the component keeps the two refusal surfaces the same shape.
   */
  issues?: { code: string; path: string }[];
};

export type RebindAssessment = RebindPlan | RebindUnavailable;

/**
 * Everything except the two binding fields, serialized deterministically.
 *
 * This is what "the authored document did not change" MEANS here, and it is
 * compared as bytes rather than by walking fields, so a field added to the
 * schema tomorrow is covered on the day it is added rather than on the day
 * somebody remembers to extend a comparison.
 */
function authoredProjection(document: PresentationDocument): string {
  const copy = { ...document } as Record<string, unknown>;
  delete copy.binding;
  delete copy.registryVersion;
  return serializeDeterministic(copy);
}

/**
 * Decide what a rebind would do to THIS stored row against THIS registry.
 *
 * Pure over its inputs: it reads nothing and writes nothing, so the page can
 * call it to describe the change and the action can call it again to perform
 * one, and the two cannot disagree about what was approved.
 */
export function assessPresentationRebind(
  built: CanonicalPresentationRead,
  row: DraftRow,
  scope: ComposerScope,
): RebindAssessment {
  const registry = built.registry;

  // ALREADY CURRENT is not a failure and must not be reported as one. A second
  // press of the button, a reload, a colleague who got there first: all three
  // arrive here, and all three are answered with "there is nothing to do".
  if (row.binding_fingerprint === registry.binding && row.registry_version === registry.registryVersion) {
    return {
      status: "not_needed",
      reason: "already_current",
      detail:
        "El vínculo de este borrador ya corresponde al contrato vigente. No hay nada que actualizar y no se escribe nada.",
    };
  }

  const decoded = decodeStoredDraft(row, scope);
  if (!decoded.ok) {
    return {
      status: "refused",
      reason: "document_refused",
      detail:
        "El borrador almacenado no se puede leer como documento canónico, así que no se vuelve a vincular.",
      issues: decoded.errors.map((entry) => ({ code: entry.code, path: entry.path })),
    };
  }

  // [1] THE EXHIBITION. Which shipped contract version, and only the contract
  //     version, reproduces the stored fingerprint from today's registry?
  const supersededContractVersion =
    SUPERSEDED_RESULTS_CONTRACT_VERSIONS.find(
      (candidate) =>
        presentationBindingFingerprint({
          registryVersion: registry.registryVersion,
          contractVersion: candidate,
          source: registry.source,
          addresses: registry.addresses,
        }) === row.binding_fingerprint,
    ) ?? null;

  if (supersededContractVersion === null) {
    return {
      status: "refused",
      reason: "source_identity_differs",
      detail:
        "El vínculo guardado no se reproduce cambiando únicamente la versión del contrato, así que " +
        "lo que se movió no es el contrato: puede ser el paquete importado, la versión de cálculo, " +
        "el mapeo o las direcciones de los resultados. Actualizar el vínculo archivaría una " +
        "presentación hecha sobre unos números como si se hubiera hecho sobre otros, así que no se " +
        "hace. Este borrador tiene que revisarse a mano.",
    };
  }

  // [2] THE REBIND ITSELF — the whole of it. Two fields, from the registry
  //     built here, on the server, from this request's own canonical read.
  const rebound = bindPresentationDocument(decoded.value, registry);

  // [3] THE AUTHORED CONTENT, COMPARED AS BYTES. Independent of [1].
  const before = authoredProjection(decoded.value);
  const after = authoredProjection(rebound);
  if (before !== after) {
    return {
      status: "refused",
      reason: "authored_content_would_change",
      detail:
        "Actualizar el vínculo cambiaría algo que alguien escribió, y eso no es lo que esta acción " +
        "hace. No se escribe nada.",
    };
  }

  // [4] AND IT HAS TO WORK AFTERWARDS. The exhibition proves the registry did
  //     not move; this proves the document still resolves against the results
  //     the registry was built from — which is what the author will see.
  const resolved = resolveUnderSelection(built, rebound, EMPTY_VIEWER_SELECTION);
  if (!resolved.ok) {
    return {
      status: "refused",
      reason: "does_not_resolve_after_rebind",
      detail:
        "Con el vínculo actualizado el documento todavía no corresponde a los resultados de este " +
        "estudio, así que no se guarda: quedaría un borrador que no se puede abrir.",
      issues: resolved.issues,
    };
  }

  const blocks = decoded.value.pages.reduce((total, page) => total + page.blocks.length, 0);
  const changes: RebindChange[] = [];
  if (decoded.value.binding !== rebound.binding) {
    changes.push({ field: "binding", from: decoded.value.binding ?? "", to: rebound.binding ?? "" });
  }
  if (decoded.value.registryVersion !== rebound.registryVersion) {
    changes.push({
      field: "registryVersion",
      from: decoded.value.registryVersion,
      to: rebound.registryVersion,
    });
  }

  return {
    status: "ready",
    storedRevision: row.revision,
    supersededContractVersion,
    currentContractVersion: registry.contractVersion,
    changes,
    preserved: {
      title: decoded.value.title,
      pages: decoded.value.pages.length,
      blocks,
      samplePolicyMode: decoded.value.samplePolicy.mode,
      methodologyDisclosure: decoded.value.methodologyDisclosure,
      authoredBytes: new TextEncoder().encode(before).length,
      authoredDigest: sha256Hex(before),
    },
  };
}

/** Read the row and assess, for a screen that wants to DESCRIBE the change. */
export async function describePresentationRebind(
  client: SupabaseClient,
  scope: ComposerScope,
): Promise<RebindAssessment> {
  const stored = await readStoredDraftRow(client, scope);
  if (!stored.ok) {
    return { status: "refused", reason: "storage_refused", detail: stored.unavailable.detail };
  }
  if (!stored.row) {
    return {
      status: "refused",
      reason: "no_stored_draft",
      detail: "Este estudio no tiene un borrador canónico guardado, así que no hay vínculo que actualizar.",
    };
  }
  let built;
  try {
    built = await readAndBuild(client, scope);
  } catch (caught) {
    return { status: "refused", reason: "storage_refused", detail: refusalFor(caught).detail };
  }
  return assessPresentationRebind(built, stored.row, scope);
}

/**
 * Perform the rebind — the only function here that writes.
 *
 * IT RE-ASSESSES RATHER THAN TRUSTING WHAT THE SCREEN WAS SHOWN. The plan the
 * operator approved was computed from a read that is now seconds or minutes
 * old; everything is recomputed here, from this request's own canonical read,
 * and the write is refused on exactly the same terms. Nothing the client sent
 * is used as a binding, a digest or an identity — the client sends a study, an
 * expected revision and a retry key, and nothing else.
 *
 * IT GOES THROUGH `save_canonical_presentation_draft`, the same RPC the composer
 * saves through. No new function, no migration, no direct SQL: the expected
 * revision, the advisory lock, the idempotency replay and the append-only event
 * are the ones the product already has, and a second path would be a second set
 * of guarantees to keep true.
 */
export async function rebindStoredPresentation(
  client: SupabaseClient,
  scope: ComposerScope,
  actorUserId: string,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<SaveResult> {
  const stored = await readStoredDraftRow(client, scope);
  if (!stored.ok) {
    return { ok: false, reason: "storage_refused", detail: stored.unavailable.detail };
  }
  if (!stored.row) {
    return {
      ok: false,
      reason: "storage_refused",
      detail: "Este estudio no tiene un borrador canónico guardado, así que no hay vínculo que actualizar.",
    };
  }

  // A REPLAY IS ANSWERED BEFORE A CONFLICT IS, AND THE ORDER IS THE WHOLE POINT.
  //
  // The first draft of this function checked the expected revision first, and
  // that is wrong in the one case idempotency exists for: an operator whose
  // first attempt SUCCEEDED but whose answer never arrived presses the button
  // again with the same key. The row has moved to 2 — moved by their own write —
  // so a revision-first check calls their retry a conflict and tells them
  // somebody else edited the draft. Nobody did.
  //
  // `save_canonical_presentation_draft` gets this right internally: the
  // idempotency short-circuit runs before the expected-revision comparison. The
  // same order is reproduced here rather than inverted, by asking the event log
  // whether this key has already been recorded for this study.
  const { data: replayed } = await client
    .from(DRAFT_EVENT_TABLE)
    .select("revision")
    .eq("study_id", scope.studyId)
    .eq("tenant_id", scope.tenantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle<{ revision: number }>();
  if (replayed) {
    return {
      ok: true,
      revision: replayed.revision,
      currentRevision: stored.row.revision,
      created: false,
      replayed: true,
    };
  }

  // ONLY NOW is a stale revision a conflict. The RPC refuses it too and its
  // refusal is the authoritative one — it holds the advisory lock — but
  // refusing here means an operator looking at a stale screen is told so
  // without a write being attempted, and the two refusals agree by
  // construction because they compare the same two numbers.
  if (stored.row.revision !== expectedRevision) {
    return {
      ok: false,
      reason: "conflict",
      detail:
        "Alguien guardó este borrador después de que se abrió esta pantalla, así que no se " +
        "actualiza el vínculo sobre una revisión que ya no es la última.",
      storedRevision: stored.row.revision,
    };
  }

  let built;
  try {
    built = await readAndBuild(client, scope);
  } catch (caught) {
    return { ok: false, reason: "storage_refused", detail: refusalFor(caught).detail };
  }

  const assessment = assessPresentationRebind(built, stored.row, scope);
  if (assessment.status !== "ready") {
    // `not_needed` is not an error, and it is also not a write. The caller is
    // told the revision that is already current, which is what a second press
    // of the button needs to hear.
    if (assessment.status === "not_needed") {
      return {
        ok: true,
        revision: stored.row.revision,
        currentRevision: stored.row.revision,
        created: false,
        replayed: true,
      };
    }
    return {
      ok: false,
      reason: assessment.reason === "conflict" ? "conflict" : "document_refused",
      detail: assessment.detail,
      issues: assessment.issues,
    };
  }

  const decoded = decodeStoredDraft(stored.row, scope);
  if (!decoded.ok) {
    return {
      ok: false,
      reason: "document_refused",
      detail: "El borrador almacenado dejó de leerse entre la evaluación y la escritura.",
      issues: decoded.errors.map((entry) => ({ code: entry.code, path: entry.path })),
    };
  }
  const rebound = bindPresentationDocument(decoded.value, built.registry);

  // THE SUBTITLE IS CARRIED ACROSS BY HAND, and it has to be.
  //
  // `decodePresentationFromStorage` returns a `PresentationDocument`, and the
  // subtitle does not live in one — it lives in the envelope's `metadata`. So a
  // decode-then-encode round trip drops it, and `encodePresentationForStorage`
  // would stamp `subtitle: null` over an authored line nobody asked to remove.
  // It happens to be null on the only stored draft that exists today, which is
  // exactly why it would have gone unnoticed.
  const definition = stored.row.definition as { metadata?: { subtitle?: unknown } } | null;
  const storedSubtitle =
    definition && typeof definition.metadata === "object" && definition.metadata !== null
      ? definition.metadata.subtitle
      : null;

  const encoded = encodePresentationForStorage(
    rebound,
    { tenantId: scope.tenantId, studyId: scope.studyId },
    { subtitle: typeof storedSubtitle === "string" ? storedSubtitle : null },
  );
  if (!encoded.ok) {
    return {
      ok: false,
      reason: "document_refused",
      detail: "El documento re-vinculado no se puede almacenar en la forma que exige la columna.",
      issues: encoded.errors.map((entry) => ({ code: entry.code, path: entry.path })),
    };
  }

  return saveEncodedPresentation(
    client,
    scope,
    actorUserId,
    encoded.value,
    expectedRevision,
    idempotencyKey,
    `vínculo actualizado ${assessment.supersededContractVersion} → ${assessment.currentContractVersion}`,
  );
}

/* -------------------------------------------------------------------------- */
/* the capability upgrade — adding metadata a stored document predates          */
/* -------------------------------------------------------------------------- */

/**
 * THE CAPABILITY UPGRADE — the second thing an operator may ask the server to
 * recompute about a document they already stored, and the narrowest one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT PROBLEM IT EXISTS FOR.
 *
 * `requiredContent` was added to `PresentationBlock` after documents had already
 * been stored. Its own comment says «Absent or false on every document authored
 * before this existed, so nothing already saved becomes unpublishable by the
 * flag arriving» — which is true, and is exactly the difficulty: the stored
 * Cuicuilco draft predates the field, carries the key zero times, and so its
 * empty journey-pain slot raised the ACKNOWLEDGEABLE warning
 * `configuration_required_blocks` where today's blueprint intends the
 * non-acknowledgeable blocker `required_content_missing`. The product was
 * behaving correctly for that document; the document was simply older than the
 * capability.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS NOT A REGENERATION, AND THE DIFFERENCE IS THE WHOLE SAFETY ARGUMENT.
 *
 * A regeneration would rebuild the document from the blueprint and overwrite
 * what an author composed. This reads the STORED document, adds `requiredContent`
 * to the blocks the CURRENT blueprint marks required — by block id, which the
 * blueprint and the stored document already share — and changes nothing else.
 * Not a title, not a body, not an order, not a span, not a filter, not a sample
 * policy, not a disclosure level, not the binding, not the registry version.
 *
 * And it PROVES that rather than promising it. `capabilityStrippedProjection`
 * serializes a document with every block's `requiredContent` removed; the
 * assessment refuses unless that projection is BYTE-IDENTICAL before and after.
 * A change anywhere else in the document moves those bytes and is refused. The
 * same function is what makes the upgrade reversible: deleting the keys this
 * function added reproduces the stored definition exactly, and the assessment
 * checks that too before it lets anything be written.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CAPABILITY COMES FROM THE SERVER, NEVER FROM A CALLER.
 *
 * There is no parameter anywhere on this path by which a browser could say
 * which blocks are required, or assert a digest, or supply a document. The
 * action takes a study id, an expected revision and a retry key — three
 * scalars — exactly as the rebind does, and for the same reason. The required
 * set is read from `chooseBlueprint`, the same selection the composer uses,
 * built from the registry this request just read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT NEVER RUNS BY ITSELF.
 *
 * No read path calls it, no page load calls it, and `describeCapabilityUpgrade`
 * — which the Construcción page does call — reads and computes and writes
 * nothing. The upgrade happens when a person presses the button, so it can be
 * refused, reviewed, and found afterwards in the event log.
 */

/** One field this upgrade would add, named by the block it belongs to. */
export type CapabilityChange = {
  /** The JSON path in the stored definition. */
  path: string;
  /** The block's own id, which the blueprint and the document share. */
  blockId: string;
  /** The block's authored title, so an operator reads a name and not an id. */
  blockTitle: string;
  field: "requiredContent";
  /** What the stored document has there now. */
  from: "(ausente)" | "false";
  to: "true";
};

export type CapabilityRefusalReason =
  | "document_refused"
  | "would_change_more_than_capability"
  | "not_reversible"
  | "does_not_resolve_after_upgrade"
  | "binding_would_change";

export type CapabilityUpgradePlan = {
  status: "ready";
  storedRevision: number;
  /** The blueprint the capability was derived from. */
  blueprintId: string;
  blueprintLabel: string;
  changes: CapabilityChange[];
  preserved: {
    title: string;
    pages: number;
    blocks: number;
    samplePolicyMode: string;
    methodologyDisclosure: string;
    /** Bytes and digest of the document with capability metadata removed. */
    strippedBytes: number;
    strippedDigest: string;
    binding: string;
    registryVersion: string;
  };
};

export type CapabilityUpgradeUnavailable = {
  status: "not_needed" | "refused";
  reason: "already_current" | "blueprint_requires_nothing" | CapabilityRefusalReason;
  detail: string;
  issues?: { code: string; path: string }[];
};

export type CapabilityUpgradeAssessment = CapabilityUpgradePlan | CapabilityUpgradeUnavailable;

/**
 * The document with every block's `requiredContent` removed, serialized.
 *
 * THE INVARIANT OF THIS WHOLE FEATURE. It must be byte-identical before and
 * after, which is a stronger statement than any list of fields somebody
 * remembered to compare: anything this upgrade touched other than capability
 * metadata moves these bytes.
 */
function capabilityStrippedProjection(document: PresentationDocument): string {
  const copy = JSON.parse(serializeDeterministic(document)) as {
    pages: { blocks: Record<string, unknown>[] }[];
  };
  for (const page of copy.pages) {
    for (const block of page.blocks) delete block.requiredContent;
  }
  return serializeDeterministic(copy);
}

/** Every block id the CURRENT blueprint marks as carrying required content. */
function blueprintRequiredBlockIds(
  registry: CanonicalPresentationRegistry,
  studyName: string,
): { ids: Set<string>; choice: BlueprintChoice } {
  const chosen = chooseBlueprint(registry, studyName);
  const ids = new Set<string>();
  for (const page of chosen.document.pages) {
    for (const block of page.blocks) {
      if (block.requiredContent === true) ids.add(block.id);
    }
  }
  return { ids, choice: chosen.choice };
}

/**
 * Decide what a capability upgrade would do to THIS stored row.
 *
 * Pure over its inputs — it reads nothing and writes nothing — so the page can
 * call it to describe the change and the action can call it again to perform
 * one, and the two cannot disagree about what was approved.
 */
export function assessCapabilityUpgrade(
  built: CanonicalPresentationRead,
  row: DraftRow,
  scope: ComposerScope,
): CapabilityUpgradeAssessment {
  const decoded = decodeStoredDraft(row, scope);
  if (!decoded.ok) {
    return {
      status: "refused",
      reason: "document_refused",
      detail:
        "El borrador almacenado no se puede leer como documento canónico, así que no se le añade nada.",
      issues: decoded.errors.map((entry) => ({ code: entry.code, path: entry.path })),
    };
  }

  const { ids: required, choice } = blueprintRequiredBlockIds(built.registry, scope.studyName);
  if (required.size === 0) {
    return {
      status: "not_needed",
      reason: "blueprint_requires_nothing",
      detail:
        "El plano vigente para este estudio no marca ningún bloque como contenido obligatorio, " +
        "así que no hay capacidad que añadir. No se escribe nada.",
    };
  }

  // THE UPGRADE ITSELF — the whole of it. One optional boolean, on blocks the
  // blueprint named, added only where it is absent or false.
  const upgraded = JSON.parse(serializeDeterministic(decoded.value)) as PresentationDocument;
  const changes: CapabilityChange[] = [];
  upgraded.pages.forEach((page, pageIndex) => {
    page.blocks.forEach((block, blockIndex) => {
      if (!required.has(block.id)) return;
      if (block.requiredContent === true) return;
      changes.push({
        path: `$.pages[${pageIndex}].blocks[${blockIndex}].requiredContent`,
        blockId: block.id,
        // A BLOCK MAY LEGITIMATELY HAVE NO AUTHORED TITLE, and an operator
        // reading a raw id would be reading something internal. Saying so is
        // better than either.
        blockTitle: block.copy.title ?? "(bloque sin título)",
        field: "requiredContent",
        from: block.requiredContent === false ? "false" : "(ausente)",
        to: "true",
      });
      block.requiredContent = true;
    });
  });

  if (changes.length === 0) {
    return {
      status: "not_needed",
      reason: "already_current",
      detail:
        "Este borrador ya declara la capacidad que el plano vigente exige. No hay nada que añadir " +
        "y no se escribe nada.",
    };
  }

  // [1] NOTHING BUT CAPABILITY METADATA MOVED. Bytes, not a field list.
  const strippedBefore = capabilityStrippedProjection(decoded.value);
  const strippedAfter = capabilityStrippedProjection(upgraded);
  if (strippedBefore !== strippedAfter) {
    return {
      status: "refused",
      reason: "would_change_more_than_capability",
      detail:
        "Añadir la capacidad cambiaría algo más que la capacidad, y esta acción sólo hace eso. " +
        "No se escribe nada.",
    };
  }

  // [2] AND IT IS REVERSIBLE. Deleting exactly the keys added above has to
  //     reproduce the stored document byte for byte. This is what makes «only
  //     metadata was added» a fact about the write rather than about the plan.
  const reverted = JSON.parse(serializeDeterministic(upgraded)) as {
    pages: { blocks: Record<string, unknown>[] }[];
  };
  for (const change of changes) {
    const [, pageIndex, blockIndex] = change.path.match(/\$\.pages\[(\d+)\]\.blocks\[(\d+)\]/)!;
    const block = reverted.pages[Number(pageIndex)].blocks[Number(blockIndex)];
    if (change.from === "false") block.requiredContent = false;
    else delete block.requiredContent;
  }
  if (serializeDeterministic(reverted) !== serializeDeterministic(decoded.value)) {
    return {
      status: "refused",
      reason: "not_reversible",
      detail:
        "Quitar lo que esta acción añadiría no reproduce el documento guardado, así que la " +
        "operación no es la que dice ser. No se escribe nada.",
    };
  }

  // [3] THE BINDING DOES NOT MOVE. This is not a rebind and must not become one.
  if (upgraded.binding !== decoded.value.binding || upgraded.registryVersion !== decoded.value.registryVersion) {
    return {
      status: "refused",
      reason: "binding_would_change",
      detail: "Esta acción no vuelve a vincular el documento, y algo movió el vínculo. No se escribe nada.",
    };
  }

  // [4] AND IT HAS TO WORK AFTERWARDS.
  const resolved = resolveUnderSelection(built, upgraded, EMPTY_VIEWER_SELECTION);
  if (!resolved.ok) {
    return {
      status: "refused",
      reason: "does_not_resolve_after_upgrade",
      detail:
        "Con la capacidad añadida el documento ya no corresponde a los resultados de este estudio, " +
        "así que no se guarda.",
      issues: resolved.issues,
    };
  }

  const blocks = decoded.value.pages.reduce((total, page) => total + page.blocks.length, 0);
  return {
    status: "ready",
    storedRevision: row.revision,
    blueprintId: choice.id,
    blueprintLabel: choice.label,
    changes,
    preserved: {
      title: decoded.value.title,
      pages: decoded.value.pages.length,
      blocks,
      samplePolicyMode: decoded.value.samplePolicy.mode,
      methodologyDisclosure: decoded.value.methodologyDisclosure,
      strippedBytes: new TextEncoder().encode(strippedBefore).length,
      strippedDigest: sha256Hex(strippedBefore),
      binding: decoded.value.binding ?? "",
      registryVersion: decoded.value.registryVersion,
    },
  };
}

/** Read the row and assess, for a screen that wants to DESCRIBE the change. */
export async function describeCapabilityUpgrade(
  client: SupabaseClient,
  scope: ComposerScope,
): Promise<CapabilityUpgradeAssessment> {
  const stored = await readStoredDraftRow(client, scope);
  if (!stored.ok) {
    return { status: "refused", reason: "document_refused", detail: stored.unavailable.detail };
  }
  if (!stored.row) {
    return {
      status: "not_needed",
      reason: "already_current",
      detail: "Este estudio no tiene un borrador canónico guardado, así que no hay nada que actualizar.",
    };
  }
  let built;
  try {
    built = await readAndBuild(client, scope);
  } catch (caught) {
    return { status: "refused", reason: "document_refused", detail: refusalFor(caught).detail };
  }
  return assessCapabilityUpgrade(built, stored.row, scope);
}

/**
 * Add the missing capability metadata and store the result as a new revision.
 *
 * The same shape as `rebindStoredPresentation`, deliberately: replay first,
 * then the expected revision, then a fresh read, then the assessment, then one
 * write through the draft's own save function. See that function's comments for
 * why the order of the first two is what it is.
 */
export async function upgradeStoredPresentationCapabilities(
  client: SupabaseClient,
  scope: ComposerScope,
  actorUserId: string,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<SaveResult> {
  const stored = await readStoredDraftRow(client, scope);
  if (!stored.ok) {
    return { ok: false, reason: "storage_refused", detail: stored.unavailable.detail };
  }
  if (!stored.row) {
    return {
      ok: false,
      reason: "storage_refused",
      detail: "Este estudio no tiene un borrador canónico guardado, así que no hay nada que actualizar.",
    };
  }

  // A REPLAY IS ANSWERED BEFORE A CONFLICT IS. Same reasoning as the rebind's.
  const { data: replayed } = await client
    .from(DRAFT_EVENT_TABLE)
    .select("revision")
    .eq("study_id", scope.studyId)
    .eq("tenant_id", scope.tenantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle<{ revision: number }>();
  if (replayed) {
    return {
      ok: true,
      revision: replayed.revision,
      currentRevision: stored.row.revision,
      created: false,
      replayed: true,
    };
  }

  if (stored.row.revision !== expectedRevision) {
    return {
      ok: false,
      reason: "conflict",
      detail:
        "Alguien guardó este borrador después de que se abrió esta pantalla, así que no se le " +
        "añade nada sobre una revisión que ya no es la última.",
      storedRevision: stored.row.revision,
    };
  }

  let built;
  try {
    built = await readAndBuild(client, scope);
  } catch (caught) {
    return { ok: false, reason: "storage_refused", detail: refusalFor(caught).detail };
  }

  const assessment = assessCapabilityUpgrade(built, stored.row, scope);
  if (assessment.status !== "ready") {
    if (assessment.status === "not_needed") {
      return {
        ok: true,
        revision: stored.row.revision,
        currentRevision: stored.row.revision,
        created: false,
        replayed: true,
      };
    }
    return {
      ok: false,
      reason: "document_refused",
      detail: assessment.detail,
      issues: assessment.issues,
    };
  }

  const decoded = decodeStoredDraft(stored.row, scope);
  if (!decoded.ok) {
    return {
      ok: false,
      reason: "document_refused",
      detail: "El borrador almacenado dejó de leerse entre la evaluación y la escritura.",
      issues: decoded.errors.map((entry) => ({ code: entry.code, path: entry.path })),
    };
  }

  // THE SAME MUTATION THE ASSESSMENT MADE, from the same required set. It is
  // recomputed here rather than carried across, so nothing between the two is a
  // value this function was handed.
  const { ids: required } = blueprintRequiredBlockIds(built.registry, scope.studyName);
  const upgraded = JSON.parse(serializeDeterministic(decoded.value)) as PresentationDocument;
  for (const page of upgraded.pages) {
    for (const block of page.blocks) {
      if (required.has(block.id) && block.requiredContent !== true) block.requiredContent = true;
    }
  }

  // THE SUBTITLE IS CARRIED ACROSS BY HAND, for the reason the rebind states:
  // it lives in the envelope's metadata, not in the document, so a
  // decode-then-encode round trip drops it.
  const definition = stored.row.definition as { metadata?: { subtitle?: unknown } } | null;
  const storedSubtitle =
    definition && typeof definition.metadata === "object" && definition.metadata !== null
      ? definition.metadata.subtitle
      : null;

  const encoded = encodePresentationForStorage(
    upgraded,
    { tenantId: scope.tenantId, studyId: scope.studyId },
    { subtitle: typeof storedSubtitle === "string" ? storedSubtitle : null },
  );
  if (!encoded.ok) {
    return {
      ok: false,
      reason: "document_refused",
      detail: "El documento con la capacidad añadida no se puede almacenar en la forma que exige la columna.",
      issues: encoded.errors.map((entry) => ({ code: entry.code, path: entry.path })),
    };
  }

  return saveEncodedPresentation(
    client,
    scope,
    actorUserId,
    encoded.value,
    expectedRevision,
    idempotencyKey,
    `capacidad declarada: requiredContent en ${assessment.changes.length} bloque(s)`,
  );
}
