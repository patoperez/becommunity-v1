import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createTenant, deleteClientUser, inviteClientUser, renameTenant, updateClientUser, updateTenantBrand } from "./actions";
import { logoPublicUrl, parseBrandConfig } from "@/lib/branding/config";
import { StudioShell } from "@/components/shell/StudioShell";
import { STUDIO_HOME } from "@/components/shell/BackLink";
import { logout } from "@/app/dashboard/actions";
import { AccessScopeFields } from "@/components/studio/AccessScopeFields";
import { loadTenantScopeInventories } from "@/lib/studies/scope-inventory";
import { parseDataScope, type DataScope } from "@/lib/studies/scope";
import { loadTenantArchiveState } from "@/lib/studio/lifecycle";
import { clientUserAccess, CLIENT_USER_ACCESS_LABEL } from "@/lib/studio/lifecycle-model";
import { studioClient } from "@/lib/studio/routes";
import { Forward } from "@/components/Actions";

export const metadata = { title: "Clientes y usuarios · Be Community" };

type Search = Promise<{ ok?: string; error?: string }>;
type Tenant = { id: string; name: string; brand_config: unknown };
type Profile = { user_id: string; tenant_id: string | null; full_name: string | null; data_scope: unknown };

const input =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";
const button =
  "min-h-11 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-[#183b5c]";

/**
 * A stored scope this page cannot read is reported, never rounded off to full
 * access behind the reader's back: the row renders a caution and the picker
 * starts from a deliberate choice the operator has to make and save.
 */
function readStoredScope(value: unknown): { scope: DataScope; readable: boolean } {
  try {
    return { scope: parseDataScope(value), readable: true };
  } catch {
    return { scope: {}, readable: false };
  }
}

