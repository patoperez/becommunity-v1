import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { StudyWorkSurface } from "@/components/studio/StudyWorkSurface";
import { ConfirmAction } from "@/components/studio/ConfirmAction";
import { setStudyPublication } from "@/app/admin/studies/actions";
import { studioStudyCategories, studioStudyPreview, studioStudyPublish } from "@/lib/studio/routes";
import { loadCategoryWorkspace } from "@/lib/categories/load";

export const metadata = { title: "Publicación · Be Community" };

type Params = Promise<{ studyId: string }>;
type Search = Promise<{ ok?: string; error?: string }>;

/**
 * Deciding who sees the study.
 *
 * This is the only surface that moves a study between draft, published and
 * archived, and it is reached from the client preview. The server enforces the
 * same thing independently: `setStudyPublication` refuses a publication that
 * does not carry the acknowledgement, refuses an empty study, and refuses an
 * archived client — so a caller that never opened this page gets nowhere.
 *
 * Each transition gets its own dialog with its own honest severity. Publishing
 * is outward-facing and reversible; archiving is reversible; nothing here is
 * permanent, and none of it is dressed as if it were.
 */
export default async function StudioPublishPage({
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
  // Publication is a rare, deliberate act, so this screen can afford the full
  // category scan that the other study screens deliberately do not run.
  const categories = await loadCategoryWorkspace(admin, studyId);
  const query = await searchParams;
  const { study, readiness, counts } = workspace;
  const categoryGate = categories?.gate ?? null;
  const categoriesBlock = (categoryGate?.blocking.length ?? 0) > 0;
  const fields = { study_id: study.id, return_to: studioStudyPublish(study.id) };

  return (
    <StudyWorkSurface
      workspace={workspace}
      current="publicar"
      userEmail={user.email ?? ""}
      title="Publicación"
      lead={
        study.status === "published"
          ? "El cliente ve este estudio ahora mismo."
          : "El cliente todavía no ve este estudio."
      }
      ok={query.ok}
      error={query.error}
    >
      <section className="rounded-xl border border-sky-line bg-sky-surface p-5">
        <h2 className="text-base font-semibold text-strong">Antes de decidir, míralo</h2>
        <p className="mt-1 max-w-prose text-sm text-body">
          La vista del cliente es la pantalla real, con la marca del cliente y sin nada interno.
          Publicar sin haberla visto es la única forma de que salga algo que no querías.
        </p>
        <Link
          href={studioStudyPreview(study.id)}
          className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken"
        >
          Ver como el cliente
        </Link>
      </section>

      {categoriesBlock ? (
        <section className="rounded-xl border border-danger-line bg-danger-surface p-5">
          <h2 className="text-base font-semibold text-danger">
            Hay categorías repetidas sin decidir
          </h2>
          <ul className="mt-2 space-y-2">
            {(categoryGate?.blocking ?? []).map((finding) => (
              <li key={`${finding.dimensionKey}${finding.groupKey}`}>
                <p className="text-sm font-semibold text-danger">{finding.summary}</p>
                <p className="text-sm text-danger">{finding.because}</p>
              </li>
            ))}
          </ul>
          <Link
            href={studioStudyCategories(study.id)}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-danger-line bg-surface px-4 py-2.5 text-sm font-semibold text-danger hover:bg-danger-surface"
          >
            Ir a revisar categorías
          </Link>
        </section>
      ) : null}

      {(categoryGate?.warnings.length ?? 0) > 0 ? (
        <section className="rounded-xl border border-caution-line bg-caution-surface p-5">
          <h2 className="text-base font-semibold text-caution">
            Puede que haya categorías repetidas
          </h2>
          <ul className="mt-2 space-y-2">
            {(categoryGate?.warnings ?? []).map((finding) => (
              <li key={`${finding.dimensionKey}${finding.groupKey}`} className="text-sm text-caution">
                {finding.summary} {finding.because}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-caution">
            Esto no impide publicar. Si publicas así, esas respuestas se cuentan por separado.
          </p>
          <Link
            href={studioStudyCategories(study.id)}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken"
          >
            Revisar categorías
          </Link>
        </section>
      ) : null}

      {readiness.blocking.length > 0 ? (
        <section className="rounded-xl border border-danger-line bg-danger-surface p-5">
          <h2 className="text-base font-semibold text-danger">Todavía no se puede publicar</h2>
          <ul className="mt-2 space-y-2">
            {readiness.blocking.map((item) => (
              <li key={item.id}>
                <p className="text-sm font-semibold text-danger">{item.label}</p>
                <p className="text-sm text-danger">{item.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {readiness.improvements.length > 0 ? (
        <section className="rounded-xl border border-caution-line bg-caution-surface p-5">
          <h2 className="text-base font-semibold text-caution">
            Se puede publicar, pero considera esto
          </h2>
          <ul className="mt-2 space-y-2">
            {readiness.improvements.map((item) => (
              <li key={item.id}>
                <p className="text-sm font-semibold text-caution">{item.label}</p>
                <p className="text-sm text-caution">{item.detail}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-caution">
            Nada de esto se le muestra al cliente como un hueco: lo que no está, sencillamente no
            aparece.
          </p>
        </section>
      ) : null}

      <section aria-labelledby="decidir" className="rounded-xl border border-line bg-surface p-5">
        <h2 id="decidir" className="text-base font-semibold text-strong">
          Decidir
        </h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {study.status !== "published" ? (
            readiness.canPublish && !categoriesBlock ? (
              <ConfirmAction
                trigger="Publicar para el cliente"
                triggerClassName="inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c]"
                title="Publicar el estudio"
                objectName={`${study.name} · ${study.clientName}`}
                severity="reversible"
                consequence={
                  <p>
                    Las personas con acceso a {study.clientName} verán este estudio en su portal:{" "}
                    {counts.quantResponses} resultados numéricos y {counts.confirmedObservations}{" "}
                    comentarios confirmados. Lo que no está confirmado no aparece.
                  </p>
                }
                recovery={
                  <p>
                    Puedes volverlo a borrador o archivarlo cuando quieras, y deja de verse de
                    inmediato.
                  </p>
                }
                acknowledgement="Ya revisé la vista del cliente y estoy de acuerdo con lo que va a ver."
                confirmLabel="Sí, publicar"
                pendingLabel="Publicando…"
                action={setStudyPublication}
                fields={{ ...fields, next_status: "published" }}
              />
            ) : (
              <p className="text-sm text-muted">
                Resuelve primero lo que impide publicarlo
                {categoriesBlock ? ", empezando por las categorías repetidas" : ""}. El servidor lo
                rechazaría igual.
              </p>
            )
          ) : (
            <ConfirmAction
              trigger="Dejar de mostrarlo al cliente"
              title="Volver el estudio a borrador"
              objectName={`${study.name} · ${study.clientName}`}
              severity="reversible"
              consequence={
                <p>
                  El cliente dejará de ver este estudio de inmediato. Nada se borra: los datos, los
                  comentarios y la configuración quedan como están.
                </p>
              }
              recovery={<p>Puedes volver a publicarlo cuando quieras, desde esta misma pantalla.</p>}
              confirmLabel="Sí, volver a borrador"
              action={setStudyPublication}
              fields={{ ...fields, next_status: "draft" }}
            />
          )}

          {study.status !== "archived" ? (
            <ConfirmAction
              trigger="Archivar el estudio"
              title="Archivar el estudio"
              objectName={`${study.name} · ${study.clientName}`}
              severity="recoverable"
              consequence={
                <p>
                  Deja de estar a la vista del cliente y sale del trabajo en curso. Sus datos, sus
                  comentarios y su configuración se conservan completos.
                </p>
              }
              recovery={
                <p>
                  Sigue aquí para el equipo y se puede volver a publicar en cualquier momento desde
                  esta pantalla.
                </p>
              }
              confirmLabel="Sí, archivar"
              action={setStudyPublication}
              fields={{ ...fields, next_status: "archived" }}
            />
          ) : (
            <ConfirmAction
              trigger="Sacarlo del archivo"
              title="Volver el estudio a borrador"
              objectName={`${study.name} · ${study.clientName}`}
              severity="reversible"
              consequence={<p>Vuelve al trabajo en curso. El cliente sigue sin verlo hasta que lo publiques.</p>}
              recovery={<p>Puedes archivarlo otra vez cuando quieras.</p>}
              confirmLabel="Sí, sacarlo del archivo"
              action={setStudyPublication}
              fields={{ ...fields, next_status: "draft" }}
            />
          )}
        </div>
      </section>
    </StudyWorkSurface>
  );
}
