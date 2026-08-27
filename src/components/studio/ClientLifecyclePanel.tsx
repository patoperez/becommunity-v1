import { ConfirmAction } from "@/components/studio/ConfirmAction";
import { archiveTenant, restoreTenant } from "@/app/admin/clients/actions";
import {
  impactLines,
  TENANT_DELETION_RETAINED,
  TENANT_LIFECYCLE_MEANING,
  type TenantImpact,
} from "@/lib/studio/lifecycle-model";
import {
  LIFECYCLE_UNAVAILABLE_REASON,
  TENANT_DELETION_DISABLED_REASON,
} from "@/lib/studio/lifecycle";
import { studioClient } from "@/lib/studio/routes";

/**
 * What can happen to a client organisation, said plainly (P8.2).
 *
 * ARCHIVE is the ordinary action. It is reversible, it destroys nothing, it
 * stops new work, and it is presented as ordinary — because dressing every
 * administrative action in red is how the genuinely irreversible one stops
 * being noticed.
 *
 * PERMANENT DELETION IS DISABLED, AND SAYS SO. It is not hidden and not
 * pretended: the impact summary is still computed and still shown, because
 * knowing what a client is made of is useful on its own, and the panel states
 * in internal-facing words why the destructive action is unavailable. The
 * Server Action refuses it as well, so nothing changes for a caller that skips
 * this page.
 *
 * When the administrative record is unavailable, ARCHIVE is disabled too. Every
 * lifecycle action promises evidence; without somewhere to write it the honest
 * answer is to refuse rather than to act unrecorded.
 */
export function ClientLifecyclePanel({
  tenantId,
  tenantName,
  archived,
  archiveAvailable,
  auditAvailable,
  impact,
  storageInventoryComplete,
  storageIncompleteReason,
}: {
  tenantId: string;
  tenantName: string;
  archived: boolean;
  /** False when the lifecycle schema is not present in this environment. */
  archiveAvailable: boolean;
  /** False when the administrative record cannot be written. */
  auditAvailable: boolean;
  impact: TenantImpact;
  /** False when the stored-object inventory hit its ceiling or failed. */
  storageInventoryComplete: boolean;
  storageIncompleteReason: string | null;
}) {
  const returnTo = studioClient(tenantId);
  const canArchive = archiveAvailable && auditAvailable;

  return (
    <section
      aria-labelledby="ciclo-de-vida"
      className="rounded-xl border border-line bg-surface p-5"
    >
      <h2 id="ciclo-de-vida" className="text-base font-semibold text-strong">
        Estado de la relación con este cliente
      </h2>
      <p className="mt-1 max-w-prose text-sm text-body">
        {archived ? TENANT_LIFECYCLE_MEANING.archived : TENANT_LIFECYCLE_MEANING.active}
      </p>

      {!canArchive ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-caution-line bg-caution-surface px-3 py-2.5 text-sm text-caution"
        >
          {LIFECYCLE_UNAVAILABLE_REASON}
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          {archived ? (
            <ConfirmAction
              trigger="Reactivar el cliente"
              title="Reactivar el cliente"
              objectName={tenantName}
              severity="reversible"
              consequence={
                <p>
                  Vuelve a admitir estudios nuevos, invitaciones nuevas y publicaciones nuevas.
                </p>
              }
              recovery={<p>Puedes volver a archivarlo cuando quieras, desde esta misma pantalla.</p>}
              confirmLabel="Sí, reactivar"
              action={restoreTenant}
              fields={{ tenant_id: tenantId, return_to: returnTo }}
            />
          ) : (
            <ConfirmAction
              trigger="Archivar el cliente"
              title="Archivar el cliente"
              objectName={tenantName}
              severity="recoverable"
              consequence={
                <p>
                  Dejará de admitir estudios nuevos, invitaciones nuevas y publicaciones nuevas.
                  Nada se borra y nada deja de verse: quien ya tenía acceso lo conserva.
                </p>
              }
              recovery={
                <p>
                  Sigue visible para el equipo y se reactiva desde esta misma pantalla. Para quitarle
                  el acceso a una persona en concreto, suspéndela más abajo.
                </p>
              }
              confirmLabel="Sí, archivar"
              action={archiveTenant}
              fields={{ tenant_id: tenantId, return_to: returnTo }}
            />
          )}
        </div>
      )}

      {/*
        The impact summary survives the disabling of the deletion it used to
        gate. What a client is made of is worth knowing before archiving it, and
        keeping the computation live is what will make re-enabling deletion a
        change to the execution rather than a rebuild of the analysis.
      */}
      <section aria-labelledby="impacto" className="mt-6 border-t border-line pt-5">
        <h3 id="impacto" className="text-sm font-semibold text-strong">
          De qué está hecho este cliente
        </h3>
        <ul className="mt-2 max-w-md space-y-1 text-sm text-body">
          {impactLines(impact).map((line) => (
            <li key={line.label} className="flex justify-between gap-4">
              <span>{line.label}</span>
              <span className="tabular font-semibold">{line.count}</span>
            </li>
          ))}
        </ul>
        {!storageInventoryComplete ? (
          <p
            role="status"
            className="mt-3 rounded-lg border border-caution-line bg-caution-surface px-3 py-2.5 text-sm text-caution"
          >
            El inventario de archivos guardados está incompleto, así que el conteo de arriba puede
            quedarse corto.{storageIncompleteReason ? ` ${storageIncompleteReason}` : ""}
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="eliminacion"
        className="mt-5 rounded-xl border border-line bg-surface-sunken p-4"
      >
        <h3 id="eliminacion" className="text-sm font-semibold text-strong">
          Eliminar el cliente para siempre · no disponible
        </h3>
        <p className="mt-1.5 max-w-prose text-sm text-body">
          Por ahora, archiva el cliente. Es reversible, conserva toda su información y evita que se
          cree o publique trabajo nuevo.
        </p>
        <details className="mt-3 max-w-prose rounded-lg border border-line bg-surface px-3 py-2.5 text-xs text-muted">
          <summary className="min-h-6 cursor-pointer font-semibold text-strong">
            Por qué no está disponible
          </summary>
          <p className="mt-2">{TENANT_DELETION_DISABLED_REASON}</p>
          <p className="mt-2">
            Si aun así hace falta destruir los datos de un cliente, solicítalo al equipo técnico:
            hoy requiere una revisión explícita y no se hace desde esta pantalla.
          </p>
          <div className="mt-3">
            <p>Cuando vuelva a estar disponible, esto es lo que se conservará:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {TENANT_DELETION_RETAINED.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </details>
      </section>
    </section>
  );
}
