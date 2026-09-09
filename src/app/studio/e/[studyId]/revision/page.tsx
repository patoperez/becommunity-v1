import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { loadPublicationReview } from "@/lib/studio/publication-workspace";
import { StudyWorkSurface } from "@/components/studio/StudyWorkSurface";
import { PublicationReviewView } from "@/components/studio/publication/PublicationReviewView";
import { studioStudyConstruction } from "@/lib/studio/routes";
import {
  previewPublicationUnderSelection,
  publishCanonicalPresentation,
  restoreCanonicalPublication,
} from "./actions";

export const metadata = { title: "Revisión y publicación · Be Community" };

type Params = Promise<{ studyId: string }>;
type Search = Promise<{ ok?: string; error?: string }>;

/**
 * THE PUBLICATION REVIEW — the third page that reaches the canonical layer, and
 * it reaches it through the composer's own loader.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER OF THE FIRST FOUR LINES IS THE WHOLE SECURITY ARGUMENT.
 *
 * `requireInternal()` is the FIRST await, before `params` is even unwrapped and
 * long before anything is read. Then the id is validated as a UUID, then the
 * Studio study is loaded through the one authorized path, and only then — with a
 * study row in hand and its tenant read from the database rather than from the
 * request — is the review built.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS A THIRD DOOR AND NOT A THIRD LOADER, WHICH IS THE WHOLE OF THE ARGUMENT
 * FOR IT.
 *
 * The standing rule is that a surface needing canonical data goes through one of
 * the two approved loaders, or a new one is argued for in the gate BEFORE it is
 * used. This page needs canonical data for a reason nothing else can supply: a
 * publication has to be checked against the study's results AS THEY ARE NOW, and
 * the client-visible preview a reviewer approves is the resolution of the stored
 * draft over those results. Nothing else on this screen would tell anybody
 * whether the document still describes the study.
 *
 * So it adds no loader. `publication-workspace.ts` holds no canonical reader of
 * its own and imports everything that touches one from
 * `presentation-workspace.ts` — the composer's declared loader — through a
 * single import statement, so this page's path to the canonical layer runs
 * through that file. The boundary gate's door table names this page beside that
 * loader, refuses any page that is not in it, and a discrimination test proves
 * the row bites: give the publication module a direct canonical import and this
 * door is reported as skipping the loader it was approved for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT REACHES THE BROWSER.
 *
 * `review.payload` and nothing else: a resolved render model of finished values,
 * counts, authored titles, finished Spanish sentences, two revision numbers and
 * a history of versions and dates. No document, no digest, no binding, no
 * package identity, no tenant or study uuid, no actor and no note about a
 * person. The THREE actions are handed DOWN as props rather than imported by the
 * client component, because a `"use client"` module with a static import of
 * any of them would have a path to the canonical read layer in the import graph.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PREVIEW IS THE CLIENT'S SCREEN, FILTERS AND ALL.
 *
 * The third action resolves the STORED draft under a reviewer's own filter
 * selection and returns a render model. It exists because the preview was
 * mounted without viewer controls, so the approved layout's three filter panels
 * were dropped from it as unfinished edges while the inventory beside it counted
 * them as client-visible — twenty drawn against twenty-three reported. A person
 * cannot approve controls they cannot work.
 *
 * The selection is EPHEMERAL: it is never stored, the action writes nothing, and
 * publishing resolves the stored document under the neutral selection whatever
 * the reviewer had ticked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS PAGE FUNCTION WRITES NOTHING.
 *
 * No insert, update, upsert, delete, RPC or `revalidatePath`. Of the three
 * actions, exactly TWO may write, and each writes exactly one thing: a
 * publication, or a draft revision through the draft's own save function. The
 * preview action writes nothing at all — it is a read that ends in a value.
 */
export default async function StudioStudyReviewPage({
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

  const review = await loadPublicationReview(admin, {
    tenantId: study.tenantId,
    studyId: study.id,
    studyName: study.name,
  });

  return (
    <StudyWorkSurface
      workspace={workspace}
      current="revision"
      userEmail={user.email ?? ""}
      title="Revisión y publicación"
      lead="Mira lo que vería el cliente, confirma lo que haga falta, y publica. Lo publicado queda tal cual, aunque después sigas editando el borrador."
      ok={query.ok}
      error={query.error}
    >
      {review.ok ? (
        <PublicationReviewView
          studyId={study.id}
          payload={review.payload}
          publish={publishCanonicalPresentation}
          restore={restoreCanonicalPublication}
          preview={previewPublicationUnderSelection}
        />
      ) : (
        <section className="rounded-xl border border-caution-line bg-caution-surface p-5">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-caution">
            Sólo interno · no lo ve el cliente
          </p>
          <h2 className="mt-1 font-display text-base font-semibold text-caution">
            Todavía no hay nada que revisar
          </h2>
          <p className="mt-1.5 max-w-prose text-sm text-caution">{review.unavailable.detail}</p>
          <Link
            href={studioStudyConstruction(study.id)}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken"
          >
            Ir a Construcción
          </Link>
        </section>
      )}
    </StudyWorkSurface>
  );
}
