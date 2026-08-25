import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { StudyWorkSurface } from "@/components/studio/StudyWorkSurface";
import { Pager } from "@/components/studio/Pager";
import { StateBlock } from "@/components/States";
import { Forward } from "@/components/Actions";
import { parsePageRequest, resolvePage } from "@/lib/studio/paging";
import { studioStudyData } from "@/lib/studio/routes";

export const metadata = { title: "Datos del estudio · Be Community" };

type Params = Promise<{ studyId: string }>;
type Search = Promise<{ ok?: string; error?: string; p?: string; por?: string }>;

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  committed: { label: "Confirmada", tone: "border-positive-line bg-positive-surface text-positive" },
  rolled_back: { label: "Revertida", tone: "border-line bg-surface-sunken text-muted" },
  failed: { label: "Falló", tone: "border-danger-line bg-danger-surface text-danger" },
  staged: { label: "Preparada, sin confirmar", tone: "border-caution-line bg-caution-surface text-caution" },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chihuahua",
  }).format(new Date(value));
}

/**
 * The data behind one study: every load, paged and scoped to this study alone.
 *
 * The import history used to be a global `.limit(30)` on a standalone page that
 * had to be told which study it was about. Here it belongs to the study, it is
 * counted, and the count is on screen — so "these are all the loads" and "these
 * are the newest of many" can never look the same.
 *
 * Reverting a load stays where the guided import already offers it, because the
 * server only ever allows reverting the newest committed batch and that control
 * has to sit next to the workflow that created it.
 */
export default async function StudioStudyDataPage({
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
  const { study, counts } = workspace;

  const view = resolvePage(parsePageRequest(query), counts.importBatches);
  const { data: batches, error } = await admin
    .from("import_batch")
    .select("id, file_name, status, expected_respondents, expected_quant, expected_qual, created_at, committed_at")
    .eq("study_id", study.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(view.from, view.to)
    .returns<{
      id: string;
      file_name: string;
      status: string;
      expected_respondents: number;
      expected_quant: number;
      expected_qual: number;
      created_at: string;
      committed_at: string | null;
    }[]>();
  if (error) throw new Error(`import_batch: ${error.message}`);

  const importHref = `/admin/upload?tenant=${study.tenantId}&study=${study.id}`;

  return (
    <StudyWorkSurface
      workspace={workspace}
      current="datos"
      userEmail={user.email ?? ""}
      title="Datos del estudio"
      lead="Cada carga se guarda entera o no se guarda. La más reciente confirmada se puede deshacer."
      ok={query.ok}
      error={query.error}
    >
      <section className="rounded-xl border border-sky-line bg-sky-surface p-5">
        <h2 className="text-base font-semibold text-strong">Traer datos nuevos</h2>
        <p className="mt-1 max-w-prose text-sm text-body">
          El asistente lee el archivo, te muestra qué entendió y no escribe nada hasta que confirmas.
        </p>
        <Link
          href={importHref}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c]"
        >
          Cargar un archivo <Forward />
        </Link>
      </section>

      <section aria-labelledby="historial">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 id="historial" className="text-base font-semibold text-strong">
            Historial de cargas
          </h2>
          <Pager
            window={view}
            basePath={studioStudyData(study.id)}
            params={{ por: query.por ?? null }}
            noun={{ one: "carga", many: "cargas" }}
            label="Paginación del historial de cargas"
          />
        </div>

        {view.total === 0 ? (
          <div className="mt-3">
            <StateBlock title="Este estudio todavía no tiene ninguna carga">
              <p>En cuanto traigas un archivo, cada intento quedará listado aquí con su resultado.</p>
            </StateBlock>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {(batches ?? []).map((batch) => {
              const status = STATUS_LABEL[batch.status] ?? {
                label: batch.status,
                tone: "border-line bg-surface-sunken text-muted",
              };
              return (
                <li key={batch.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words font-medium text-strong">{batch.file_name}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${status.tone}`}>
                      {status.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {formatDate(batch.committed_at ?? batch.created_at)}
                  </p>
                  <p className="mt-1 text-sm text-body">
                    {batch.expected_respondents} personas · {batch.expected_quant} resultados
                    numéricos · {batch.expected_qual} comentarios
                  </p>
                  {batch.status === "staged" ? (
                    <p className="mt-2 rounded-lg border border-caution-line bg-caution-surface px-3 py-2 text-sm text-caution">
                      Se preparó y nunca se confirmó, así que nada de este archivo está en el
                      estudio. Vuelve a cargarlo cuando quieras.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </StudyWorkSurface>
  );
}
