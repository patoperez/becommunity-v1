"use client";

import { useMemo, useState, useTransition } from "react";

import { PresentationRenderer } from "@/components/presentation/PresentationRenderer";
import type {
  PublicationReviewPayload,
  PublicationWarningCode,
  PublishPresentation,
  PublishResult,
  RestorePublication,
  RestoreResult,
} from "@/lib/publication";

/**
 * THE REVIEW SURFACE — what somebody reads before a client sees anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS WRITTEN FOR A CONSULTANT, NOT FOR AN ENGINEER.
 *
 * Every word on this screen is Spanish a person says out loud. There is no code
 * on it, no handle, no enum, no uuid, no digest, no threshold and no formula —
 * not because each is filtered out, but because the payload has nowhere to put
 * one. What arrives here is a resolved render model of already-finished values,
 * counts, authored titles and finished sentences. A reviewer approving
 * «bloque-cri-2 · touchpoint_satisfaction» would be approving storage.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER OF THE PAGE IS THE ORDER OF THE DECISION.
 *
 *   1. WHICH revision, and when it was saved — because approving "the draft" is
 *      not approving anything.
 *   2. WHAT STOPS IT, alone and first, in its own red box. A blocker is not a
 *      warning that shouts, and mixing the two teaches people to skim both.
 *   3. WHAT IS WORTH KNOWING, with the ones that change what a client sees
 *      carrying a checkbox somebody has to tick.
 *   4. WHAT THE CLIENT WOULD SEE — the real renderer, the real audience.
 *   5. WHAT IS IN IT, page by page, including the parts a client will NOT see,
 *      which is the half the preview cannot show by design.
 *   6. WHAT CHANGES against what is published now.
 *   7. THE DECISION, behind one more explicit confirmation.
 *   8. THE HISTORY, and restoring from it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PUBLISH CONTROL IS UNUSABLE UNTIL IT IS EARNED, AND THAT IS NOT THE
 * SECURITY.
 *
 * `disabled` while a blocker exists, while a required acknowledgement is
 * missing, while the final confirmation is unticked, and while anything is in
 * flight. None of that stops anybody: the Server Action re-runs the entire
 * preflight over a fresh read, and the database refuses a publication whose
 * caller reports a blocker or an unacknowledged warning. This exists so a person
 * does not do the wrong thing by accident.
 */

const ACKNOWLEDGEMENT_LABEL: Record<PublicationWarningCode, string> = {
  configuration_required_blocks:
    "Entiendo que las partes que esperan contenido no le aparecerán al cliente de ninguna forma.",
  qualitative_review_pending:
    "Entiendo que estas categorías cualitativas no las ha revisado nadie del equipo y aun así se publicarán.",
  withheld_by_sample_policy:
    "Entiendo que la política de muestra escrita a mano reserva estos resultados y el cliente no los verá.",
  nothing_visible: "Entiendo que, tal como está, el cliente no vería nada en esta presentación.",
  annotated_by_sample_policy: "",
  unavailable_blocks: "",
  hidden_blocks: "",
  first_publication: "",
  structure_changed: "",
  evidence_changed_since_publication: "",
};

/** dd/mm/aaaa hh:mm, in the reader's own time zone. Never a raw timestamp. */
function whenLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "fecha desconocida";
  return at.toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CARD = "rounded-xl border border-line bg-surface p-5";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c] disabled:cursor-not-allowed disabled:opacity-50";

