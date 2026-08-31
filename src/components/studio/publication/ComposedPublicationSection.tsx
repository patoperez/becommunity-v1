import Link from "next/link";

import {
  prepareExperienceRevision,
  publishExperienceRevision,
} from "@/app/studio/e/[studyId]/publicar/actions";
import { experienceInventory } from "@/lib/experience/inventory";
import { revisionIsReadable } from "@/lib/experience/publication";
import type { PublicationWorkspace } from "@/lib/experience/publication-workspace";
import { shortHash } from "@/lib/experience/fingerprint";
import {
  studioStudyComposer,
  studioStudyDraftPreview,
  studioStudyPublicationHistory,
  studioStudyPublish,
  studioStudyRevisionPreview,
} from "@/lib/studio/routes";

import {
  Blockers,
  DiffView,
  InventoryView,
  RevisionFacts,
  StaleNotice,
  WarningAcknowledgements,
  formatMoment,
  reviewAction,
  reviewCard,
  reviewCautionCard,
  reviewPrimary,
} from "./ReviewParts";

/**
 * The composed experience's own publication review, on the one publication
 * surface the product has.
 *
 * IT IS NOT A SECOND PUBLICATION SURFACE. `/studio/e/[studyId]/publicar` is
 * still the only place a study's client-facing state changes; this section adds
 * the composed experience to the decision that already happens there, beside
 * the study's own draft/published/archived state rather than instead of it.
 *
 * THE THREE THINGS IT KEEPS APART, because conflating them is the whole failure
 * this milestone exists to prevent:
 *
 *   Borrador             what is being built. Changes every save. Never seen.
 *   Revisión preparada   an immutable snapshot of one exact draft revision,
 *                        previewable exactly as it would be served.
 *   Publicada            the revision the client is being served right now.
 *
 * Each has its own card, its own words and its own preview link, and no control
 * on this screen can turn one into another by accident.
 */
