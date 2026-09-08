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
 * The registry never leaves this module. `projectPresentationCatalog` is a drop
 * that removes `source` and `addresses`, and `resolvePresentation` returns a
 * model whose types have nowhere to put either.
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
 * AND IT WRITES NOTHING.
 *
 * There is no insert, update, upsert, delete, RPC or `revalidatePath` in this
 * file, and Unit 6B.1 has no storage path at all. The existing Cuicuilco legacy
 * v2 draft is never read, migrated, reinterpreted or overwritten — this module
 * does not know the table it lives in.
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
  PreviewResult,
} from "@/lib/composer";
import {
  EMPTY_VIEWER_SELECTION,
  PresentationError,
  type PresentationDocument,
  type PresentationIssue,
} from "@/lib/presentation";
import {
  bindPresentationDocument,
  buildApprovedCuicuilcoBlueprint,
  buildGenericStartingBlueprint,
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

export type { ComposerPayload, ComposerUnavailable, ComposerWorkspace, PreviewResult };

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
async function readAndBuild(
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

function refusalFor(error: unknown): ComposerUnavailable {
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
): Promise<ComposerWorkspace> {
  let built;
  try {
    built = await readAndBuild(client, scope);
  } catch (error) {
    return { ok: false, unavailable: refusalFor(error) };
  }
  const { registry } = built;

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
