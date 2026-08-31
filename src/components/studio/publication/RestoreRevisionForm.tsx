"use client";

/**
 * Going back to an earlier revision, deliberately.
 *
 * IT IS NOT CALLED DELETION AND IT DOES NOT BEHAVE LIKE ONE. Restoring appends
 * a new publication event pointing at an older immutable revision. The revision
 * being replaced stays in the history, complete, and can itself be restored
 * afterwards. Nothing is removed, nothing is rewritten, and the record shows
 * that somebody went back rather than pretending the intervening publication
 * never happened.
 *
 * WHY THE REASON IS REQUIRED AND IS TYPED BEFORE THE DIALOG OPENS. It is stored
 * on the event, beside the actor and the time, and it is the only part of a
 * rollback that a person reading the history months later cannot reconstruct
 * from the data. Asking for it inside the confirmation dialog would put a text
 * field in the one place a person is trying to leave quickly; asking for it
 * first makes the dialog a confirmation of a decision already articulated.
 *
 * THE CONCURRENCY TOKEN GOES WITH IT. `expected_active` is what was published
 * when this screen was rendered. The database compares it at the moment of the
 * write, so a rollback issued against a screen somebody else has already moved
 * on from is refused with an explanation instead of silently winning.
 */

import { useState } from "react";

import { ConfirmAction } from "@/components/studio/ConfirmAction";

export function RestoreRevisionForm({
  studyId,
  revisionId,
  revision,
  activeRevision,
  expectedActive,
  returnTo,
  action,
}: {
  studyId: string;
  revisionId: string;
  revision: number;
  /** The revision number that is published right now, for the dialog's words. */
  activeRevision: number | null;
  expectedActive: string | null;
  returnTo: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const ready = reason.trim().length > 0;
  const inputId = `restore-reason-${revisionId}`;

  return (
    <div className="mt-3 space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-strong">
        ¿Por qué vuelves a esta revisión?
        <input
          id={inputId}
          type="text"
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Queda registrado con tu nombre y la hora"
          className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-normal text-strong"
        />
      </label>
      {ready ? (
        <ConfirmAction
          trigger={`Restaurar la revisión ${revision}`}
          title="Restaurar una revisión anterior"
          objectName={`Revisión ${revision}`}
          severity="reversible"
          consequence={
            <p>
              El cliente pasará a ver la revisión {revision}
              {activeRevision !== null
                ? `, en lugar de la ${activeRevision} que ve ahora`
                : ""}
              . Los números se siguen calculando con los datos de hoy; lo que vuelve es la
              disposición: sus páginas, sus bloques, sus filtros y su texto.
            </p>
          }
          recovery={
            <p>
              No se borra nada. La revisión que hoy está publicada queda completa en el historial y
              puedes volver a ella desde esta misma pantalla.
            </p>
          }
          confirmLabel="Sí, restaurar"
          pendingLabel="Restaurando…"
          action={action}
          fields={{
            study_id: studyId,
            revision_id: revisionId,
            reason: reason.trim(),
            expected_active: expectedActive ?? "none",
            return_to: returnTo,
          }}
        />
      ) : (
        <p className="text-sm text-muted">
          Escribe el motivo para poder restaurar. Es lo único de una restauración que nadie puede
          deducir después leyendo el historial.
        </p>
      )}
    </div>
  );
}
