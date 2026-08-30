import { notFound } from "next/navigation";
import { z } from "zod";

import { logout } from "@/app/dashboard/actions";
import { StudioShell } from "@/components/shell/StudioShell";
import { studyParent } from "@/components/shell/BackLink";
import { DraftPreview } from "@/components/studio/experience/DraftPreview";
import { loadBuilderWorkspace } from "@/lib/experience/builder-workspace";
import { resolveExperience } from "@/lib/experience/resolve";
import { parseViewerSelection } from "@/lib/experience/viewer-params";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { studioStudyComposer, studioStudyPreview } from "@/lib/studio/routes";

import { previewDraftData } from "./actions";

export const metadata = { title: "Vista previa del borrador · Be Community" };

type Params = Promise<{ studyId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * "Vista previa del borrador" — what the composed work looks like right now,
 * with the study's real aggregates, for internal users only.
 *
 * WHY IT IS NOT `vista-cliente`. That route shows what the client is being
 * served TODAY, and it deliberately does not read a composed draft. That is
 * correct — it is the honest picture of the published experience — and it is
 * also why it could not answer the question the person composing actually has,
 * which is "what does my work look like". One button labelled "Vista del
 * cliente" for both questions implied the client's dashboard should already
 * contain the draft. Now there are two, and each says which one it is.
 *
 * IT PUBLISHES NOTHING AND WRITES NOTHING. It reads the saved draft, resolves
 * aggregates, and renders. `/insights/e/[studyId]` and
 * `/studio/e/[studyId]/vista-cliente` are untouched and are not imported here.
 *
 * AUTHORIZATION FIRST, as on every Studio surface: `requireInternal()` runs
 * before anything is read, and the Server Action that recomputes on a filter
 * change re-authorizes from scratch on its own.
 */
export default async function StudioDraftPreviewPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { user, admin } = await requireInternal();
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();

  const studio = await loadStudioStudy(admin, studyId);
  if (!studio) notFound();

  const workspace = await loadBuilderWorkspace(admin, studio);
  const definition = workspace.definition;

  // The reader's choices, read from the URL through the same bounded parser
  // the preview writes them with, and kept only where this document and this
  // study can account for them.
  const selection = parseViewerSelection(await searchParams, definition, workspace.registry);
  /*
   * ONE SEQUENCE, THROUGH THE ONE FUNCTION THAT KNOWS IT.
   *
   * The registry has to be widened with whatever the document derives, the
   * index has to match, and the derived columns have to be on the rows BEFORE
   * anything is aggregated over them. A surface that did two of those three
   * would narrow to nothing when a reader chose "Rojo" — a wrong answer
   * wearing an honest empty state.
   */
  const data =
    Object.keys(selection).length === 0
      ? workspace.data
      : resolveExperience({
          rows: workspace.rows,
          registry: workspace.registry,
          index: workspace.keyIndex,
          definition,
          selection,
          confirmed: workspace.confirmed,
        }).data;

  const savedAt = workspace.draft
    ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(workspace.draft.updatedAt),
      )
    : null;

  return (
    <StudioShell
      userEmail={user.email ?? ""}
      currentHref="/studio/estudios"
      back={studyParent(studyId, studio.study.name)}
      breadcrumb={[
        "Studio",
        "Estudios",
        studio.study.clientName,
        studio.study.name,
        "Vista previa",
      ]}
      title="Vista previa del borrador"
      lead="Así se vería la experiencia que estás armando, con los números reales del estudio. Es una vista interna: el cliente no ve nada de esto."
      utility={
        <form action={logout}>
          <button
            type="submit"
            className="min-h-11 rounded-lg border border-paper/40 px-3 py-1.5 text-sm font-medium text-paper transition-colors duration-[var(--motion-state)] hover:bg-paper/10"
          >
            Cerrar sesión
          </button>
        </form>
      }
    >
      <DraftPreview
        studyId={studio.study.id}
        definition={definition}
        registry={workspace.registry}
        evidence={workspace.evidence}
        study={{
          name: studio.study.name,
          clientName: studio.study.clientName,
          period: studio.study.period,
        }}
        initialData={data}
        initialSelection={selection}
        builderHref={studioStudyComposer(studyId)}
        publishedHref={studioStudyPreview(studyId)}
        savedAt={savedAt}
        hasDraft={workspace.draft !== null}
        refresh={previewDraftData}
      />
    </StudioShell>
  );
}
