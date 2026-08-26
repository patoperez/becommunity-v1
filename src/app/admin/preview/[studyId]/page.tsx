import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ClientPreviewView } from "@/components/studio/ClientPreviewView";
import { PreviewNotice } from "@/components/shell/PreviewNotice";
import { STUDIES_LIST } from "@/components/shell/BackLink";
import { studioStudyPublish } from "@/lib/studio/routes";

export const metadata = { title: "Vista previa de cliente · Be Community" };

/**
 * The legacy address of the internal client preview.
 *
 * It keeps its URL and its behaviour — bookmarks and the frozen adversarial
 * catalogue both name it — and now renders the shared preview so that it and
 * `/studio/e/[studyId]/vista-cliente` can never show a client two different
 * things. Publication is reached from here, never around here.
 */
export default async function ClientPreviewPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role")
    .eq("user_id", user.id).single<{ role: string }>();
  if (profile?.role !== "internal") redirect("/dashboard");

  return (
    <ClientPreviewView
      requestClient={supabase}
      studyId={studyId}
      userEmail={user.email ?? ""}
      banner={<PreviewNotice />}
      /*
        The persistent escape path. The sticky notice carries the same link, but
        the notice can be dismissed — and dismissing it must never strand a
        reviewer inside the client surface with no way back to Studio. A briefly
        duplicated route while the notice is open is the cheaper mistake, and it
        needs no shared state to coordinate the two.
      */
      utility={<Link
        href={STUDIES_LIST.href}
        className="inline-flex min-h-11 min-w-0 max-w-full items-center rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-strong hover:bg-surface-sunken"
      >
        <span className="truncate">{STUDIES_LIST.label}</span>
      </Link>}
      footer={<PublishEntry studyId={studyId} />}
    />
  );
}

/**
 * The only doorway to publication.
 *
 * Publishing is not offered anywhere a consultant has not just looked at the
 * client's real screen, and the Server Action refuses a publication that does
 * not carry the acknowledgement this route leads to.
 */
function PublishEntry({ studyId }: { studyId: string }) {
  return (
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
  );
}
