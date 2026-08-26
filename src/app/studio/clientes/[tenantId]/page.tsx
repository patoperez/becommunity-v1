import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { StudioShell } from "@/components/shell/StudioShell";
import { CLIENTS_LIST } from "@/components/shell/BackLink";
import { logout } from "@/app/dashboard/actions";
import { requireInternal } from "@/lib/studio/guard";
import { inviteClientUser, renameTenant, updateTenantBrand } from "@/app/admin/clients/actions";
import { AccessScopeFields } from "@/components/studio/AccessScopeFields";
import { ClientLifecyclePanel } from "@/components/studio/ClientLifecyclePanel";
import { ClientPeopleList, type ClientPerson } from "@/components/studio/ClientPeopleList";
import { Flash } from "@/components/studio/Flash";
import { Pager } from "@/components/studio/Pager";
import { StateBlock } from "@/components/States";
import { Forward } from "@/components/Actions";
import { logoPublicUrl, parseBrandConfig } from "@/lib/branding/config";
import { studyStateLabel } from "@/lib/language/results";
import { parseDataScope, type DataScope } from "@/lib/studies/scope";
import { loadTenantScopeInventories } from "@/lib/studies/scope-inventory";
import {
  countTenantImpact,
  lifecycleAuditAvailable,
  loadTenantArchiveState,
  loadTenantLifecycleHistory,
} from "@/lib/studio/lifecycle";
import { clientUserAccess, TENANT_LIFECYCLE_LABEL } from "@/lib/studio/lifecycle-model";
import { parsePageRequest, resolvePage } from "@/lib/studio/paging";
import { studioClient, studioStudy } from "@/lib/studio/routes";
import { loadStudyMetricOptions } from "@/lib/studio/metric-inventory";

export const metadata = { title: "Cliente · Be Community" };

type Params = Promise<{ tenantId: string }>;
type Search = Promise<{ ok?: string; error?: string; p?: string; por?: string }>;

const input =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";
const button =
  "min-h-11 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-[#183b5c]";

const LIFECYCLE_ACTION_LABEL: Record<string, string> = {
  client_user_suspended: "Se suspendió el acceso de una persona",
  client_user_restored: "Se devolvió el acceso a una persona",
  client_user_delete_started: "Se inició la eliminación de una cuenta",
  client_user_deleted: "Se eliminó una cuenta de acceso",
  tenant_archived: "Se archivó el cliente",
  tenant_restored: "Se reactivó el cliente",
  tenant_deleted: "Se eliminó el cliente",
};

/**
 * One client: its identity, its people, its studies and its lifecycle.
 *
 * A stored access this page cannot read is REPORTED, never rounded off to full
 * access behind the reader's back — the precedent the access picker set, kept
 * here.
 */
function readStoredScope(value: unknown): { scope: DataScope; readable: boolean } {
  try {
    return { scope: parseDataScope(value), readable: true };
  } catch {
    return { scope: {}, readable: false };
  }
}

