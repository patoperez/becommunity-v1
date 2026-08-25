import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { StateBlock } from "@/components/States";
import { Forward } from "@/components/Actions";
import { STUDIO_STOPS } from "@/components/shell/StudioShell";
import { studyStateLabel } from "@/lib/language/results";
import { loadAttentionBoard } from "@/lib/studio/attention";
import type { AttentionKind } from "@/lib/studio/attention-model";
import {
  STUDIO_CLIENTS,
  STUDIO_STUDIES,
  studioStudy,
  studioStudyData,
  studioStudyIndicators,
  studioStudyPreview,
  studioStudyQualitative,
} from "@/lib/studio/routes";

/**
 * Be Community Studio — the internal home, in one implementation.
 *
 * `/studio` is its address and `/dashboard` still answers for the internal
 * audience, so this component is rendered by both rather than being written
 * twice and drifting.
 *
 * The attention list is built only from state the product can PROVE: an import
 * that never finished, a study with no answers, comments nobody has reviewed, a
 * moment pointing at a result the study does not produce, and a draft that
 * carries data. No deadline, no assignee, no approval — the schema holds none
 * of those, and this is the one screen that must not guess.
 */

/** Where each kind of pending work is actually resolved. */
function hrefFor(kind: AttentionKind, studyId: string): string {
  if (kind === "carga-sin-terminar") return studioStudyData(studyId);
  if (kind === "sin-datos") return studioStudyData(studyId);
  if (kind === "cualitativo-pendiente") return studioStudyQualitative(studyId);
  if (kind === "recorrido-incompleto") return studioStudyIndicators(studyId);
  return studioStudyPreview(studyId);
}

type RecentStudy = {
  id: string;
  name: string;
  period: string | null;
  status: string;
  tenant_id: string;
};

export async function StudioHomeView() {
  const admin = createAdminClient();
  const [board, { data: recent }] = await Promise.all([
    loadAttentionBoard(admin, hrefFor),
    admin
      .from("study")
      .select("id, name, period, status, tenant_id")
      .order("created_at", { ascending: false })
      .limit(8)
      .returns<RecentStudy[]>(),
  ]);
  const recentList = recent ?? [];
  const { data: tenants } = await admin
    .from("tenant")
    .select("id, name")
    .in("id", [...new Set(recentList.map((study) => study.tenant_id))])
    .returns<{ id: string; name: string }[]>();
  const clientName = new Map((tenants ?? []).map((tenant) => [tenant.id, tenant.name]));

  return (
    <>
      <section aria-labelledby="studio-atencion">
        <h2 id="studio-atencion" className="text-xl">
          ¿Qué necesita mi atención?
        </h2>
        {board.shown.length === 0 ? (
          <div className="mt-4">
            <StateBlock title="Nada pendiente que el producto pueda detectar">
              <p>
                {board.studiesExamined === 0
                  ? "Todavía no hay ningún estudio. Empieza creando uno."
                  : "Las cargas terminaron, los comentarios están revisados, los recorridos tienen resultado y los estudios con datos están publicados. Lo que siga depende de tu criterio, no de un aviso automático."}
              </p>
            </StateBlock>
          </div>
        ) : (
          <>
            <ul className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {board.shown.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="flex h-full min-w-0 items-start gap-3.5 rounded-xl border p-4 transition-colors duration-[var(--motion-state)] hover:shadow-raised"
                    style={{ borderColor: item.accent.line, backgroundColor: item.accent.surface }}
                  >
                    {/* The dot groups the KIND of work. It is never a verdict on
                        any number. */}
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: item.accent.fill }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-strong">
                        {item.headline}
                      </span>
                      <span className="mt-0.5 block break-words text-sm text-muted">
                        {item.clientName} · {item.studyName}
                        {item.period ? ` · ${item.period}` : ""}
                      </span>
                      <span className="mt-1 block text-sm text-body">{item.detail}</span>
                      <span className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-evidence">
                        {item.actionLabel} <Forward />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {board.hidden > 0 ? (
              <p className="mt-3 text-sm text-muted">
                Hay {board.hidden} pendiente{board.hidden === 1 ? "" : "s"} más.{" "}
                <Link
                  href={STUDIO_STUDIES}
                  className="font-semibold text-evidence underline-offset-4 hover:underline"
                >
                  Verlos en la lista de estudios
                </Link>
                .
              </p>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="studio-tareas" className="mt-10">
        <h2 id="studio-tareas" className="text-xl">
          Ir a
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {STUDIO_STOPS.filter((stop) => stop.href !== "/studio").map((stop) => (
            <li key={stop.href}>
              <Link
                href={stop.href}
                className="flex h-full min-w-0 flex-col rounded-xl border border-line bg-surface p-5 transition-colors duration-[var(--motion-state)] hover:border-line-strong hover:bg-surface-sunken/50"
              >
                <span className="flex items-center gap-2 font-display text-lg font-semibold text-strong">
                  {stop.label}
                  <Forward />
                </span>
                <span className="mt-1 text-sm text-muted">{stop.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="studio-estudios" className="mt-10">
        <h2 id="studio-estudios" className="text-xl">
          Estudios recientes
        </h2>
        {recentList.length === 0 ? (
          <div className="mt-4">
            <StateBlock title="Todavía no hay ningún estudio">
              <p>
                Crea el primero desde <strong>Estudios</strong>, o empieza trayendo un archivo de
                datos.
              </p>
            </StateBlock>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {recentList.map((study) => (
              <li
                key={study.id}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="break-words font-medium text-strong">{study.name}</p>
                  <p className="text-sm text-muted">
                    {clientName.get(study.tenant_id) ?? "Cliente eliminado"}
                    {study.period ? ` · ${study.period}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full border border-line bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-muted">
                    {studyStateLabel(study.status)}
                  </span>
                  <Link
                    href={studioStudy(study.id)}
                    className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-evidence underline-offset-4 hover:underline"
                  >
                    Abrir el estudio <Forward />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-sm text-muted">
          ¿Necesitas dar o quitar acceso a alguien?{" "}
          <Link
            href={STUDIO_CLIENTS}
            className="font-semibold text-evidence underline-offset-4 hover:underline"
          >
            Ir a clientes y accesos
          </Link>
          .
        </p>
      </section>
    </>
  );
}
