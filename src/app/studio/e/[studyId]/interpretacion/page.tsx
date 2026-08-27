import { notFound } from "next/navigation";
import { z } from "zod";
import { StudyWorkSurface } from "@/components/studio/StudyWorkSurface";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { loadStudyInterpretation } from "@/lib/interpretation/load";
import { loadInterpretationEvidence } from "@/lib/interpretation/evidence";
import { transitionInterpretation } from "./actions";

export const metadata = { title: "Lectura del equipo · Be Community" };

const textarea = "mt-1 min-h-32 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-strong";
const button = "min-h-11 rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-strong hover:bg-surface-sunken";

export default async function InterpretationPage({ params, searchParams }: {
  params: Promise<{ studyId: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { user, admin } = await requireInternal();
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();
  const [workspace, reading] = await Promise.all([loadStudioStudy(admin, studyId), loadStudyInterpretation(admin, studyId)]);
  if (!workspace) notFound();
  const query = await searchParams;
  const draft = reading.draft;
  const evidence = await loadInterpretationEvidence(admin, studyId, workspace.metricOptions, workspace.study.stages);
  const selected = new Set(draft?.evidence.map((item) => `${item.kind}:${item.ref}`) ?? []);

  return (
    <StudyWorkSurface workspace={workspace} current="interpretacion" userEmail={user.email ?? ""}
      title="Lectura del equipo" lead="Convierte los resultados en una lectura clara: qué pasó, por qué importa y qué conviene hacer después."
      ok={query.ok} error={query.error}>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface p-4"><p className="text-xs font-semibold uppercase text-muted">Borrador</p><p className="mt-1 text-sm text-strong">{draft ? "Guardado" : "Sin empezar"}</p></div>
        <div className="rounded-xl border border-line bg-surface p-4"><p className="text-xs font-semibold uppercase text-muted">Revisión</p><p className="mt-1 text-sm text-strong">{{draft:"Listo para enviar",in_review:"En revisión",approved:"Aprobado"}[reading.state]}</p></div>
        <div className="rounded-xl border border-line bg-surface p-4"><p className="text-xs font-semibold uppercase text-muted">Cliente</p><p className="mt-1 text-sm text-strong">{reading.published ? "Lectura publicada" : "Sin lectura publicada"}</p></div>
      </div>

      <form action={transitionInterpretation} className="space-y-5 rounded-xl border border-line bg-surface p-5">
        <input type="hidden" name="study_id" value={studyId} />
        <label className="block text-sm font-semibold text-strong">¿Qué pasó?
          <textarea name="what_happened" className={textarea} required maxLength={1800} defaultValue={draft?.whatHappened ?? ""} placeholder="Resume el hallazgo principal sin repetir todos los números." />
        </label>
        <label className="block text-sm font-semibold text-strong">¿Por qué importa?
          <textarea name="why_it_matters" className={textarea} required maxLength={1800} defaultValue={draft?.whyItMatters ?? ""} placeholder="Explica qué significa para este cliente y su comunidad." />
        </label>
        <label className="block text-sm font-semibold text-strong">¿Qué conviene mirar después?
          <textarea name="what_next" className={textarea} required maxLength={1800} defaultValue={draft?.whatNext ?? ""} placeholder="Propón una siguiente pregunta o decisión; evita prometer una conclusión que los datos no sostienen." />
        </label>
        {evidence.length > 0 ? <fieldset><legend className="text-sm font-semibold text-strong">Evidencia que sostiene esta lectura</legend><p className="mt-1 text-xs text-muted">Elige sólo lo que realmente usaste. El cliente verá nombres legibles, nunca claves técnicas.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{evidence.map((item) => <label key={`${item.kind}:${item.ref}`} className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-page px-3 py-2 text-sm"><input type="checkbox" name="evidence" value={JSON.stringify(item)} defaultChecked={selected.has(`${item.kind}:${item.ref}`)} />{item.label}</label>)}</div></fieldset> : null}
        <button name="transition" value="draft_saved" className="min-h-11 rounded-lg bg-ink px-5 py-2 text-sm font-semibold text-paper">Guardar borrador</button>
      </form>

      <section className="rounded-xl border border-line bg-surface p-5"><h2 className="text-base font-semibold text-strong">Revisar y publicar</h2><p className="mt-1 text-sm text-muted">Es el mismo equipo y los permisos no cambian. El estado hace visible quién dejó la lectura lista y evita publicar un borrador por accidente.</p><div className="mt-4 flex flex-wrap gap-2">
        {reading.state === "draft" && draft ? <form action={transitionInterpretation}><input type="hidden" name="study_id" value={studyId}/><button name="transition" value="submitted" className={button}>Enviar a revisión</button></form> : null}
        {reading.state === "in_review" ? <><form action={transitionInterpretation}><input type="hidden" name="study_id" value={studyId}/><button name="transition" value="approved" className={button}>Aprobar lectura</button></form><form action={transitionInterpretation}><input type="hidden" name="study_id" value={studyId}/><button name="transition" value="changes_requested" className={button}>Pedir cambios</button></form></> : null}
        {reading.state === "approved" ? <><form action={transitionInterpretation}><input type="hidden" name="study_id" value={studyId}/><button name="transition" value="published" className="min-h-11 rounded-lg bg-positive px-4 py-2 text-sm font-semibold text-white">Publicar lectura</button></form><form action={transitionInterpretation}><input type="hidden" name="study_id" value={studyId}/><button name="transition" value="changes_requested" className={button}>Volver a editar</button></form></> : null}
        {reading.published ? <form action={transitionInterpretation}><input type="hidden" name="study_id" value={studyId}/><button name="transition" value="unpublished" className={button}>Retirar lectura</button></form> : null}
      </div></section>
    </StudyWorkSurface>
  );
}
