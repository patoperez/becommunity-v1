import { notFound } from "next/navigation";
import { z } from "zod";

import { logout } from "@/app/dashboard/actions";
import { StudioShell } from "@/components/shell/StudioShell";
import { studyParent } from "@/components/shell/BackLink";
import { ExperienceComposer } from "@/components/studio/ExperienceComposer";
import { adaptLegacyStudy } from "@/lib/experience/adapter";
import { loadLegacyStudySnapshot } from "@/lib/experience/study-snapshot";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";

export const metadata = { title: "Construcción del dashboard · Be Community" };

type Params = Promise<{ studyId: string }>;

/**
 * "Construcción del dashboard — prototipo interno".
 *
 * An EXPERIMENTAL, INTERNAL-ONLY surface. It reads one real study, puts it
 * through the compatibility adapter, and lets a member of the team rearrange
 * the result to find out whether the composer's model is the right one. It
 * saves nothing, publishes nothing and changes nothing about the study.
 *
 * AUTHORIZATION IS THE SAME GATE AS EVERY OTHER STUDIO SURFACE. `requireInternal()`
 * runs first, before a single read: it revalidates the session with `getUser()`,
 * reads the role from the database, redirects a client-role caller to
 * `/dashboard`, and only then creates the privileged client. Nothing on this
 * page is reachable without an internal role, and nothing on it is reachable
 * from any client-facing route.
 *
 * IT DOES NOT TOUCH WHAT THE CLIENT SEES. `/studio/e/[studyId]/vista-cliente`
 * and `/insights/e/[studyId]` are unchanged and are not imported here. The
 * study's `dashboard_config` and `journey_definition` are read and never
 * written.
 */
export default async function StudioStudyComposerPage({ params }: { params: Params }) {
  const { user, admin } = await requireInternal();
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();

  const workspace = await loadStudioStudy(admin, studyId);
  if (!workspace) notFound();

  const snapshot = await loadLegacyStudySnapshot(admin, workspace);
  const { definition, registry, warnings } = adaptLegacyStudy(snapshot);
  const back = studyParent(studyId, workspace.study.name);

  return (
    <StudioShell
      userEmail={user.email ?? ""}
      currentHref="/studio/estudios"
      back={back}
      breadcrumb={[
        "Studio",
        "Estudios",
        workspace.study.clientName,
        workspace.study.name,
        "Construcción",
      ]}
      title="Construcción del dashboard — prototipo interno"
      lead="Así se vería este estudio armado con el modelo nuevo de páginas y bloques. Sirve para decidir la forma de trabajar; todavía no guarda ni publica nada."
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
      <ExperienceComposer
        original={definition}
        registry={registry}
        adapterWarnings={warnings.map((warning) => ({
          code: warning.code,
          detail: warning.detail,
        }))}
      />
    </StudioShell>
  );
}
