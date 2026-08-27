import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { ClientPreviewView } from "@/components/studio/ClientPreviewView";
import { PreviewNotice } from "@/components/shell/PreviewNotice";
import { studyParent } from "@/components/shell/BackLink";
import { studioStudyPublish } from "@/lib/studio/routes";

export const metadata = { title: "Vista del cliente · Be Community" };

type Params = Promise<{ studyId: string }>;

/**
 * The client's real screen, inside the study it belongs to.
 *
 * Same component, same client shell and same internal readiness notices as the
 * legacy address; what changes is where "up" goes and that publication is one
 * link away, at the end, after the reviewer has actually looked.
 */
export default async function StudioClientPreviewPage({ params }: { params: Params }) {
  const { user, supabase, admin } = await requireInternal();
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();
  const workspace = await loadStudioStudy(admin, studyId);
  if (!workspace) notFound();
  const back = studyParent(studyId, workspace.study.name);

  return (
    <ClientPreviewView
      requestClient={supabase}
      studyId={studyId}
      userEmail={user.email ?? ""}
      banner={<PreviewNotice back={back} />}
      /* Outside the dismissible notice, so closing the notice can never strand
         a reviewer inside the client surface. */
      utility={
        <Link
          href={back.href}
          className="inline-flex min-h-11 min-w-0 max-w-full items-center rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-strong hover:bg-surface-sunken"
        >
          <span className="truncate">{back.label}</span>
        </Link>
      }
      footer={
        <section className="mt-10 rounded-xl border border-caution-line bg-caution-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-caution">
            Solo para el equipo de Be Community
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold text-caution">
            ¿Esto es lo que quieres que vea el cliente?
          </h2>
          <p className="mt-1 max-w-prose text-sm text-caution">
            Acabas de ver la pantalla real. Decidir la publicación se hace desde aquí.
          </p>
          <Link
            href={studioStudyPublish(studyId)}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c]"
          >
            Decidir la publicación
          </Link>
        </section>
      }
    />
  );
}
