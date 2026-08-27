import { notFound } from "next/navigation";
import { z } from "zod";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { StudyWorkSurface } from "@/components/studio/StudyWorkSurface";
import { QualitativeWorkspaceView } from "@/components/studio/QualitativeWorkspaceView";
import {
  loadQualitativeWorkspace,
  parseReviewState,
} from "@/lib/studio/qualitative-workspace";
import { parsePageRequest } from "@/lib/studio/paging";
import { studioStudyQualitative } from "@/lib/studio/routes";

export const metadata = { title: "Lo que dijeron las personas · Be Community" };

type Params = Promise<{ studyId: string }>;
type Search = Promise<{ ok?: string; error?: string; estado?: string; p?: string; por?: string }>;

/**
 * Reviewing what people said, inside the study it belongs to.
 *
 * Identical to `/admin/qualitative` in everything a reviewer touches — same
 * component, same Server Action, same field names — and different in exactly
 * one way: the study is the one whose page this is, so the first act of the
 * screen is no longer a `<select>` and an "Abrir" button.
 */
export default async function StudioStudyQualitativePage({
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
  const state = parseReviewState(query.estado);
  const qualitative = await loadQualitativeWorkspace(admin, studyId, {
    state,
    page: parsePageRequest(query),
  });

  return (
    <StudyWorkSurface
      workspace={workspace}
      current="cualitativo"
      userEmail={user.email ?? ""}
      title="Lo que dijeron las personas"
      lead="Las sugerencias son propuestas. Nada se publica sin que una persona lo confirme, y cada cita se aprueba por separado."
      ok={query.ok}
      error={query.error}
    >
      <QualitativeWorkspaceView
        studyId={studyId}
        workspace={qualitative}
        stages={workspace.study.stages.map((stage) => ({ id: stage.id, label: stage.label }))}
        basePath={studioStudyQualitative(studyId)}
        filterParams={{ estado: state, por: query.por ?? null }}
        returnTo={studioStudyQualitative(studyId)}
      />
    </StudyWorkSurface>
  );
}
