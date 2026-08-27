import Link from "next/link";
import { StudioShell } from "@/components/shell/StudioShell";
import { STUDIO_HOME } from "@/components/shell/BackLink";
import { logout } from "@/app/dashboard/actions";
import { requireInternal } from "@/lib/studio/guard";
import { createTenant } from "@/app/admin/clients/actions";
import { Flash } from "@/components/studio/Flash";
import { Pager } from "@/components/studio/Pager";
import { StateBlock } from "@/components/States";
import { Forward } from "@/components/Actions";
import { loadTenantArchiveState } from "@/lib/studio/lifecycle";
import {
  TENANT_LIFECYCLE_LABEL,
  tenantLifecycle,
} from "@/lib/studio/lifecycle-model";
import { parseChoice, pageHref, parsePageRequest, resolvePage } from "@/lib/studio/paging";
import { STUDIO_CLIENTS, studioClient } from "@/lib/studio/routes";

export const metadata = { title: "Clientes y accesos · Be Community" };

type Search = Promise<{ ok?: string; error?: string; estado?: string; p?: string; por?: string }>;

const LIFECYCLE_FILTERS = ["activos", "archivados"] as const;

const FILTER_ON =
  "inline-flex min-h-11 items-center rounded-lg border border-evidence-line bg-evidence-surface px-3 py-2 text-sm font-semibold text-strong";
const FILTER_OFF =
  "inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-body hover:bg-surface-sunken";

const input =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";

/**
 * The clients, as a list you can find something in.
 *
 * `/admin/clients` stacked five jobs on one page: create a client, invite a
 * person, rename, brand and scope. This is the first job only — find a client —
 * and everything about ONE client happens on that client's own page.
 *
 * Filtering by archived state is deliberately visible rather than implicit: an
 * archived client stays findable, because "we no longer work with them" is not
 * "they never existed".
 */
export default async function StudioClientsPage({ searchParams }: { searchParams: Search }) {
  const { user, admin } = await requireInternal();
  const query = await searchParams;

  const [{ data: tenants, error }, { data: profiles }, { data: studies }] = await Promise.all([
    admin.from("tenant").select("id, name").order("name").returns<{ id: string; name: string }[]>(),
    admin.from("profiles").select("tenant_id").eq("role", "client")
      .returns<{ tenant_id: string | null }[]>(),
    admin.from("study").select("tenant_id").returns<{ tenant_id: string }[]>(),
  ]);
  if (error) throw new Error(`tenant: ${error.message}`);
  const tenantList = tenants ?? [];
  const archiveState = await loadTenantArchiveState(admin, tenantList.map((tenant) => tenant.id));

  const userCount = new Map<string, number>();
  for (const profile of profiles ?? []) {
    if (!profile.tenant_id) continue;
    userCount.set(profile.tenant_id, (userCount.get(profile.tenant_id) ?? 0) + 1);
  }
  const studyCount = new Map<string, number>();
  for (const study of studies ?? []) {
    studyCount.set(study.tenant_id, (studyCount.get(study.tenant_id) ?? 0) + 1);
  }

  const filter = parseChoice(query.estado, LIFECYCLE_FILTERS);
  const filtered = tenantList.filter((tenant) => {
    const archived = Boolean(archiveState.archivedAt[tenant.id]);
    if (filter === "activos") return !archived;
    if (filter === "archivados") return archived;
    return true;
  });
  const view = resolvePage(parsePageRequest(query), filtered.length);
  const page = filtered.slice(view.from, view.from + view.size);
  const filters = { estado: filter, por: query.por ?? null };
  const archivedCount = tenantList.filter((tenant) => archiveState.archivedAt[tenant.id]).length;

  return (
    <StudioShell
      userEmail={user.email ?? ""}
      currentHref="/studio/clientes"
      back={STUDIO_HOME}
      breadcrumb={["Studio", "Clientes y accesos"]}
      title="Clientes y accesos"
      lead="Quién es cliente, quién entra y qué puede ver cada persona."
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
      <div className="space-y-6">
        <Flash ok={query.ok} error={query.error} />

        <form action={createTenant} className="rounded-xl border border-line bg-surface p-5">
          <input type="hidden" name="return_to" value={STUDIO_CLIENTS} />
          <h2 className="text-base font-semibold text-strong">Nuevo cliente</h2>
          <p className="mt-1 text-sm text-muted">
            Crea el espacio aislado antes de invitar personas. Cada cliente ve solo lo suyo.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-[16rem] flex-1 text-sm font-medium text-strong">
              Nombre de la organización
              <input className={`${input} mt-1 font-normal`} name="name" required maxLength={160} />
            </label>
            <button className="min-h-11 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c]">
              Crear cliente
            </button>
          </div>
        </form>

        {archivedCount > 0 || filter !== null ? (
          <section aria-label="Filtros" className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Mostrando:</span>
            <Link href={pageHref(STUDIO_CLIENTS, { ...filters, estado: null }, 1)} className={filter === null ? FILTER_ON : FILTER_OFF}>
              Todos ({tenantList.length})
            </Link>
            <Link href={pageHref(STUDIO_CLIENTS, { ...filters, estado: "activos" }, 1)} className={filter === "activos" ? FILTER_ON : FILTER_OFF}>
              Activos ({tenantList.length - archivedCount})
            </Link>
            <Link href={pageHref(STUDIO_CLIENTS, { ...filters, estado: "archivados" }, 1)} className={filter === "archivados" ? FILTER_ON : FILTER_OFF}>
              Archivados ({archivedCount})
            </Link>
          </section>
        ) : null}

        {view.total === 0 ? (
          <StateBlock title="Ningún cliente coincide">
            <p>
              {filter
                ? "Quita el filtro para ver los demás."
                : "Todavía no hay clientes. Crea el primero arriba."}
            </p>
          </StateBlock>
        ) : (
          <>
            <ul className="grid gap-3 md:grid-cols-2">
              {page.map((tenant) => {
                const lifecycle = tenantLifecycle(archiveState.archivedAt[tenant.id]);
                const users = userCount.get(tenant.id) ?? 0;
                const clientStudies = studyCount.get(tenant.id) ?? 0;
                return (
                  <li key={tenant.id}>
                    <Link
                      href={studioClient(tenant.id)}
                      className="flex h-full flex-col rounded-xl border border-line bg-surface p-5 transition-colors duration-[var(--motion-state)] hover:border-line-strong hover:bg-surface-sunken/40"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 break-words font-display text-lg font-semibold text-strong">
                          {tenant.name}
                        </span>
                        {lifecycle === "archived" ? (
                          <span className="rounded-full border border-line bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-muted">
                            {TENANT_LIFECYCLE_LABEL.archived}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 text-sm text-muted">
                        {users} {users === 1 ? "persona con acceso" : "personas con acceso"} ·{" "}
                        {clientStudies} {clientStudies === 1 ? "estudio" : "estudios"}
                      </span>
                      <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-evidence">
                        Abrir el cliente <Forward />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Pager
              window={view}
              basePath={STUDIO_CLIENTS}
              params={filters}
              noun={{ one: "cliente", many: "clientes" }}
              label="Paginación de clientes"
            />
          </>
        )}
      </div>
    </StudioShell>
  );
}