export function ComposedPublicationSection({
  workspace,
}: {
  workspace: PublicationWorkspace;
}) {
  const studyId = workspace.study.id;
  const returnTo = studioStudyPublish(studyId);
  const prepared = workspace.prepared;
  const preparedReadable = prepared && revisionIsReadable(prepared) ? prepared : null;
  const preparedUnreadable = prepared && !revisionIsReadable(prepared) ? prepared : null;
  const preflight = workspace.preparedPreflight;
  const inventorySource = preparedReadable?.definition ?? workspace.draftDefinition;
  const inventory = experienceInventory(inventorySource, workspace.registry);

  const canPublish =
    preparedReadable !== null
    && preflight !== null
    && preflight.blockers.length === 0
    && !workspace.preparedStale
    && workspace.active?.revisionId !== preparedReadable.id;

  return (
    <section className="space-y-4" aria-labelledby="experiencia-compuesta">
      <div className={reviewCard}>
        <h2 id="experiencia-compuesta" className="font-display text-lg font-semibold text-strong">
          Experiencia compuesta
        </h2>
        <p className="mt-1 max-w-prose text-sm text-body">
          Lo que se arma en Construcción no llega al cliente al guardarlo. Se congela en una
          revisión, se revisa exactamente como se vería, y solo entonces se publica.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={studioStudyComposer(studyId)} className={reviewAction}>
            Ir a Construcción
          </Link>
          <Link href={studioStudyDraftPreview(studyId)} className={reviewAction}>
            Vista previa del borrador
          </Link>
          <Link href={studioStudyPublicationHistory(studyId)} className={reviewAction}>
            Historial de versiones
          </Link>
        </div>
      </div>

      {workspace.activeProblem ? (
        <div className="rounded-xl border border-danger-line bg-danger-surface p-5">
          <h3 className="text-base font-semibold text-danger">
            Hay una revisión publicada que esta versión del producto no puede leer
          </h3>
          <p className="mt-1 max-w-prose text-sm text-danger">
            {workspace.activeProblem} Mientras tanto el cliente ve el panel anterior, con sus datos
            reales, y no ve ningún error. Prepara y publica una revisión nueva para volver a
            controlar lo que recibe.
          </p>
        </div>
      ) : null}

      {/* WHAT THE CLIENT IS BEING SERVED RIGHT NOW */}
      <div className={reviewCard}>
        <h3 className="text-base font-semibold text-strong">Lo que el cliente ve ahora</h3>
        {workspace.active ? (
          <>
            <p className="mt-1 text-sm text-body">
              La revisión <strong>{workspace.active.revision}</strong>, publicada el{" "}
              {formatMoment(workspace.active.publishedAt)}. Editar el borrador no la cambia.
            </p>
            <p className="mt-1 text-sm text-muted">
              Huella <code className="font-mono text-xs">{shortHash(workspace.active.definitionSha256)}</code>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={studioStudyRevisionPreview(studyId, workspace.active.revisionId)}
                className={reviewAction}
              >
                Ver la revisión publicada
              </Link>
            </div>
          </>
        ) : (
          <p className="mt-1 max-w-prose text-sm text-body">
            Este estudio todavía usa el panel anterior. Nada de lo que se arme en Construcción lo
            cambia hasta que se publique una revisión desde aquí, y publicarla es lo que mueve a
            este estudio a la experiencia compuesta.
          </p>
        )}
      </div>

      {/* THE PREPARED REVISION */}
      {preparedUnreadable ? (
        <div className={reviewCautionCard}>
          <h3 className="text-base font-semibold text-caution">
            La revisión preparada no se puede leer
          </h3>
          <p className="mt-1 text-sm text-caution">{preparedUnreadable.reason}</p>
        </div>
      ) : null}

      {preparedReadable ? (
        <div className={reviewCard}>
          <h3 className="text-base font-semibold text-strong">
            Revisión preparada
            {workspace.preparedStale ? " · desactualizada" : ""}
            {workspace.active?.revisionId === preparedReadable.id ? " · es la publicada" : ""}
          </h3>
          <p className="mt-1 max-w-prose text-sm text-body">
            Un congelado inmutable del borrador en el momento en que se preparó. Se puede ver
            exactamente como se publicaría; editar el borrador no la toca.
          </p>
          <div className="mt-3">
            <RevisionFacts
              revision={preparedReadable.revision}
              hash={preparedReadable.definitionSha256}
              preparedAt={preparedReadable.preparedAt}
              sourceDraftRevision={preparedReadable.sourceDraftRevision}
              note={preparedReadable.preparedNote}
              acknowledged={preparedReadable.acknowledgedWarnings}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={studioStudyRevisionPreview(studyId, preparedReadable.id)}
              className={reviewAction}
            >
              Ver esta revisión exactamente como se publicaría
            </Link>
          </div>
        </div>
      ) : null}

      {workspace.preparedStale ? <StaleNotice studyId={studyId} /> : null}

      {preparedReadable && preflight ? <Blockers report={preflight} /> : null}

      {/* PUBLISH */}
      {preparedReadable && preflight ? (
        <div className={reviewCard}>
          <h3 className="text-base font-semibold text-strong">Publicar esta revisión</h3>
          {canPublish ? (
            <form action={publishExperienceRevision} className="mt-3 space-y-4">
              <input type="hidden" name="study_id" value={studyId} />
              <input type="hidden" name="revision_id" value={preparedReadable.id} />
              <input type="hidden" name="return_to" value={returnTo} />
              {/*
                THE CONCURRENCY TOKEN. What was published when this screen was
                rendered. The database compares it against what is published at
                the moment of the write and refuses when somebody else moved it,
                so two people deciding at once cannot silently overwrite each
                other — one wins and the other is told what happened.
              */}
              <input
                type="hidden"
                name="expected_active"
                value={workspace.active?.revisionId ?? "none"}
              />
              {preparedReadable.acknowledgedWarnings.map((code) => (
                <input key={code} type="hidden" name="ack" value={code} />
              ))}
              <p className="text-sm text-body">
                El cliente pasará a ver la revisión {preparedReadable.revision}. La versión que hoy
                está publicada se conserva completa en el historial y se puede restaurar.
              </p>
              {preparedReadable.acknowledgedWarnings.length > 0 ? (
                <p className="text-sm text-caution">
                  Se publican con {preparedReadable.acknowledgedWarnings.length} advertencia
                  {preparedReadable.acknowledgedWarnings.length === 1 ? "" : "s"} ya reconocida
                  {preparedReadable.acknowledgedWarnings.length === 1 ? "" : "s"}:{" "}
                  {preparedReadable.acknowledgedWarnings.join(", ")}.
                </p>
              ) : null}
              <label className="block">
                <span className="text-sm font-medium text-strong">Nota interna (opcional)</span>
                <input
                  type="text"
                  name="note"
                  maxLength={200}
                  placeholder="Qué cambia en esta publicación"
                  className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong"
                />
                <span className="mt-1 block text-xs text-muted">
                  Queda en el historial interno. El cliente nunca la ve.
                </span>
              </label>
              <button type="submit" className={reviewPrimary}>
                Publicar la revisión {preparedReadable.revision}
              </button>
            </form>
          ) : (
            <p className="mt-2 max-w-prose text-sm text-body">
              {workspace.active?.revisionId === preparedReadable.id
                ? "Esta revisión ya es la que el cliente ve."
                : workspace.preparedStale
                  ? "Prepara una revisión nueva: esta ya no describe el borrador."
                  : "Resuelve primero lo que impide publicar. El servidor lo rechazaría igual."}
            </p>
          )}
        </div>
      ) : null}

      {/* PREPARE A REVISION FROM THE SAVED DRAFT */}
      <div className={reviewCard}>
        <h3 className="text-base font-semibold text-strong">Preparar una revisión del borrador</h3>
        {workspace.draftProblem ? (
          <p className="mt-2 text-sm text-danger">{workspace.draftProblem}</p>
        ) : null}
        {workspace.draft ? (
          <>
            <p className="mt-1 max-w-prose text-sm text-body">
              Congela el borrador guardado tal como está ahora. Después podrás verlo exactamente
              como se publicaría y decidir.
            </p>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Borrador
                </dt>
                <dd className="text-sm text-body">versión {workspace.draft.revision}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Guardado
                </dt>
                <dd className="text-sm text-body">{formatMoment(workspace.draft.updatedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Huella del documento
                </dt>
                <dd className="text-sm text-body">
                  <code className="font-mono text-xs">{shortHash(workspace.draftHash)}</code>
                </dd>
              </div>
            </dl>

            <div className="mt-4">
              <Blockers report={workspace.draftPreflight} />
            </div>

            {workspace.draftPreflight.blockers.length === 0 ? (
              <form action={prepareExperienceRevision} className="mt-4 space-y-4">
                <input type="hidden" name="study_id" value={studyId} />
                <input type="hidden" name="return_to" value={returnTo} />
                {/* The exact draft revision this preparation is about. */}
                <input type="hidden" name="draft_revision" value={workspace.draft.revision} />
                <WarningAcknowledgements report={workspace.draftPreflight} />
                <label className="block">
                  <span className="text-sm font-medium text-strong">Nota interna (opcional)</span>
                  <input
                    type="text"
                    name="note"
                    maxLength={200}
                    placeholder="Qué se revisó en esta versión"
                    className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong"
                  />
                </label>
                <button type="submit" className={reviewPrimary}>
                  Preparar la revisión
                </button>
              </form>
            ) : null}
          </>
        ) : (
          <p className="mt-1 max-w-prose text-sm text-body">
            Todavía no hay un borrador guardado de esta experiencia. Ábrela en Construcción y
            guarda; hasta entonces no hay nada que congelar.
          </p>
        )}
      </div>

      <DiffView
        diff={workspace.preparedVersusActive ?? workspace.draftVersusActive}
        title={
          workspace.preparedVersusActive
            ? "Qué cambia respecto de lo publicado"
            : "Qué cambiaría respecto de lo publicado"
        }
        lead={
          workspace.preparedVersusActive
            ? "Diferencias entre la revisión publicada y la revisión preparada."
            : "Diferencias entre la revisión publicada y el borrador guardado."
        }
      />

      <InventoryView inventory={inventory} />
    </section>
  );
}
