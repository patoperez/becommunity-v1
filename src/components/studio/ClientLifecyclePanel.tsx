import { ConfirmAction } from "@/components/studio/ConfirmAction";
import { archiveTenant, deleteTenant, restoreTenant } from "@/app/admin/clients/actions";
import {
  impactLines,
  serializeImpact,
  TENANT_DELETION_RETAINED,
  TENANT_LIFECYCLE_MEANING,
  type TenantImpact,
} from "@/lib/studio/lifecycle-model";
import { LIFECYCLE_UNAVAILABLE_REASON } from "@/lib/studio/lifecycle";
import { studioClient } from "@/lib/studio/routes";

/**
 * What can happen to a client organisation, said plainly (P8.2).
 *
 * TWO ACTIONS, DELIBERATELY UNEQUAL.
 *
 * ARCHIVE is the ordinary one. It is reversible, it destroys nothing, it stops
 * new work, and it is presented as ordinary — because dressing every
 * administrative action in red is how the genuinely irreversible one stops
 * being noticed.
 *
 * PERMANENT DELETION is the exception. It shows a counted impact summary before
 * anything happens, requires the client's own name typed exactly, and is
 * re-checked on the server against a summary recomputed at that instant, so the
 * numbers the operator agreed to cannot have gone stale while the dialog was
 * open.
 *
 * When migration 0015 is not applied to the environment, both are DISABLED with
 * the reason stated rather than being hidden or, worse, offered and then
 * failing halfway.
 */
export function ClientLifecyclePanel({
  tenantId,
  tenantName,
  archived,
  available,
  impact,
}: {
  tenantId: string;
  tenantName: string;
  archived: boolean;
  /** False when the lifecycle schema is not present in this environment. */
  available: boolean;
  impact: TenantImpact;
}) {
  const returnTo = studioClient(tenantId);

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

      {!available ? (
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

          <ConfirmAction
            trigger="Eliminar el cliente para siempre"
            title="Eliminar el cliente para siempre"
            objectName={tenantName}
            severity="permanent"
            consequence={
              <>
                <p>Se destruirá todo lo que aparece abajo. No hay copia y no hay deshacer.</p>
                <ul className="mt-2 space-y-1">
                  {impactLines(impact).map((line) => (
                    <li key={line.label} className="flex justify-between gap-4">
                      <span>{line.label}</span>
                      <span className="tabular font-semibold">{line.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            }
            recovery={
              <>
                <p>Nada de eso se puede recuperar. Lo único que se conserva es:</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {TENANT_DELETION_RETAINED.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            }
            requireExactText={tenantName}
            requireExactHint={`Escribe “${tenantName}” para confirmar`}
            confirmLabel="Eliminar para siempre"
            pendingLabel="Eliminando…"
            action={deleteTenant}
            fields={{
              tenant_id: tenantId,
              return_to: returnTo,
              // The summary the operator actually read, travelling with the
              // confirmation. The server recomputes it and refuses the deletion
              // if a single number moved while the dialog was open.
              impact: serializeImpact(impact),
            }}
          >
            <p className="text-xs">
              Antes de eliminar, comprueba que el resumen coincide con lo que esperabas. Si alguien
              del equipo carga datos mientras confirmas, la eliminación se detiene y te lo dice.
            </p>
          </ConfirmAction>
        </div>
      )}
    </section>
  );
}