export default async function StudioClientPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { user, admin } = await requireInternal();
  const { tenantId } = await params;
  if (!z.string().uuid().safeParse(tenantId).success) notFound();

  const { data: tenant, error } = await admin
    .from("tenant")
    .select("id, name, brand_config")
    .eq("id", tenantId)
    .maybeSingle<{ id: string; name: string; brand_config: unknown }>();
  if (error) throw new Error(`tenant: ${error.message}`);
  if (!tenant) notFound();

  const query = await searchParams;

  const [archiveState, impactReport, auditAvailable, history, inventories, { count: peopleTotal }, { data: studies }] =
    await Promise.all([
      loadTenantArchiveState(admin, [tenantId]),
      countTenantImpact(admin, tenantId),
      lifecycleAuditAvailable(admin),
      loadTenantLifecycleHistory(admin, tenantId),
      loadTenantScopeInventories(admin, [tenantId]),
      admin.from("profiles").select("user_id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("role", "client"),
      admin.from("study").select("id, name, period, status")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(20)
        .returns<{ id: string; name: string; period: string | null; status: string }[]>(),
    ]);

  // The people list is PAGED over profiles, and only the accounts on the page
  // are resolved. The previous screen listed every Auth account in the project
  // on every render to find the handful that belonged to one client.
  const view = resolvePage(parsePageRequest(query), peopleTotal ?? 0);
  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, data_scope")
    .eq("tenant_id", tenantId)
    .eq("role", "client")
    .order("created_at")
    .range(view.from, view.to)
    .returns<{ user_id: string; full_name: string | null; data_scope: unknown }[]>();

  const people: ClientPerson[] = await Promise.all(
    (profiles ?? []).map(async (profile) => {
      const { data: account } = await admin.auth.admin.getUserById(profile.user_id);
      const stored = readStoredScope(profile.data_scope);
      return {
        userId: profile.user_id,
        name: profile.full_name ?? "",
        email: account.user?.email ?? "Cuenta sin correo",
        access: clientUserAccess({
          bannedUntil: account.user?.banned_until ?? null,
          lastSignInAt: account.user?.last_sign_in_at ?? null,
          emailConfirmedAt: account.user?.email_confirmed_at ?? null,
        }),
        scope: stored.scope,
        scopeReadable: stored.readable,
      };
    }),
  );

  const impact = impactReport.impact;
  const archived = Boolean(archiveState.archivedAt[tenantId]);
  const brand = parseBrandConfig(tenant.brand_config);
  const logoUrl = logoPublicUrl(brand.logoPath);
  const returnTo = studioClient(tenantId);
  const metricsByStudy = await loadStudyMetricOptions(admin, (studies ?? []).map((study) => study.id));
  const tenantMetricOptions = [...new Map(Object.values(metricsByStudy).flat().map((option) => [option.key, option])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "es-MX"));

  return (
    <StudioShell
      userEmail={user.email ?? ""}
      currentHref="/studio/clientes"
      back={CLIENTS_LIST}
      breadcrumb={["Studio", "Clientes y accesos", tenant.name]}
      title={tenant.name}
      lead={
        archived
          ? "Cliente archivado: no admite estudios, invitaciones ni publicaciones nuevas."
          : "Quién entra, qué ve cada persona y qué estudios tiene este cliente."
      }
      utility={
        <form action={logout}>
          <button
            type="submit"
            className="min-h-11 rounded-lg border border-paper/40 px-3 py-1.5 text-sm font-medium text-paper transition-colors duration-[var(--motion-state)] hover:bg-paper/10"
          >
            Cerrar sesión
          </button>
        </form>
      }
    >
      <div className="space-y-8">
        <Flash ok={query.ok} error={query.error} />

        {archived ? (
          <p
            role="status"
            className="rounded-lg border border-caution-line bg-caution-surface px-4 py-3 text-sm text-caution"
          >
            {TENANT_LIFECYCLE_LABEL.archived}. Reactívalo antes de crear estudios, invitar personas
            o publicar.
          </p>
        ) : null}

        <section aria-labelledby="identidad" className="grid gap-5 lg:grid-cols-2">
          <form action={renameTenant} className="rounded-xl border border-line bg-surface p-5">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="return_to" value={returnTo} />
            <h2 id="identidad" className="text-base font-semibold text-strong">
              Nombre del cliente
            </h2>
            <p className="mt-1 text-sm text-muted">
              Es como aparece en Studio y en los informes.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="min-w-[14rem] flex-1 text-sm font-medium text-strong">
                Nombre
                <input
                  className={`${input} mt-1 font-normal`}
                  name="name"
                  defaultValue={tenant.name}
                  required
                  maxLength={160}
                />
              </label>
              <button className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-strong hover:bg-surface-sunken">
                Guardar
              </button>
            </div>
          </form>

          <form action={updateTenantBrand} className="rounded-xl border border-line bg-surface p-5">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="return_to" value={returnTo} />
            <h2 className="text-base font-semibold text-strong">Identidad visual</h2>
            <p className="mt-1 text-sm text-muted">
              El producto corrige el contraste si hace falta, para que el texto siempre se lea.
            </p>
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-3">
                {logoUrl ? (
                  <>
                    {/* Dynamic tenant Storage URLs cannot use a static Next Image remote allowlist. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl}
                      alt={`Logotipo de ${tenant.name}`}
                      width={72}
                      height={48}
                      className="h-12 w-18 rounded border bg-white object-contain p-1"
                    />
                  </>
                ) : (
                  <div className="flex h-12 w-18 items-center justify-center rounded border border-line bg-surface-sunken text-xs text-muted">
                    Sin logo
                  </div>
                )}
                <label className="flex-1 text-xs font-medium">
                  Logotipo
                  <input className={`${input} mt-1`} name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
                  <span className="mt-1 block text-[11px] text-muted">PNG, JPEG o WebP · máximo 1 MB</span>
                </label>
              </div>
              {logoUrl ? (
                <label className="flex items-center gap-2 text-xs text-danger">
                  <input type="checkbox" name="remove_logo" /> Quitar logotipo actual
                </label>
              ) : null}
              <input className={input} name="display_name" maxLength={120} defaultValue={brand.displayName ?? ""} placeholder="Nombre visible (opcional)" aria-label="Nombre visible" />
              <input className={input} name="tagline" maxLength={180} defaultValue={brand.tagline} placeholder="Leyenda de marca" aria-label="Leyenda de marca" />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium">
                  Color principal
                  <input className="mt-1 h-10 w-full rounded border" name="primary_color" type="color" defaultValue={brand.primaryColor} />
                </label>
                <label className="text-xs font-medium">
                  Color de acento
                  <input className="mt-1 h-10 w-full rounded border" name="accent_color" type="color" defaultValue={brand.accentColor} />
                </label>
              </div>
              <details className="rounded-lg border border-line bg-surface-page p-3">
                <summary className="cursor-pointer text-sm font-semibold text-strong">Presentación predeterminada de sus estudios</summary>
                <p className="mt-2 text-xs text-muted">Cada estudio puede reemplazar estos valores. Si no lo hace, hereda esta configuración.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium">Etiqueta de portada<input className={`${input} mt-1 font-normal`} name="default_cover_label" maxLength={80} defaultValue={brand.presentationDefaults.coverLabel ?? ""} placeholder="Panorama del estudio" /></label>
                  <label className="text-xs font-medium">Nota breve<input className={`${input} mt-1 font-normal`} name="default_cover_note" maxLength={240} defaultValue={brand.presentationDefaults.coverNote ?? ""} /></label>
                  <label className="text-xs font-medium">Resultado con rango ideal<select className={`${input} mt-1 font-normal`} name="default_threshold_metric" defaultValue={brand.presentationDefaults.threshold?.metric ?? ""}><option value="">Sin alerta predeterminada</option>{tenantMetricOptions.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label>
                  <label className="text-xs font-medium">Texto de la alerta<input className={`${input} mt-1 font-normal`} name="default_threshold_label" maxLength={160} defaultValue={brand.presentationDefaults.threshold?.label ?? "Fuera del rango ideal"} /></label>
                  <label className="text-xs font-medium">Mínimo ideal<input className={`${input} mt-1 font-normal`} type="number" step="any" name="default_threshold_minimum" defaultValue={brand.presentationDefaults.threshold?.minimum ?? ""} /></label>
                  <label className="text-xs font-medium">Máximo ideal<input className={`${input} mt-1 font-normal`} type="number" step="any" name="default_threshold_maximum" defaultValue={brand.presentationDefaults.threshold?.maximum ?? ""} /></label>
                </div>
              </details>
              <button className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-strong hover:bg-surface-sunken">
                Guardar identidad
              </button>
            </div>
          </form>
        </section>

        <section aria-labelledby="estudios">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <h2 id="estudios" className="text-xl">
              Estudios de este cliente
            </h2>
            <p className="text-sm text-muted">
              {impact.studies} en total · {impact.publishedStudies} publicados
            </p>
          </div>
          {(studies ?? []).length === 0 ? (
            <div className="mt-3">
              <StateBlock title="Este cliente todavía no tiene estudios">
                <p>Crea el primero desde Estudios.</p>
              </StateBlock>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {(studies ?? []).map((study) => (
                <li key={study.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-strong">{study.name}</p>
                    <p className="text-sm text-muted">
                      {studyStateLabel(study.status)}
                      {study.period ? ` · ${study.period}` : ""}
                    </p>
                  </div>
                  <Link
                    href={studioStudy(study.id)}
                    className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-evidence underline-offset-4 hover:underline"
                  >
                    Abrir el estudio <Forward />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="personas" className="space-y-4">
          <h2 id="personas" className="text-xl">
            Personas con acceso
          </h2>

          {archived ? (
            <p className="rounded-lg border border-line bg-surface-sunken px-4 py-3 text-sm text-muted">
              Este cliente está archivado, así que no se pueden enviar invitaciones nuevas. Quien ya
              tenía acceso lo conserva; para quitárselo a alguien, suspéndelo abajo.
            </p>
          ) : (
            <form action={inviteClientUser} className="rounded-xl border border-line bg-surface p-5">
              <input type="hidden" name="return_to" value={returnTo} />
              <h3 className="text-base font-semibold text-strong">Invitar a una persona</h3>
              <p className="mt-1 mb-4 text-sm text-muted">
                Recibirá un correo para establecer su acceso. Hasta entonces aparece como invitación
                pendiente.
              </p>
              <AccessScopeFields
                idPrefix="invitar"
                tenants={[{ id: tenantId, name: tenant.name }]}
                inventories={inventories}
                initialTenantId={tenantId}
                submitLabel="Enviar invitación"
                submitClassName={`${button} mt-4 disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-sm font-medium text-strong">
                    Correo
                    <input className={`${input} mt-1 font-normal`} name="email" type="email" required placeholder="persona@cliente.com" />
                  </label>
                  <label className="text-sm font-medium text-strong">
                    Nombre <span className="font-normal text-muted">(opcional)</span>
                    <input className={`${input} mt-1 font-normal`} name="full_name" maxLength={120} placeholder="Nombre de la persona" />
                  </label>
                </div>
              </AccessScopeFields>
            </form>
          )}

          <ClientPeopleList
            tenantId={tenantId}
            tenantName={tenant.name}
            people={people}
            inventories={inventories}
            auditAvailable={auditAvailable}
          />
          <Pager
            window={view}
            basePath={returnTo}
            params={{ por: query.por ?? null }}
            noun={{ one: "persona", many: "personas" }}
            label="Paginación de personas con acceso"
          />
        </section>

        <ClientLifecyclePanel
          tenantId={tenantId}
          tenantName={tenant.name}
          archived={archived}
          archiveAvailable={archiveState.available}
          auditAvailable={auditAvailable}
          impact={impact}
          storageInventoryComplete={impactReport.storageInventoryComplete}
          storageIncompleteReason={impactReport.storageIncompleteReason}
        />

        {history.available && history.records.length > 0 ? (
          <section aria-labelledby="historial-admin">
            <h2 id="historial-admin" className="text-base font-semibold text-strong">
              Historial administrativo
            </h2>
            <p className="mt-1 text-sm text-muted">
              Quién suspendió, devolvió, archivó o eliminó, y cuándo. Es información interna.
            </p>
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {history.records.map((record, index) => (
                <li key={`${record.occurredAt}-${index}`} className="px-4 py-3 text-sm">
                  <p className="text-strong">
                    {LIFECYCLE_ACTION_LABEL[record.action] ?? record.action}
                    {record.subjectLabel ? ` · ${record.subjectLabel}` : ""}
                  </p>
                  <p className="text-xs text-muted">
                    {new Intl.DateTimeFormat("es-MX", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "America/Chihuahua",
                    }).format(new Date(record.occurredAt))}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </StudioShell>
  );
}
