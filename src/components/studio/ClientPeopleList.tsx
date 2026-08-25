import { AccessScopeFields } from "@/components/studio/AccessScopeFields";
import { ConfirmAction } from "@/components/studio/ConfirmAction";
import { StateBlock } from "@/components/States";
import {
  deleteClientUser,
  restoreClientUser,
  suspendClientUser,
  updateClientUser,
} from "@/app/admin/clients/actions";
import type { DataScope } from "@/lib/studies/scope";
import type { TenantScopeInventory } from "@/lib/studies/scope-picker";
import {
  CLIENT_USER_ACCESS_LABEL,
  CLIENT_USER_ACCESS_MEANING,
  USER_DELETION_REMOVED,
  USER_DELETION_RETAINED,
  type ClientUserAccess,
} from "@/lib/studio/lifecycle-model";
import { studioClient } from "@/lib/studio/routes";
import { LIFECYCLE_UNAVAILABLE_REASON } from "@/lib/studio/lifecycle";

/**
 * The people who can open this client's portal (P8.2).
 *
 * SUSPEND AND DELETE ARE SEPARATE, FINDABLE ACTIONS. They used to be one — a
 * red box asking for an exact email — so the only way to stop somebody seeing a
 * dashboard was to destroy their account. Suspension is now the ordinary
 * reversible move, it is enforced at the authentication boundary rather than by
 * hiding a link, and it stays visible to internal staff so nobody wonders where
 * a person went.
 *
 * "Invitación pendiente" is a real third state. Showing an invited person as
 * "con acceso" would tell a consultant somebody can already open the portal
 * when they cannot.
 *
 * EVERY ACTION HERE IS GATED ON THE ADMINISTRATIVE RECORD. Suspending,
 * restoring and deleting all promise evidence; where that record cannot be
 * written the controls are replaced by the reason, and the Server Actions
 * refuse independently, so a caller that skips this page gets the same answer.
 */

const input =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";
const button =
  "min-h-11 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-[#183b5c]";

const ACCESS_TONE: Record<ClientUserAccess, string> = {
  active: "border-positive-line bg-positive-surface text-positive",
  invited: "border-caution-line bg-caution-surface text-caution",
  suspended: "border-danger-line bg-danger-surface text-danger",
};

export type ClientPerson = {
  userId: string;
  name: string;
  email: string;
  access: ClientUserAccess;
  scope: DataScope;
  /** False when the stored access could not be read and must be re-chosen. */
  scopeReadable: boolean;
};