export function PublicationReviewView({
  studyId,
  payload,
  publish,
  restore,
}: {
  studyId: string;
  payload: PublicationReviewPayload;
  publish: PublishPresentation;
  restore: RestorePublication;
}) {
  const [acknowledged, setAcknowledged] = useState<PublicationWarningCode[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<PublishResult | null>(null);
  const [restoreOutcome, setRestoreOutcome] = useState<RestoreResult | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  /**
   * ONE KEY PER ATTEMPT, MINTED ONCE.
   *
   * A retry after a lost response must repeat the SAME key — that is what makes
   * it a replay instead of a second publication. `useMemo` with an empty
   * dependency list mints it when the screen mounts and keeps it for as long as
   * this review is open; a reload is a new review and gets a new one.
   */
  const publishKey = useMemo(() => `publish-${crypto.randomUUID()}`, []);
  const restoreKeys = useMemo(() => new Map<number, string>(), []);

  const missing = payload.required.filter((code) => !acknowledged.includes(code));
  const blocked = payload.blockers.length > 0;
  const canPublish = !blocked && missing.length === 0 && confirmed && !pending;

  const toggle = (code: PublicationWarningCode) =>
    setAcknowledged((current) =>
      current.includes(code) ? current.filter((entry) => entry !== code) : [...current, code],
    );

  const onPublish = () => {
    setOutcome(null);
    startTransition(async () => {
      const result = await publish(
        studyId,
        payload.draftRevision,
        payload.current?.version ?? null,
        acknowledged,
        publishKey,
      );
      setOutcome(result);
    });
  };

  const onRestore = (version: number) => {
    setRestoreOutcome(null);
    let key = restoreKeys.get(version);
    if (key === undefined) {
      key = `restore-${crypto.randomUUID()}`;
      restoreKeys.set(version, key);
    }
    const attemptKey = key;
    startTransition(async () => {
      const result = await restore(studyId, version, payload.draftRevision, reason, attemptKey);
      setRestoreOutcome(result);
      if (result.ok) setRestoring(null);
    });
  };

  return (
    // A NAMED ROOT, so a boundary check can be scoped to what THIS unit renders.
    // A whole-document scan for a uuid can never pass on a Studio page: the study
    // id is in the address bar and in every tab's href, and the client's own link
    // carries the tenant. Scanning everything would therefore have to be deleted
    // the first time it ran — and a check that gets deleted proves less than one
    // that is aimed correctly. This subtree is what the publication layer emits.
    <div className="space-y-6" data-testid="revision-publicacion">
      {/* 1 ─ WHICH revision. -------------------------------------------------- */}
      <section className={CARD} aria-labelledby="revision-en-revision">
        <h2 id="revision-en-revision" className="text-base font-semibold text-strong">
          Lo que estás revisando
        </h2>
        <p className="mt-1 max-w-prose text-sm text-body">
          La revisión <strong data-testid="revision-en-revision">{payload.draftRevision}</strong> del
          borrador guardado, tal como quedó el {whenLabel(payload.draftSavedAt)}. Si alguien la edita
          mientras estás aquí, publicar se rechaza y hay que volver a mirar.
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
            <dt className="text-xs text-muted">Páginas</dt>
            <dd className="text-lg font-semibold text-strong" data-testid="conteo-paginas">
              {payload.pageCount}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
            <dt className="text-xs text-muted">Bloques</dt>
            <dd className="text-lg font-semibold text-strong" data-testid="conteo-bloques">
              {payload.blockCount}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
            <dt className="text-xs text-muted">Los ve el cliente</dt>
            <dd className="text-lg font-semibold text-strong" data-testid="conteo-visibles">
              {payload.visibleBlockCount}
            </dd>
          </div>
        </dl>
        {payload.current ? (
          <p className="mt-3 text-sm text-muted" data-testid="publicacion-actual">
            Ahora mismo el cliente ve la versión {payload.current.version}, publicada el{" "}
            {whenLabel(payload.current.publishedAt)} desde la revisión{" "}
            {payload.current.sourceDraftRevision} del borrador.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted" data-testid="publicacion-actual">
            Este estudio no tiene ninguna publicación todavía: el cliente no ve nada.
          </p>
        )}
      </section>

      {/* 2 ─ WHAT STOPS IT. --------------------------------------------------- */}
      {blocked ? (
        <section
          className="rounded-xl border border-danger-line bg-danger-surface p-5"
          aria-labelledby="bloqueos"
          data-testid="bloqueos"
        >
          <h2 id="bloqueos" className="text-base font-semibold text-danger">
            Todavía no se puede publicar
          </h2>
          <ul className="mt-2 space-y-3">
            {payload.blockers.map((entry) => (
              <li key={entry.code}>
                <p className="text-sm text-danger">{entry.detail}</p>
                {entry.where.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-danger">
                    {entry.where.map((where) => (
                      <li key={where}>{where}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 3 ─ WHAT IS WORTH KNOWING. ------------------------------------------ */}
      {payload.warnings.length > 0 ? (
        <section
          className="rounded-xl border border-caution-line bg-caution-surface p-5"
          aria-labelledby="advertencias"
          data-testid="advertencias"
        >
          <h2 id="advertencias" className="text-base font-semibold text-caution">
            Se puede publicar, y conviene que lo sepas
          </h2>
          <ul className="mt-3 space-y-4">
            {payload.warnings.map((entry) => (
              <li key={entry.code}>
                <p className="text-sm text-caution">{entry.detail}</p>
                {entry.where.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-caution">
                    {entry.where.map((where) => (
                      <li key={where}>{where}</li>
                    ))}
                  </ul>
                ) : null}
                {entry.requiresAcknowledgement ? (
                  <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-caution-line bg-surface px-3 py-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={acknowledged.includes(entry.code)}
                      onChange={() => toggle(entry.code)}
                      data-testid={`confirmar-${entry.code}`}
                    />
                    <span className="text-sm font-medium text-caution">
                      {ACKNOWLEDGEMENT_LABEL[entry.code]}
                    </span>
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 4 ─ WHAT THE CLIENT WOULD SEE. -------------------------------------- */}
      {blocked ? null : (
        <section className={CARD} aria-labelledby="vista-cliente" data-testid="vista-cliente">
          <h2 id="vista-cliente" className="text-base font-semibold text-strong">
            Lo que vería el cliente
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Esta es la pantalla real, con sus cifras ya calculadas. Lo que no está no aparece: ni un
            hueco, ni un título, ni una explicación.
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface-sunken p-4">
            <PresentationRenderer model={payload.model} audience="client" />
          </div>
        </section>
      )}

      {/* 5 ─ WHAT IS IN IT, including what the client will not see. ---------- */}
      <section className={CARD} aria-labelledby="inventario" data-testid="inventario">
        <h2 id="inventario" className="text-base font-semibold text-strong">
          Qué lleva, página por página
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Aquí sí aparece lo que el cliente no verá, y por qué. Es la mitad que la vista de arriba no
          puede enseñar, porque su trabajo es no enseñarla.
        </p>
        <div className="mt-4 space-y-4">
          {payload.inventory.map((page) => (
            <div key={page.title} className="rounded-lg border border-line">
              <h3 className="border-b border-line bg-surface-sunken px-3 py-2 text-sm font-semibold text-strong">
                {page.title}
              </h3>
              <ul className="divide-y divide-line">
                {page.blocks.map((block, index) => (
                  <li
                    key={`${block.title}-${index}`}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-strong">{block.title}</span>
                    <span className="text-xs text-muted">{block.kind}</span>
                    <span
                      className={`ml-auto text-xs ${block.visibleToClient ? "text-positive" : "text-caution"}`}
                    >
                      {block.state}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 6 ─ WHAT CHANGES. --------------------------------------------------- */}
      {payload.difference ? (
        <section className={CARD} aria-labelledby="diferencia" data-testid="diferencia">
          <h2 id="diferencia" className="text-base font-semibold text-strong">
            En qué se diferencia de lo publicado
          </h2>
          {payload.difference.identical ? (
            <p className="mt-1 max-w-prose text-sm text-body">
              La estructura es la misma que la de la versión publicada. Las cifras pueden haber
              cambiado; la forma no.
            </p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-body">
              {payload.difference.changes.map((change, index) => (
                <li key={index}>{change.sentence}</li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* 7 ─ THE DECISION. --------------------------------------------------- */}
      <section className={CARD} aria-labelledby="decidir" data-testid="decidir">
        <h2 id="decidir" className="text-base font-semibold text-strong">
          Publicar
        </h2>
        <p className="mt-1 max-w-prose text-sm text-body">
          Al publicar se guarda una copia exacta de lo que acabas de ver, y eso es lo que el cliente
          verá a partir de ese momento. Seguir editando el borrador después no cambia lo publicado:
          para cambiarlo hay que volver aquí y publicar otra vez.
        </p>

        {blocked ? (
          <p className="mt-4 text-sm text-danger">
            Resuelve primero lo que lo impide. El servidor lo rechazaría igual.
          </p>
        ) : (
          <>
            {missing.length > 0 ? (
              <p className="mt-4 text-sm text-caution" data-testid="faltan-confirmaciones">
                Falta{missing.length === 1 ? "" : "n"} {missing.length} confirmación
                {missing.length === 1 ? "" : "es"} de arriba.
              </p>
            ) : null}
            <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-line-strong bg-surface-sunken px-3 py-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={confirmed}
                onChange={() => setConfirmed((value) => !value)}
                data-testid="confirmacion-final"
              />
              <span className="text-sm font-medium text-strong">
                Revisé la vista del cliente y estoy de acuerdo con publicar exactamente esto.
              </span>
            </label>
            <button
              type="button"
              className={`${PRIMARY} mt-4`}
              disabled={!canPublish}
              onClick={onPublish}
              data-testid="publicar"
            >
              {pending ? "Publicando…" : "Publicar para el cliente"}
            </button>
          </>
        )}

        {outcome ? (
          <p
            className={`mt-4 text-sm ${outcome.ok ? "text-positive" : "text-danger"}`}
            data-testid="resultado-publicacion"
            role="status"
          >
            {outcome.ok
              ? outcome.replayed
                ? `Esa publicación ya se había hecho: es la versión ${outcome.version}. No se publicó una segunda vez.`
                : `Publicada la versión ${outcome.version}. Recarga esta pantalla para verla como el estado actual.`
              : outcome.detail}
          </p>
        ) : null}
      </section>

      {/* 8 ─ THE HISTORY, and restoring from it. ---------------------------- */}
      <section className={CARD} aria-labelledby="historial" data-testid="historial">
        <h2 id="historial" className="text-base font-semibold text-strong">
          Historial
        </h2>
        {payload.history.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Todavía no hay nada publicado ni restaurado.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {payload.history.map((entry, index) => (
              <li
                key={`${entry.version}-${entry.action}-${index}`}
                className="rounded-lg border border-line px-3 py-2"
              >
                <p className="text-sm text-strong">
                  <strong>Versión {entry.version}</strong>{" "}
                  {entry.action === "published" ? "publicada" : "restaurada al borrador"} el{" "}
                  {whenLabel(entry.occurredAt)}
                  {entry.current ? " · es la que ve el cliente ahora" : ""}
                  {entry.replacedVersion !== null
                    ? ` · sustituyó a la versión ${entry.replacedVersion}`
                    : ""}
                  {entry.draftRevision !== null
                    ? ` · creó la revisión ${entry.draftRevision} del borrador`
                    : ""}
                </p>
                {entry.note ? <p className="mt-1 text-sm text-muted">{entry.note}</p> : null}
                {entry.action === "published" ? (
                  <div className="mt-2">
                    {restoring === entry.version ? (
                      <div className="space-y-2">
                        <p className="text-sm text-body">
                          Restaurar la versión {entry.version} <strong>no la vuelve a publicar</strong>:
                          copia ese documento encima del borrador de trabajo y crea una revisión nueva.
                          Lo que el cliente ve no cambia hasta que vuelvas a publicar desde aquí. La
                          publicación que restauras se queda intacta en el historial.
                        </p>
                        <label className="block text-sm font-medium text-strong" htmlFor="razon-restauracion">
                          Por qué la restauras
                        </label>
                        <input
                          id="razon-restauracion"
                          type="text"
                          maxLength={200}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          className="min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong"
                          data-testid="razon-restauracion"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={BUTTON}
                            disabled={pending || reason.trim().length === 0}
                            onClick={() => onRestore(entry.version)}
                            data-testid="confirmar-restauracion"
                          >
                            {pending ? "Restaurando…" : "Sí, restaurar al borrador"}
                          </button>
                          <button
                            type="button"
                            className={BUTTON}
                            disabled={pending}
                            onClick={() => setRestoring(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={BUTTON}
                        disabled={pending}
                        onClick={() => {
                          setRestoreOutcome(null);
                          setReason("");
                          setRestoring(entry.version);
                        }}
                        data-testid={`restaurar-${entry.version}`}
                      >
                        Restaurar al borrador
                      </button>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {restoreOutcome ? (
          <p
            className={`mt-4 text-sm ${restoreOutcome.ok ? "text-positive" : "text-danger"}`}
            data-testid="resultado-restauracion"
            role="status"
          >
            {restoreOutcome.ok
              ? `Se copió la versión ${restoreOutcome.version} al borrador, que ahora va por la revisión ${restoreOutcome.draftRevision}. No se publicó nada: el cliente sigue viendo lo mismo.`
              : restoreOutcome.detail}
          </p>
        ) : null}
      </section>
    </div>
  );
}
