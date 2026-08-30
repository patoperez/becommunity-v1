import { notFound } from "next/navigation";
import { z } from "zod";

import { logout } from "@/app/dashboard/actions";
import { StudioShell } from "@/components/shell/StudioShell";
import { studyParent } from "@/components/shell/BackLink";
import { ExperienceBuilder } from "@/components/studio/experience/ExperienceBuilder";
import {
  builderClientPayload,
  loadBuilderWorkspace,
} from "@/lib/experience/builder-workspace";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { studioStudy, studioStudyDraftPreview, studioStudyPreview } from "@/lib/studio/routes";

import { refreshExperienceData, saveExperienceDraftAction } from "./actions";

export const metadata = { title: "Construcción del dashboard · Be Community" };

type Params = Promise<{ studyId: string }>;

/**
 * "Construcción del dashboard" — the internal builder.
 *
 * AUTHORIZATION IS THE SAME GATE AS EVERY OTHER STUDIO SURFACE, and it runs
 * FIRST. `requireInternal()` revalidates the session with `getUser()`, reads
 * the role from the database, redirects a client-role caller to `/dashboard`,
 * and only then creates the privileged client. Nothing on this page is
 * reachable without an internal role, and nothing on it is reachable from any
 * client-facing route.
 *
 * IT SAVES A DRAFT, AND IT PUBLISHES NOTHING. The study's `dashboard_config`,
 * `journey_definition` and publication state are read and never written; a
 * draft lives in its own table (migration 0023) and no client-facing surface
 * reads it. `/studio/e/[studyId]/vista-cliente` and `/insights/e/[studyId]`
 * are unchanged and are not imported here.
 *
 * WHAT CROSSES TO THE BROWSER is `builderClientPayload` and nothing else — a
 * named projection, so adding a field to the workspace cannot accidentally ship
 * the study's rows or the handle-to-key index to a client component.
 */
export default async function StudioStudyBuilderPage({ params }: { params: Params }) {
  const { user, admin } = await requireInternal();
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();

  const studio = await loadStudioStudy(admin, studyId);
  if (!studio) notFound();

  const workspace = await loadBuilderWorkspace(admin, studio);
  const back = studyParent(studyId, studio.study.name);

  return (
    <StudioShell
      userEmail={user.email ?? ""}
      currentHref="/studio/estudios"
      back={back}
      breadcrumb={[
        "Studio",
        "Estudios",
        studio.study.clientName,
        studio.study.name,
        "Construcción",
      ]}
      title="Construcción del dashboard"
      lead="Arma el estudio con páginas y bloques, con sus números reales. El borrador se guarda solo; el cliente no ve nada de esto hasta que exista la publicación."
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
      <ExperienceBuilder
        payload={builderClientPayload(workspace)}
        exitHref={studioStudy(studyId)}
        previewHref={studioStudyPreview(studyId)}
        draftPreviewHref={studioStudyDraftPreview(studyId)}
        saveDraft={saveExperienceDraftAction}
        refreshData={refreshExperienceData}
      />
    </StudioShell>
  );
}
