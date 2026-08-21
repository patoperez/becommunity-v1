import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createTenant, deleteClientUser, inviteClientUser, renameTenant, updateClientUser } from "./actions";

export const metadata = { title: "Clientes y usuarios · Be Community" };

type Search = Promise<{ ok?: string; error?: string }>;
type Tenant = { id: string; name: string };
type Profile = { user_id: string; tenant_id: string | null; full_name: string | null; data_scope: unknown };

const input = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";
const button = "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900";

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
    admin.from("tenant").select("id, name").order("name").returns<Tenant[]>(),
    admin.from("profiles").select("user_id, tenant_id, full_name, data_scope")
      .eq("role", "client").order("created_at").returns<Profile[]>(),
    listAllUsers(admin),
    searchParams,
  ]);
  const tenantList = tenants ?? [];
  const profileList = profiles ?? [];
  const tenantById = new Map(tenantList.map((tenant) => [tenant.id, tenant]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  return <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
    <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div><h1 className="text-lg font-semibold">Clientes y usuarios</h1><p className="text-xs text-zinc-500">Accesos, pertenencia y alcance de datos</p></div>
        <div className="flex flex-wrap gap-2"><Link className="rounded-lg border px-3 py-1.5 text-sm" href="/admin/studies">Estudios</Link><Link className="rounded-lg border px-3 py-1.5 text-sm" href="/admin/upload">Cargar datos</Link><Link className="rounded-lg border px-3 py-1.5 text-sm" href="/dashboard">Portal</Link></div>
      </div>
    </header>
    <main className="mx-auto max-w-7xl space-y-9 px-6 py-10">
      {query.ok ? <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{query.ok}</p> : null}
      {query.error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{query.error}</p> : null}

      <section className="grid gap-5 lg:grid-cols-2">
        <form action={createTenant} className="rounded-xl border bg-white p-6 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Nuevo cliente</h2><p className="mt-1 text-sm text-zinc-500">Crea el espacio aislado antes de invitar personas.</p>
          <input className={`${input} mt-4`} name="name" required maxLength={160} placeholder="Nombre de la organización" />
          <button className={`${button} mt-3`}>Crear cliente</button>
        </form>
        <form action={inviteClientUser} className="rounded-xl border bg-white p-6 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Invitar usuario cliente</h2><p className="mt-1 text-sm text-zinc-500">Recibirá un correo para establecer su acceso.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2"><select className={input} name="tenant_id" required><option value="">Selecciona cliente</option>{tenantList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><input className={input} name="email" type="email" required placeholder="persona@cliente.com" /><input className={`${input} sm:col-span-2`} name="full_name" maxLength={120} placeholder="Nombre (opcional)" /></div>
          <label className="mt-3 block text-xs font-medium text-zinc-600">Alcance JSON <span className="font-normal text-zinc-400">· vacío = todo el cliente</span></label>
          <textarea className={`${input} mt-1 font-mono text-xs`} name="data_scope" rows={3} defaultValue="{}" placeholder={'{"area":["Direccion"]}'} />
          <button className={`${button} mt-3`}>Enviar invitación</button>
        </form>
      </section>

      <section><div className="flex items-end justify-between"><div><h2 className="text-xl font-semibold">Organizaciones</h2><p className="text-sm text-zinc-500">{tenantList.length} clientes · {profileList.length} usuarios cliente</p></div></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">{tenantList.map(tenant => {
          const userCount = profileList.filter(profile => profile.tenant_id === tenant.id).length;
          return <form action={renameTenant} key={tenant.id} className="rounded-xl border bg-white p-4 dark:bg-zinc-900"><input type="hidden" name="tenant_id" value={tenant.id} /><div className="flex items-center gap-3"><input className={input} name="name" defaultValue={tenant.name} required maxLength={160} /><button className="rounded-lg border px-3 py-2 text-sm">Guardar</button></div><p className="mt-2 text-xs text-zinc-500">{userCount} {userCount === 1 ? "usuario" : "usuarios"}</p></form>;
        })}</div>
      </section>

      <section><h2 className="text-xl font-semibold">Usuarios cliente</h2><div className="mt-4 space-y-3">{profileList.length ? profileList.map(profile => {
        const account = accountById.get(profile.user_id);
        const address = account?.email ?? "Cuenta sin correo";
        const scope = JSON.stringify(profile.data_scope ?? {}, null, 2);
        return <details key={profile.user_id} className="rounded-xl border bg-white p-5 open:ring-1 open:ring-zinc-200 dark:bg-zinc-900 dark:open:ring-zinc-700">
          <summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{profile.full_name || address}</p><p className="text-sm text-zinc-500">{address} · {tenantById.get(profile.tenant_id ?? "")?.name ?? "Sin cliente"}</p></div><code className="rounded bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">{scope === "{}" ? "acceso completo" : "alcance limitado"}</code></div></summary>
          <div className="mt-5 grid gap-5 border-t pt-5 lg:grid-cols-[1fr_280px]">
            <form action={updateClientUser} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="user_id" value={profile.user_id} /><input className={input} name="full_name" defaultValue={profile.full_name ?? ""} maxLength={120} placeholder="Nombre" /><select className={input} name="tenant_id" defaultValue={profile.tenant_id ?? ""} required>{tenantList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><div className="sm:col-span-2"><label className="text-xs font-medium text-zinc-600">Alcance de datos</label><textarea className={`${input} mt-1 font-mono text-xs`} name="data_scope" rows={5} defaultValue={scope} /></div><button className={`${button} sm:w-fit`}>Guardar usuario</button></form>
            <form action={deleteClientUser} className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950"><input type="hidden" name="user_id" value={profile.user_id} /><h3 className="text-sm font-semibold text-red-800 dark:text-red-200">Eliminar acceso</h3><p className="mt-1 text-xs text-red-700 dark:text-red-300">Elimina la cuenta, no los estudios. Escribe el correo exacto.</p><input className={`${input} mt-3`} name="confirmation_email" type="email" required placeholder={address} autoComplete="off" /><button className="mt-3 text-sm font-medium text-red-700 underline dark:text-red-300">Eliminar cuenta cliente</button></form>
          </div>
        </details>;
      }) : <p className="rounded-xl border bg-white p-8 text-center text-sm text-zinc-500 dark:bg-zinc-900">Todavía no hay usuarios cliente.</p>}</div></section>
    </main>
  </div>;
}
