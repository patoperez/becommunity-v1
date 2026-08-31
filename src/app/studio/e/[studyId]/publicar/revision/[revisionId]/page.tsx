import { notFound } from "next/navigation";
import { z } from "zod";

import { logout } from "@/app/dashboard/actions";
import { StudioShell } from "@/components/shell/StudioShell";
import { studyParent } from "@/components/shell/BackLink";
import { RevisionPreview } from "@/components/studio/publication/RevisionPreview";
import { loadBuilderRegistry } from "@/lib/experience/builder-workspace";
import { clientEvidence } from "@/lib/experience/client-experience";
import {
  activeExperience,
  loadRevision,
  revisionIsReadable,
  revisionState,
} from "@/lib/experience/publication";
import { registryWithDerivedBands } from "@/lib/experience/band-filters";
import { resolveExperience } from "@/lib/experience/resolve";
import { parseViewerSelection } from "@/lib/experience/viewer-params";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import {
  studioStudyDraftPreview,
  studioStudyPublish,
  studioStudyRevisionPreview,
} from "@/lib/studio/routes";

import { previewRevisionData } from "../../preview-actions";

export const metadata = { title: "Revisión · Be Community" };

type Params = Promise<{ studyId: string; revisionId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * ONE IMMUTABLE REVISION, rendered through the CLIENT'S OWN COMPONENT.
 *
 * `requireInternal()` runs before anything is read, and the Server Action that
 * recomputes on a filter change re-authorizes from scratch on its own.
 *
 * IT READS THE REVISION, NOT THE DRAFT. `loadRevision` is scoped by study and
 * by id, so a revision identifier belonging to another client resolves to
 * nothing here rather than to that client's arrangement.
 *
 * IT WRITES NOTHING AND PUBLISHES NOTHING. Looking at a revision is looking.
 */
export default async function RevisionPreviewPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { user, admin } = await requireInternal();
  const { studyId, revisionId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();
  if (!z.string().uuid().safeParse(revisionId).success) notFound();

  const studio = await loadStudioStudy(admin, studyId);
  if (!studio) notFound();

  const revision = await loadRevision(admin, studyId, revisionId);
  if (!revision) notFound();

  const context = await loadBuilderRegistry(admin, studio);

  if (!revisionIsReadable(revision)) {
    return (
      <StudioShell
        userEmail={user.email ?? ""}
        currentHref="/studio/estudios"
        back={studyParent(studyId, studio.study.name)}
        breadcrumb={["Studio", "Estudios", studio.study.clientName, studio.study.name, "Revisión"]}
        title={`Revisión ${revision.revision}`}
        lead="Esta revisión no se puede mostrar con esta versión del producto."
        utility={<LogoutButton />}
      >
        <p className="rounded-xl border border-danger-line bg-danger-surface p-5 text-sm text-danger">
          {revision.reason}
        </p>
      </StudioShell>
    );
  }

  const active = await activeExperience(admin, studyId);
  const activeRevisionId = active.ok ? (active.active?.revisionId ?? null) : null;

  const definition = revision.definition;
  const selection = parseViewerSelection(
    await searchParams,
    definition,
    registryWithDerivedBands(definition, context.registry),
  );
  const resolved = resolveExperience({
    rows: context.rows,
    registry: context.registry,
    index: context.keyIndex,
    definition,
    selection,
    confirmed: context.confirmed,
  });

  const described = clientEvidence(
    {
      study: {
        id: studio.study.id,
        tenantId: studio.study.tenantId,
        name: studio.study.name,
        period: studio.study.period,
        status: studio.study.status,
      },
      clientName: studio.study.clientName,
      rows: context.rows,
      qualitative: context.confirmed,
      // The internal preview never offers the download; see `RevisionPreview`.
      reportAvailable: false,
    },
    resolved.registry,
  );

  /*
   * WHICH LIFECYCLE STATE THIS REVISION IS IN, DERIVED RATHER THAN STORED.
   *
   * `published` when the study's pointer names it; `superseded` when an event
   * records that something replaced it; `prepared` when it has never been
   * served. Derived because a stored status on an immutable row would have to
   * be updated, and the one time it would be wrong is the one time somebody
   * restores an older revision.
   */
  const state = await revisionState(admin, studyId, revision.id);

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
        `Revisión ${revision.revision}`,
      ]}
      title={`Revisión ${revision.revision}`}
      lead="La revisión inmutable, dibujada con el mismo componente que recibe el cliente."
      utility={<LogoutButton />}
    >
      <RevisionPreview
        studyId={studyId}
        revisionId={revision.id}
        revision={revision.revision}
        state={state}
        definition={definition}
        registry={resolved.registry}
        data={resolved.data}
        evidence={described.evidence}
        summary={described.summary}
        study={{
          name: studio.study.name,
          clientName: studio.study.clientName,
          period: studio.study.period,
        }}
        initialSelection={selection}
        draftPreviewHref={studioStudyDraftPreview(studyId)}
        publishHref={studioStudyPublish(studyId)}
        activeRevisionHref={
          activeRevisionId && activeRevisionId !== revision.id
            ? studioStudyRevisionPreview(studyId, activeRevisionId)
            : null
        }
        refresh={previewRevisionData}
      />
    </StudioShell>
  );
}

function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="min-h-11 rounded-lg border border-paper/40 px-3 py-1.5 text-sm font-medium text-paper transition-colors duration-[var(--motion-state)] hover:bg-paper/10"
      >
        Cerrar sesión
      </button>
    </form>
  );
}
