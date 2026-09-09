import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { loadJourneyPainEditor } from "@/lib/studio/publication-workspace";
import { StudyWorkSurface } from "@/components/studio/StudyWorkSurface";
import { JourneyPainEditor } from "@/components/studio/publication/JourneyPainEditor";
import { studioStudyReview } from "@/lib/studio/routes";
import { recordCanonicalJourneyPainDecision } from "../actions";

export const metadata = { title: "Puntos de dolor del recorrido · Be Community" };

type Params = Promise<{ studyId: string }>;

/**
 * THE JOURNEY PAIN EDITOR — the internal surface where a person decides what
 * «Puntos de dolor del recorrido» actually says.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS NOT A NEW DOOR, AND THAT IS WHY IT LIVES HERE.
 *
 * It sits INSIDE the publication review's own route segment, uses that route's
 * co-located `actions.ts`, and loads through `publication-workspace.ts` — the
 * same module the review page loads through, which in turn reaches the
 * canonical layer only through `presentation-workspace.ts`, the composer's
 * declared loader. A person who may open this page is exactly a person who may
 * open the review it belongs to.
 *
 * The boundary gate's door table names this page beside that loader for the
 * same reason it names the review page: an unapproved page reaching the
 * canonical layer fails by name rather than by a count.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER OF THE FIRST FOUR LINES IS THE WHOLE SECURITY ARGUMENT.
 *
 * `requireInternal()` is the FIRST await, before `params` is even unwrapped and
 * long before anything is read. Then the id is validated as a UUID, then the
 * Studio study is loaded through the one authorized path, and only then — with
 * a study row in hand and its tenant read from the database rather than from
 * the request — is the curated evidence loaded at all. A curated phrase is not
 * fetched during the moment the answer might be «no».
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT REACHES THE BROWSER, AND WHAT HAS NO FIELD TO REACH IT IN.
 *
 * The curated phrase, the wording the source gave its stage, a count the server
 * made, four closed words, and two opaque tokens per item. There is no field on
 * any type on this path for a respondent, a respondent identifier, a survey
 * comment, an adjacent free-text answer, a name — or for the SHA-256 source
 * digest, which stays on the server so that freshness is decided by comparing
 * two server-computed values rather than by believing a browser about one.
 *
 * `pain_point` carries no respondent column in any shape: its provenance is a
 * workbook cell. So «no PII crosses» is a fact about which tables are read, not
 * a redaction somebody has to remember to perform.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS PAGE FUNCTION WRITES NOTHING.
 *
 * No insert, update, upsert, delete, RPC or `revalidatePath`. The ONE action it
 * hands down writes exactly one thing — a decision row, through migration
 * 0032's own function — and that table holds no foreign key into `pain_point`,
 * so the canonical source cannot be reached from here at all.
 */
export default async function StudioJourneyPainPage({ params }: { params: Params }) {
  const { user, admin } = await requireInternal();
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();
  const workspace = await loadStudioStudy(admin, studyId);
  if (!workspace) notFound();
  const { study } = workspace;

  const review = await loadJourneyPainEditor(admin, {
    tenantId: study.tenantId,
    studyId: study.id,
    studyName: study.name,
  });

  return (
    <StudyWorkSurface
      workspace={workspace}
      current="revision"
      userEmail={user.email ?? ""}
      title="Puntos de dolor del recorrido"
      lead="Decide, frase por frase, qué se publica, con qué palabras y a qué puntos del recorrido pertenece. Nada de esto se deduce solo."
    >
      <div className="space-y-5">
        <Link
          href={studioStudyReview(study.id)}
          className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken"
          data-testid="volver-a-revision"
        >
          Volver a Revisión y publicación
        </Link>

        {review.ok ? (
          <JourneyPainEditor
            studyId={study.id}
            panel={review.panel}
            /*
              THE ACTION IS HANDED DOWN AS A PROP rather than imported by the
              client component, exactly as the review page hands down its three.
              A `"use client"` module with a static import of it would have a
              path to the canonical read layer in its own import graph.
            */
            decide={recordCanonicalJourneyPainDecision}
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
          </section>
        )}
      </div>
    </StudyWorkSurface>
  );
}
