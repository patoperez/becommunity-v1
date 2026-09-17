import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { loadCategoryReview } from "@/lib/studio/category-review-workspace";
import { StudyWorkSurface } from "@/components/studio/StudyWorkSurface";
import { CategoryReview } from "@/components/studio/publication/CategoryReview";
import { studioStudyReview } from "@/lib/studio/routes";
import { recordCanonicalCategoryDecision } from "../actions";

export const metadata = { title: "Revisar categorías · Be Community" };

type Params = Promise<{ studyId: string }>;

/**
 * «REVISAR CATEGORÍAS» — the internal surface where a person decides whether the
 * same answer arrived written two ways.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS NOT A NEW DOOR, AND THAT IS WHY IT LIVES HERE.
 *
 * It sits INSIDE the publication review's own route segment, uses that route's
 * co-located `actions.ts`, and loads through `category-review-workspace.ts`,
 * which reaches the canonical layer only through `presentation-workspace.ts` —
 * the composer's declared loader — through a single import statement. A person
 * who may open this page is exactly a person who may open the review it belongs
 * to.
 *
 * The boundary gate's door table names this page beside that loader for the
 * same reason it names the review page and the journey pain editor: an
 * unapproved page reaching the canonical layer fails by name rather than by a
 * count.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER OF THE FIRST FOUR LINES IS THE WHOLE SECURITY ARGUMENT.
 *
 * `requireInternal()` is the FIRST await, before `params` is even unwrapped and
 * long before anything is read. Then the id is validated as a UUID, then the
 * Studio study is loaded through the one authorized path, and only then — with a
 * study row in hand and its tenant read from the database rather than from the
 * request — is anything canonical read at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT REACHES THE BROWSER, AND WHAT HAS NO FIELD TO REACH IT IN.
 *
 * Category labels, counts the server made, four closed words, and one short
 * opaque marker per family. There is no field on any type on this path for a
 * respondent, a respondent identifier, a survey comment, the free-text column
 * that sits beside every coded category column — or for the SHA-256 family
 * digest, which stays on the server so that freshness is decided by comparing
 * two server-computed values rather than by believing a browser about one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS PAGE FUNCTION WRITES NOTHING.
 *
 * No insert, update, upsert, delete, RPC or `revalidatePath`. The ONE action it
 * hands down writes exactly one thing — a decision row, through migration
 * 0034's own function — into a table that holds no foreign key into any
 * canonical table, so the study's evidence cannot be reached from here at all.
 */
export default async function StudioCategoryReviewPage({ params }: { params: Params }) {
  const { user, admin } = await requireInternal();
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();
  const workspace = await loadStudioStudy(admin, studyId);
  if (!workspace) notFound();
  const { study } = workspace;

  const review = await loadCategoryReview(admin, {
    tenantId: study.tenantId,
    studyId: study.id,
    studyName: study.name,
  });

  return (
    <StudyWorkSurface
      workspace={workspace}
      current="revision"
      userEmail={user.email ?? ""}
      title="Revisar categorías"
      lead="Antes de publicar, comprueba si la misma respuesta llegó escrita de dos formas. Agrupar cambia cómo se cuentan al leerlas; lo que se importó no se toca."
    >
      <div className="space-y-5">
        <Link
          prefetch={false}
          href={studioStudyReview(study.id)}
          className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken"
          data-testid="volver-a-revision"
        >
          Volver a Revisión y publicación
        </Link>

        {review.ok ? (
          <CategoryReview
            studyId={study.id}
            panel={review.panel}
            /*
              THE ACTION IS HANDED DOWN AS A PROP rather than imported by the
              client component, exactly as the review page hands down its three
              and the pain editor its one. A `"use client"` module with a static
              import of it would have a path to the canonical read layer in its
              own import graph.
            */
            decide={recordCanonicalCategoryDecision}
          />
        ) : (
          <section
            className="rounded-xl border border-caution-line bg-caution-surface p-5"
            data-testid="categorias-no-disponible"
          >
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-caution">
              Sólo interno · no lo ve el cliente
            </p>
            {/*
              THE HEADING BRANCHES, AND THAT IS THE WHOLE POINT OF THE BRANCH.

              «Todavía no hay categorías que revisar» is a statement about the
              STUDY, and it is true when there is no canonical package. It is
              FALSE when a read failed — and a failed read reported as an empty
              review is the exact defect Unit 6B.4B2K removed from the screen
              next door. A failed read gets its own sentence, about the read.
            */}
            <h2 className="mt-1 font-display text-base font-semibold text-caution">
              {review.unavailable.reason === "no_canonical_package"
                ? "Todavía no hay categorías que revisar"
                : "No se pudo leer el material"}
            </h2>
            <p className="mt-1.5 max-w-prose text-sm text-caution">{review.unavailable.detail}</p>
            {review.unavailable.reason === "no_canonical_package" ? null : (
              <p className="mt-2 max-w-prose text-sm text-caution">
                Esto no dice nada sobre las categorías de este estudio: las decisiones que hayas
                tomado siguen guardadas. Vuelve a cargar la pantalla.
              </p>
            )}
          </section>
        )}
      </div>
    </StudyWorkSurface>
  );
}
