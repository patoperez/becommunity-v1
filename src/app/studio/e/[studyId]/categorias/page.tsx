import { notFound } from "next/navigation";
import { z } from "zod";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { StudyWorkSurface } from "@/components/studio/StudyWorkSurface";
import { CategoryReview } from "@/components/studio/CategoryReview";
import { loadCategoryWorkspace } from "@/lib/categories/load";
import { advisorStatus, cachedVerdict } from "@/lib/categories/advisor/service";
import type { AdvisorOutcome } from "@/lib/categories/advisor/provider";
import { studioStudyCategories } from "@/lib/studio/routes";
import { people } from "@/lib/categories/language";

export const metadata = { title: "Revisar categorías · Be Community" };

type Params = Promise<{ studyId: string }>;
type Search = Promise<{ ok?: string; error?: string }>;

/**
 * "Revisar categorías" — between importing the data and publishing it.
 *
 * The question this screen exists to ask: did the same answer arrive written
 * two ways? Two questionnaires can word one closed answer differently — the
 * members who stayed chose "No he recuperado nada" and the ones who left "No
 * recuperé nada" for the same zero-return band — and counting those apart
 * splits nine people into a five and a four in every chart the client sees.
 *
 * The screen never merges anything. It shows what the product noticed, what
 * each merge would change, and who decided what last time; a person decides.
 * Nothing here is required in order to import, to save, or to work, and only a
 * high-confidence unresolved difference can hold up a publication.
 */
export default async function StudioStudyCategoriesPage({
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
  const categories = await loadCategoryWorkspace(admin, studyId);
  if (!categories) notFound();
  const query = await searchParams;

  const advisor = advisorStatus();

  // Opinions already obtained in this server for the candidates on screen. The
  // advisor is never consulted while a page loads: a study can carry dozens of
  // candidates and most are answered by reading two strings.
  const verdicts: Record<string, AdvisorOutcome> = {};
  if (advisor.enabled) {
    for (const candidate of categories.queue) {
      const dimension = categories.dimensions.find(
        (entry) => entry.key === candidate.group.dimensionKey,
      );
      if (!dimension) continue;
      const held = cachedVerdict({
        tenantId: categories.tenantId,
        contextSignature: dimension.contextSignature,
        groupKey: candidate.group.groupKey,
      });
      if (held) {
        verdicts[`${candidate.group.dimensionKey}::${candidate.group.groupKey}`] = held;
      }
    }
  }

  return (
    <StudyWorkSurface
      workspace={workspace}
      current="categorias"
      userEmail={user.email ?? ""}
      title="Revisar categorías"
      lead={
        categories.queue.length === 0
          ? "No hay respuestas repetidas por revisar en este estudio."
          : "Antes de publicar, comprueba si la misma respuesta llegó escrita de dos formas."
      }
      ok={query.ok}
      error={query.error}
    >
      <section className="rounded-xl border border-sky-line bg-sky-surface p-4 sm:p-5">
        <h2 className="text-base font-semibold text-strong">Lo que nunca pasa aquí</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-body">
          <li>
            Los datos que se importaron no se tocan. Agrupar cambia cómo se cuentan al leerlos, no
            lo que quedó guardado, así que la comparación con los archivos originales sigue siendo
            exacta.
          </li>
          <li>
            El total de personas que respondieron no cambia nunca. Solo cambia en cuántos grupos se
            reparten.
          </li>
          <li>
            Nada se agrupa solo. El producto señala parecidos; agrupar es siempre una decisión de
            una persona, queda con su nombre y se puede deshacer.
          </li>
        </ul>
      </section>

      {categories.gate.blocking.length > 0 ? (
        <section className="rounded-xl border border-danger-line bg-danger-surface p-4 sm:p-5">
          <h2 className="text-base font-semibold text-danger">
            Esto impide publicar hasta que lo decidas
          </h2>
          <ul className="mt-2 space-y-2">
            {categories.gate.blocking.map((finding) => (
              <li key={`${finding.dimensionKey}${finding.groupKey}`}>
                <p className="text-sm font-semibold text-danger">{finding.summary}</p>
                <p className="text-sm text-danger">{finding.because}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-danger">
            Cualquiera de las tres decisiones lo resuelve: agruparlas, dejarlas separadas, o
            posponerlo explicando por qué.
          </p>
        </section>
      ) : null}

      {categories.stale.length > 0 ? (
        <section className="rounded-xl border border-caution-line bg-caution-surface p-4 sm:p-5">
          <h2 className="text-base font-semibold text-caution">Decisiones que conviene repasar</h2>
          <ul className="mt-2 space-y-2">
            {categories.stale.map((finding) => (
              <li key={`${finding.dimensionKey}${finding.groupKey}${finding.kind}`} className="text-sm text-caution">
                <span className="font-medium">{finding.dimensionKey}</span>: {finding.detail}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {categories.publishedIsBehind ? (
        <section className="rounded-xl border border-caution-line bg-caution-surface p-4 sm:p-5">
          <h2 className="text-base font-semibold text-caution">
            El cliente todavía ve las categorías anteriores
          </h2>
          <p className="mt-1 max-w-prose text-sm text-caution">
            Lo publicado se calculó con las categorías que había el{" "}
            {categories.snapshotCapturedAt?.slice(0, 10)}. Es a propósito: un informe ya entregado
            no cambia solo. Vuelve a publicar el estudio cuando quieras que el cliente vea las
            categorías de ahora.
          </p>
        </section>
      ) : null}

      <p className="text-sm text-muted">
        {people(categories.respondents)} en este estudio ·{" "}
        {categories.dimensions.length === 1
          ? "1 característica"
          : `${categories.dimensions.length} características`}{" "}
        · {advisor.enabled ? `asistente activo (${advisor.model})` : advisor.detail}
      </p>

      <CategoryReview
        studyId={studyId}
        returnTo={studioStudyCategories(studyId)}
        queue={categories.queue}
        decided={categories.decided}
        dimensions={categories.dimensions}
        advisor={
          advisor.enabled
            ? { enabled: true, detail: "", model: advisor.model }
            : { enabled: false, detail: advisor.detail }
        }
        verdicts={verdicts}
      />
    </StudyWorkSurface>
  );
}
