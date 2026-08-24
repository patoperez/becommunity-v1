import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createTenant, deleteClientUser, inviteClientUser, renameTenant, updateClientUser, updateTenantBrand } from "./actions";
import { logoPublicUrl, parseBrandConfig } from "@/lib/branding/config";
import { StudioShell } from "@/components/shell/StudioShell";
import { STUDIO_HOME } from "@/components/shell/BackLink";
import { logout } from "@/app/dashboard/actions";

export const metadata = { title: "Clientes y usuarios · Be Community" };

type Search = Promise<{ ok?: string; error?: string }>;
type Tenant = { id: string; name: string; brand_config: unknown };
type Profile = { user_id: string; tenant_id: string | null; full_name: string | null; data_scope: unknown };

const input =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";
const button =
  "min-h-11 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-[#183b5c]";

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
          <h2 className="text-lg font-semibold text-strong">Invitar usuario cliente</h2><p className="mt-1 text-sm text-muted">Recibirá un correo para establecer su acceso.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2"><select className={input} name="tenant_id" required><option value="">Selecciona cliente</option>{tenantList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><input className={input} name="email" type="email" required placeholder="persona@cliente.com" /><input className={`${input} sm:col-span-2`} name="full_name" maxLength={120} placeholder="Nombre (opcional)" /></div>
          <label className="mt-3 block text-xs font-medium text-muted">Alcance JSON <span className="font-normal text-muted">· vacío = todo el cliente</span></label>
          <textarea className={`${input} mt-1 font-mono text-xs`} name="data_scope" rows={3} defaultValue="{}" placeholder={'{"area":["Direccion"]}'} />
          <button className={`${button} mt-3`}>Enviar invitación</button>
        </form>
      </section>

      <section><div className="flex items-end justify-between"><div><h2 className="text-xl font-semibold text-strong">Organizaciones</h2><p className="text-sm text-muted">{tenantList.length} clientes · {profileList.length} usuarios cliente</p></div></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">{tenantList.map(tenant => {
          const userCount = profileList.filter(profile => profile.tenant_id === tenant.id).length;
          const brand = parseBrandConfig(tenant.brand_config);
          const logoUrl = logoPublicUrl(brand.logoPath);
          return <article key={tenant.id} className="rounded-xl border border-line bg-surface p-4">
            <form action={renameTenant}><input type="hidden" name="tenant_id" value={tenant.id} /><div className="flex items-center gap-3"><input className={input} name="name" defaultValue={tenant.name} required maxLength={160} /><button className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-strong">Guardar</button></div><p className="mt-2 text-xs text-muted">{userCount} {userCount === 1 ? "usuario" : "usuarios"}</p></form>
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
        const scope = JSON.stringify(profile.data_scope ?? {}, null, 2);
        return <details key={profile.user_id} className="rounded-xl border border-line bg-surface p-5 open:shadow-raised">
          <summary className="min-h-11 cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium text-strong">{profile.full_name || address}</p><p className="text-sm text-muted">{address} · {tenantById.get(profile.tenant_id ?? "")?.name ?? "Sin cliente"}</p></div><code className="rounded bg-surface-sunken px-2 py-1 text-xs text-muted">{scope === "{}" ? "acceso completo" : "alcance limitado"}</code></div></summary>
          <div className="mt-5 grid gap-5 border-t pt-5 lg:grid-cols-[1fr_280px]">
            <form action={updateClientUser} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="user_id" value={profile.user_id} /><input className={input} name="full_name" defaultValue={profile.full_name ?? ""} maxLength={120} placeholder="Nombre" /><select className={input} name="tenant_id" defaultValue={profile.tenant_id ?? ""} required>{tenantList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><div className="sm:col-span-2"><label className="text-xs font-medium text-muted">Alcance de datos</label><textarea className={`${input} mt-1 font-mono text-xs`} name="data_scope" rows={5} defaultValue={scope} /></div><button className={`${button} sm:w-fit`}>Guardar usuario</button></form>
            <form action={deleteClientUser} className="rounded-lg border border-danger-line bg-danger-surface p-4"><input type="hidden" name="user_id" value={profile.user_id} /><h3 className="text-sm font-semibold text-danger">Eliminar acceso</h3><p className="mt-1 text-xs text-danger">Elimina la cuenta, no los estudios. Escribe el correo exacto.</p><input className={`${input} mt-3`} name="confirmation_email" type="email" required placeholder={address} autoComplete="off" /><button className="mt-3 min-h-11 text-sm font-semibold text-danger underline underline-offset-4">Eliminar cuenta cliente</button></form>
          </div>
        </details>;
      }) : <p className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-muted">Todavía no hay usuarios cliente.</p>}</div></section>
    </div>
  </StudioShell>;
}
