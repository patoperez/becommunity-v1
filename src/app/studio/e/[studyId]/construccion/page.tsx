import { notFound } from "next/navigation";
import { z } from "zod";

import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { loadPresentationComposerWorkspace } from "@/lib/studio/presentation-workspace";
import { StudyWorkSurface } from "@/components/studio/StudyWorkSurface";
import { ComposerWorkspace } from "@/components/studio/composer/ComposerWorkspace";
import { refreshPresentationPreview } from "./actions";

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
 * AND NOTHING IS WRITTEN, HERE OR ANYWHERE BELOW.
 *
 * No insert, update, RPC, draft, revision, publication or `revalidatePath`. The
 * legacy v2 draft this study already has is not read, not migrated, not
 * reinterpreted and not overwritten — nothing on this page knows the table it
 * lives in.
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

  const composer = await loadPresentationComposerWorkspace(admin, {
    tenantId: study.tenantId,
    studyId: study.id,
    studyName: study.name,
  });

  return (
    <StudyWorkSurface
      workspace={workspace}
      current="construccion"
      userEmail={user.email ?? ""}
      title="Construcción"
      lead="Compón la presentación de este estudio sobre sus resultados canónicos. En esta fase nada se guarda."
      ok={query.ok}
      error={query.error}
    >
      {composer.ok ? (
        <ComposerWorkspace payload={composer.payload} studyId={study.id} refresh={refreshPresentationPreview} />
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
                  <code className="text-xs">{issue.code}</code> en <code className="text-xs">{issue.path}</code>
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