async function listAllUsers(admin: ReturnType<typeof createAdminClient>) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`No se pudieron listar las cuentas: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 200) return users;
  }
}

export default async function ClientsPage({ searchParams }: { searchParams: Search }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: ownProfile } = await supabase.from("profiles").select("role")
    .eq("user_id", user.id).single<{ role: string }>();
  if (ownProfile?.role !== "internal") redirect("/dashboard");

  const admin = createAdminClient();
  const [{ data: tenants }, { data: profiles }, accounts, query] = await Promise.all([
    admin.from("tenant").select("id, name, brand_config").order("name").returns<Tenant[]>(),
    admin.from("profiles").select("user_id, tenant_id, full_name, data_scope")
      .eq("role", "client").order("created_at").returns<Profile[]>(),
    listAllUsers(admin),
    searchParams,
  ]);
  const tenantList = tenants ?? [];
  const profileList = profiles ?? [];
  const tenantById = new Map(tenantList.map((tenant) => [tenant.id, tenant]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  // Aggregate vocabulary for the access picker: characteristic names, their
  // values and how many people carry each combination. No respondent row, no
  // answer and no quote crosses into the browser.
  const scopeInventories = await loadTenantScopeInventories(
    admin,
    tenantList.map((tenant) => tenant.id),
  );
  const tenantChoices = tenantList.map((tenant) => ({ id: tenant.id, name: tenant.name }));
  // Archive state, so this legacy address never contradicts the client's own
  // page about whether a client still accepts new work.
  const archiveState = await loadTenantArchiveState(admin, tenantList.map((tenant) => tenant.id));

  return <StudioShell
    userEmail={user.email ?? ""}
    currentHref="/admin/clients"
    back={STUDIO_HOME}
    breadcrumb={["Studio", "Clientes y accesos"]}
    title="Clientes y accesos"
    lead="Quién es cliente, quién entra y qué puede ver cada persona."
    utility={<form action={logout}><button type="submit" className="min-h-11 rounded-lg border border-paper/40 px-3 py-1.5 text-sm font-medium text-paper transition-colors duration-[var(--motion-state)] hover:bg-paper/10">Cerrar sesión</button></form>}
  >
    <div className="space-y-9">
      {query.ok ? <p role="status" className="rounded-lg border border-positive-line bg-positive-surface px-4 py-3 text-sm text-positive">{query.ok}</p> : null}
      {query.error ? <p role="status" className="rounded-lg border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger">{query.error}</p> : null}

      <section className="grid gap-5 lg:grid-cols-2">
        <form action={createTenant} className="rounded-xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold text-strong">Nuevo cliente</h2><p className="mt-1 text-sm text-muted">Crea el espacio aislado antes de invitar personas.</p>
          <input className={`${input} mt-4`} name="name" required maxLength={160} placeholder="Nombre de la organización" />
          <button className={`${button} mt-3`}>Crear cliente</button>
        </form>
        <form action={inviteClientUser} className="rounded-xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold text-strong">Invitar usuario cliente</h2><p className="mt-1 mb-4 text-sm text-muted">Recibirá un correo para establecer su acceso.</p>
          <AccessScopeFields
            idPrefix="invitar"
            tenants={tenantChoices}
            inventories={scopeInventories}
            tenantPlaceholder="Selecciona cliente"
            submitLabel="Enviar invitación"
            submitClassName={`${button} mt-4 disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-sm font-medium text-strong">Correo<input className={`${input} mt-1 font-normal`} name="email" type="email" required placeholder="persona@cliente.com" /></label>
              <label className="text-sm font-medium text-strong">Nombre <span className="font-normal text-muted">(opcional)</span><input className={`${input} mt-1 font-normal`} name="full_name" maxLength={120} placeholder="Nombre de la persona" /></label>
            </div>
          </AccessScopeFields>
        </form>
      </section>

      <section><div className="flex items-end justify-between"><div><h2 className="text-xl font-semibold text-strong">Organizaciones</h2><p className="text-sm text-muted">{tenantList.length} clientes · {profileList.length} usuarios cliente</p></div></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">{tenantList.map(tenant => {
          const userCount = profileList.filter(profile => profile.tenant_id === tenant.id).length;
          const brand = parseBrandConfig(tenant.brand_config);
          const logoUrl = logoPublicUrl(brand.logoPath);
          return <article key={tenant.id} className="rounded-xl border border-line bg-surface p-4">
            <form action={renameTenant}><input type="hidden" name="tenant_id" value={tenant.id} /><div className="flex items-center gap-3"><input className={input} name="name" defaultValue={tenant.name} required maxLength={160} aria-label={`Nombre de ${tenant.name}`} /><button className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-strong">Guardar</button></div><p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">{userCount} {userCount === 1 ? "usuario" : "usuarios"}{archiveState.archivedAt[tenant.id] ? <span className="rounded-full border border-line bg-surface-sunken px-2 py-0.5 font-medium">Archivado</span> : null}</p></form>
            <Link href={studioClient(tenant.id)} className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-evidence underline-offset-4 hover:underline">Abrir el cliente <Forward /></Link>
            <details className="mt-4 border-t border-line pt-3"><summary className="min-h-11 cursor-pointer text-sm font-medium text-strong">Identidad visual</summary>
              <form action={updateTenantBrand} className="mt-4 space-y-3"><input type="hidden" name="tenant_id" value={tenant.id} />
                <div className="flex items-center gap-3">{logoUrl ? <>
                  {/* Dynamic tenant Storage URLs cannot use a static Next Image remote allowlist. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoUrl} alt={`Logotipo de ${tenant.name}`} width={72} height={48} className="h-12 w-18 rounded border bg-white object-contain p-1" />
                </> : <div className="flex h-12 w-18 items-center justify-center rounded border border-line bg-surface-sunken text-xs text-muted">Sin logo</div>}<div className="flex-1"><label className="text-xs font-medium">Logotipo</label><input className={`${input} mt-1`} name="logo" type="file" accept="image/png,image/jpeg,image/webp" /><p className="mt-1 text-[11px] text-muted">PNG, JPEG o WebP · máximo 1 MB</p></div></div>
                {logoUrl ? <label className="flex items-center gap-2 text-xs text-red-700"><input type="checkbox" name="remove_logo" /> Quitar logotipo actual</label> : null}
                <input className={input} name="display_name" maxLength={120} defaultValue={brand.displayName ?? ""} placeholder="Nombre visible (opcional)" />
                <input className={input} name="tagline" maxLength={180} defaultValue={brand.tagline} placeholder="Leyenda de marca" />
                <div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium">Color principal<input className="mt-1 h-10 w-full rounded border" name="primary_color" type="color" defaultValue={brand.primaryColor} /></label><label className="text-xs font-medium">Color de acento<input className="mt-1 h-10 w-full rounded border" name="accent_color" type="color" defaultValue={brand.accentColor} /></label></div>
                <button className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-strong">Guardar identidad</button>
              </form>
            </details>
          </article>;
        })}</div>
      </section>

      <section><h2 className="text-xl font-semibold text-strong">Usuarios cliente</h2><div className="mt-4 space-y-3">{profileList.length ? profileList.map(profile => {
        const account = accountById.get(profile.user_id);
        const address = account?.email ?? "Cuenta sin correo";
        const stored = readStoredScope(profile.data_scope);
        const restricted = Object.keys(stored.scope).length > 0;
        // Read from the Auth account itself, which is where suspension is
        // enforced, so this legacy address can never show "con acceso" for
        // somebody the authentication server is already refusing.
        const access = clientUserAccess({
          bannedUntil: account?.banned_until ?? null,
          lastSignInAt: account?.last_sign_in_at ?? null,
          emailConfirmedAt: account?.email_confirmed_at ?? null,
        });
        return <details key={profile.user_id} className="rounded-xl border border-line bg-surface p-5 open:shadow-raised">
          <summary className="min-h-11 cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium text-strong">{profile.full_name || address}</p><p className="text-sm text-muted">{address} · {tenantById.get(profile.tenant_id ?? "")?.name ?? "Sin cliente"}</p></div><div className="flex shrink-0 flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${access === "suspended" ? "border-danger-line bg-danger-surface text-danger" : access === "invited" ? "border-caution-line bg-caution-surface text-caution" : "border-positive-line bg-positive-surface text-positive"}`}>{CLIENT_USER_ACCESS_LABEL[access]}</span><span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${!stored.readable ? "border-danger-line bg-danger-surface text-danger" : restricted ? "border-caution-line bg-caution-surface text-caution" : "border-line bg-surface-sunken text-muted"}`}>{!stored.readable ? "Acceso por revisar" : restricted ? "Ve solo una parte" : "Ve todo el cliente"}</span></div></div></summary>
          <div className="mt-5 grid gap-5 border-t pt-5 lg:grid-cols-[1fr_280px]">
            <form action={updateClientUser} className="space-y-3">
              <input type="hidden" name="user_id" value={profile.user_id} />
              {stored.readable ? null : <p role="status" className="rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-sm text-danger">No se pudo leer el acceso guardado de esta persona. Elige de nuevo qué podrá ver y guarda.</p>}
              <AccessScopeFields
                idPrefix={`usuario-${profile.user_id}`}
                tenants={tenantChoices}
                inventories={scopeInventories}
                initialTenantId={profile.tenant_id ?? ""}
                initialScope={stored.scope}
                submitLabel="Guardar usuario"
                submitClassName={`${button} mt-4 sm:w-fit disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <label className="mt-3 block text-sm font-medium text-strong">Nombre<input className={`${input} mt-1 font-normal`} name="full_name" defaultValue={profile.full_name ?? ""} maxLength={120} placeholder="Nombre de la persona" /></label>
              </AccessScopeFields>
            </form>
            <div className="space-y-3">
              <div className="rounded-lg border border-line bg-surface-sunken p-4">
                <h3 className="text-sm font-semibold text-strong">Suspender o eliminar</h3>
                <p className="mt-1 text-xs text-muted">Suspender es reversible y quita el acceso al instante. Eliminar destruye la cuenta.</p>
                <Link href={studioClient(profile.tenant_id ?? "")} className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-evidence underline-offset-4 hover:underline">Ir a la página del cliente <Forward /></Link>
              </div>
              <form action={deleteClientUser} className="rounded-lg border border-danger-line bg-danger-surface p-4"><input type="hidden" name="user_id" value={profile.user_id} /><h3 className="text-sm font-semibold text-danger">Eliminar acceso</h3><p className="mt-1 text-xs text-danger">Elimina la cuenta, no los estudios. Escribe el correo exacto.</p><input className={`${input} mt-3`} name="confirmation_email" type="email" required placeholder={address} autoComplete="off" aria-label={`Correo exacto de ${address}`} /><button className="mt-3 min-h-11 text-sm font-semibold text-danger underline underline-offset-4">Eliminar cuenta cliente</button></form>
            </div>
          </div>
        </details>;
      }) : <p className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-muted">Todavía no hay usuarios cliente.</p>}</div></section>
    </div>
  </StudioShell>;
}