export function ClientPeopleList({
  tenantId,
  tenantName,
  people,
  inventories,
  auditAvailable,
}: {
  tenantId: string;
  tenantName: string;
  people: ClientPerson[];
  inventories: Record<string, TenantScopeInventory>;
  /** False when the administrative record cannot be written. */
  auditAvailable: boolean;
}) {
  const returnTo = studioClient(tenantId);
  const tenants = [{ id: tenantId, name: tenantName }];

  if (people.length === 0) {
    return (
      <StateBlock title="Nadie de este cliente tiene acceso todavía">
        <p>Invita a la primera persona con el formulario de arriba.</p>
      </StateBlock>
    );
  }

  return (
    <ul className="space-y-3">
      {people.map((person) => (
        <li key={person.userId}>
          <details className="rounded-xl border border-line bg-surface p-5 open:shadow-raised">
            <summary className="min-h-11 cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-medium text-strong">
                    {person.name || person.email}
                  </p>
                  <p className="break-words text-sm text-muted">{person.email}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${
                    person.scopeReadable
                      ? ACCESS_TONE[person.access]
                      : "border-danger-line bg-danger-surface text-danger"
                  }`}
                >
                  {person.scopeReadable
                    ? CLIENT_USER_ACCESS_LABEL[person.access]
                    : "Acceso por revisar"}
                </span>
              </div>
            </summary>

            <div className="mt-5 space-y-5 border-t border-line pt-5">
              <p className="text-sm text-body">{CLIENT_USER_ACCESS_MEANING[person.access]}</p>

              <form action={updateClientUser} className="space-y-3">
                <input type="hidden" name="user_id" value={person.userId} />
                <input type="hidden" name="return_to" value={returnTo} />
                {person.scopeReadable ? null : (
                  <p
                    role="status"
                    className="rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-sm text-danger"
                  >
                    No se pudo leer el acceso guardado de esta persona. Elige de nuevo qué podrá ver
                    y guarda.
                  </p>
                )}
                <AccessScopeFields
                  idPrefix={`persona-${person.userId}`}
                  tenants={tenants}
                  inventories={inventories}
                  initialTenantId={tenantId}
                  initialScope={person.scope}
                  submitLabel="Guardar usuario"
                  submitClassName={`${button} mt-4 sm:w-fit disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <label className="mt-3 block text-sm font-medium text-strong">
                    Nombre
                    <input
                      className={`${input} mt-1 font-normal`}
                      name="full_name"
                      defaultValue={person.name}
                      maxLength={120}
                      placeholder="Nombre de la persona"
                    />
                  </label>
                </AccessScopeFields>
              </form>

              <div className="flex flex-wrap gap-3 border-t border-line pt-5">
                {!auditAvailable ? (
                  <p
                    role="status"
                    className="rounded-lg border border-caution-line bg-caution-surface px-3 py-2.5 text-sm text-caution"
                  >
                    {LIFECYCLE_UNAVAILABLE_REASON}
                  </p>
                ) : person.access === "suspended" ? (
                  <ConfirmAction
                    trigger="Devolver el acceso"
                    title="Devolver el acceso"
                    objectName={`${person.name || person.email} · ${person.email}`}
                    severity="reversible"
                    consequence={
                      <p>
                        Volverá a poder entrar y verá exactamente lo que su acceso permite, sin
                        cambios.
                      </p>
                    }
                    recovery={<p>Puedes volver a suspenderla cuando quieras.</p>}
                    confirmLabel="Sí, devolver el acceso"
                    action={restoreClientUser}
                    fields={{ user_id: person.userId, return_to: returnTo }}
                  />
                ) : (
                  <ConfirmAction
                    trigger="Suspender el acceso"
                    title="Suspender el acceso"
                    objectName={`${person.name || person.email} · ${person.email}`}
                    severity="recoverable"
                    consequence={
                      <p>
                        Dejará de poder entrar de inmediato. Su cuenta, su nombre y la parte de los
                        resultados que tiene asignada se conservan tal cual.
                      </p>
                    }
                    recovery={
                      <p>
                        Sigue apareciendo en esta lista, marcada como suspendida, y el acceso se
                        devuelve desde aquí en un clic.
                      </p>
                    }
                    confirmLabel="Sí, suspender"
                    action={suspendClientUser}
                    fields={{ user_id: person.userId, return_to: returnTo }}
                  />
                )}

                {auditAvailable ? <ConfirmAction
                  trigger="Eliminar la cuenta para siempre"
                  title="Eliminar la cuenta para siempre"
                  objectName={`${person.name || person.email} · ${person.email}`}
                  severity="permanent"
                  consequence={
                    <>
                      <p>Se destruye:</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {USER_DELETION_REMOVED.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </>
                  }
                  recovery={
                    <>
                      <p>No se puede deshacer. Se conserva:</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {USER_DELETION_RETAINED.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                      <p className="mt-2">
                        Si solo quieres que deje de entrar, suspende el acceso: es reversible.
                      </p>
                    </>
                  }
                  requireExactText={person.email}
                  requireExactHint={`Escribe “${person.email}” para confirmar`}
                  exactTextFieldName="confirmation_email"
                  confirmLabel="Eliminar la cuenta"
                  pendingLabel="Eliminando…"
                  action={deleteClientUser}
                  fields={{ user_id: person.userId, return_to: returnTo }}
                /> : null}
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
