import { notFound } from "next/navigation";
import { z } from "zod";

import { presentationErrorLabel } from "@/lib/presentation";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { loadPresentationComposerWorkspace } from "@/lib/studio/presentation-workspace";
import { StudyWorkSurface } from "@/components/studio/StudyWorkSurface";
import { ComposerWorkspace } from "@/components/studio/composer/ComposerWorkspace";
import {
  loadCanonicalPresentationDraft,
  refreshPresentationPreview,
  saveCanonicalPresentationDraft,
} from "./actions";

export const metadata = { title: "Construcción · Be Community" };

type Params = Promise<{ studyId: string }>;
type Search = Promise<{ ok?: string; error?: string }>;

/**
 * THE CANONICAL COMPOSER — the second, and last, page that reaches the
 * canonical layer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER OF THE FIRST FOUR LINES IS THE WHOLE SECURITY ARGUMENT.
 *
 * `requireInternal()` is the FIRST await, before `params` is even unwrapped and
 * long before anything is read. Then the id is validated as a UUID, then the
 * Studio study is loaded through the one authorized path, and only then — with
 * a study row in hand and its tenant read from the database rather than from
 * the request — is the canonical workspace built. Two offline gates assert that
 * order on this file by position in the source.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT REACHES THE BROWSER.
 *
 * `workspace.payload` and nothing else: a bound document, the safe catalogue, a
 * resolved render model, and four strings of chrome. The registry, the address
 * map, the `RegistrySource`, the canonical results and the admin client all
 * stay in this function's scope and are never passed down.
 *
 * The refresh action is handed DOWN as a prop rather than imported by the
 * client component. That is not a style choice: a `"use client"` module with a
 * static import of the action would have a path to the server-only canonical
 * read path in the import graph, and the shadow-boundary gate refuses one.
 *
 * (That read path is deliberately not named here. `canonical-database-source`
 * forbids the string itself anywhere under `src/app` or `src/components`, on
 * the reasoning that a blunt textual rule cannot be evaded by writing an import
 * strangely — and a comment is not worth weakening it for.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS WRITTEN, AND WHAT STILL IS NOT.
 *
 * This paragraph used to read "AND NOTHING IS WRITTEN, HERE OR ANYWHERE BELOW",
 * which was true of Unit 6B.1 and is not true now. Unit 6B.3A hands the screen
 * two more actions: one saves the composed document into
 * `canonical_presentation_draft`, and one loads it back. Nothing else is
 * written — no revision, no publication, no `revalidatePath` — and this page
 * function itself still only reads.
 *
 * THE LEGACY DRAFT IS STILL NOT TOUCHED. `study_experience_draft` holds this
 * study's legacy v2 definition at revision 72, and the canonical path writes a
 * DIFFERENT table. It is not read, not migrated, not reinterpreted and not
 * overwritten, and nothing on this page or below it names the table it lives
 * in.
 */
export default async function StudioStudyConstructionPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { user, admin } = await requireInternal();
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();
  const workspace = await loadStudioStudy(admin, studyId);
  if (!workspace) notFound();
  const query = await searchParams;
  const { study } = workspace;

  // RESTORE BEFORE BLUEPRINT — Unit 6B.3A.
  //
  // When this study has a stored canonical draft, THAT is what the composer
  // opens with. Opening the blueprint instead would show a fresh layout under
  // the same heading as an hour of somebody's saved work, and the first
  // autosave would write it over the top.
  const composer = await loadPresentationComposerWorkspace(
    admin,
    { tenantId: study.tenantId, studyId: study.id, studyName: study.name },
    { restoreStoredDraft: true },
  );

  return (
    <StudyWorkSurface
      workspace={workspace}
      current="construccion"
      userEmail={user.email ?? ""}
      title="Construcción"
      lead="Compón la presentación de este estudio sobre sus resultados canónicos. El borrador se guarda; el cliente todavía no ve nada."
      ok={query.ok}
      error={query.error}
    >
      {composer.ok ? (
        <ComposerWorkspace
          payload={composer.payload}
          studyId={study.id}
          refresh={refreshPresentationPreview}
          persistence={composer.persistence}
          save={saveCanonicalPresentationDraft}
          load={loadCanonicalPresentationDraft}
        />
      ) : (
        <section className="rounded-xl border border-caution-line bg-caution-surface p-5">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-caution">
            Sólo interno · no lo ve el cliente
          </p>
          <h2 className="mt-1 font-display text-base font-semibold text-caution">
            Todavía no se puede componer este estudio
          </h2>
          <p className="mt-1.5 max-w-prose text-sm text-caution">{composer.unavailable.detail}</p>
          {composer.unavailable.issues && composer.unavailable.issues.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-caution">
              {composer.unavailable.issues.map((issue, index) => (
                <li key={index}>
                  {presentationErrorLabel(issue.code)}{" "}
                  <span className="text-xs text-muted">
                    (<code>{issue.code}</code> en <code>{issue.path}</code>)
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-caution">
            No se dibuja una aproximación con el cálculo heredado: un número correcto por accidente es peor
            que ninguno.
          </p>
        </section>
      )}
    </StudyWorkSurface>
  );
}
