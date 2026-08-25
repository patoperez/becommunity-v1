import Link from "next/link";
import { StudioShell } from "@/components/shell/StudioShell";
import { STUDIO_HOME } from "@/components/shell/BackLink";
import { logout } from "@/app/dashboard/actions";
import { requireInternal } from "@/lib/studio/guard";
import { Flash } from "@/components/studio/Flash";
import { Pager } from "@/components/studio/Pager";
import { StateBlock } from "@/components/States";
import { Forward } from "@/components/Actions";
import { studyStateLabel } from "@/lib/language/results";
import { loadTenantArchiveState } from "@/lib/studio/lifecycle";
import { parseChoice, parsePageRequest, pageHref, resolvePage } from "@/lib/studio/paging";
import { STUDIO_STUDIES, STUDIO_TEMPLATES, studioStudy } from "@/lib/studio/routes";

export const metadata = { title: "Estudios · Be Community" };

type Search = Promise<{
  ok?: string;
  error?: string;
  cliente?: string;
  estado?: string;
  p?: string;
  por?: string;
}>;

const STUDY_STATES = ["draft", "published", "archived"] as const;

const FILTER_ON =
  "inline-flex min-h-11 items-center rounded-lg border border-evidence-line bg-evidence-surface px-3 py-2 text-sm font-semibold text-strong";
const FILTER_OFF =
  "inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-body hover:bg-surface-sunken";

/**
 * Every study, filterable and paged.
 *
 * `/admin/studies` did five jobs on one page and rendered an open-ended
 * configurator for every study in the database. This is one job — find a study
 * and open it — with the two filters a consultant actually uses (whose study,
 * and what state it is in) and real paging.
 *
 * BOTH FILTERS ARE VALIDATED AGAINST WHAT THE SERVER OFFERED. A client id is
 * accepted only when it is one of the clients this query already listed, and a
 * state only when it is one of the three the schema allows, so a hand-typed URL
 * can narrow the list and can never widen it.
 */
export default async function StudioStudiesPage({ searchParams }: { searchParams: Search }) {
  const { user, admin } = await requireInternal();
  const query = await searchParams;

  const { data: tenants, error: tenantError } = await admin
    .from("tenant")
    .select("id, name")
    .order("name")
    .returns<{ id: string; name: string }[]>();
  if (tenantError) throw new Error(`tenant: ${tenantError.message}`);
  const tenantList = tenants ?? [];
  const archiveState = await loadTenantArchiveState(admin, tenantList.map((tenant) => tenant.id));

  const client = parseChoice(query.cliente, tenantList.map((tenant) => tenant.id));
  const state = parseChoice(query.estado, STUDY_STATES);

  const countQuery = admin.from("study").select("id", { count: "exact", head: true });
  const { count, error: countError } = await applyFilters(countQuery, client, state);
  if (countError) throw new Error(`study count: ${countError.message}`);
  const view = resolvePage(parsePageRequest(query), count ?? 0);

  const listQuery = admin.from("study").select("id, tenant_id, name, period, status, created_at");
  const { data: studies, error } = await applyFilters(listQuery, client, state)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(view.from, view.to)
    .returns<{
      id: string;
      tenant_id: string;
      name: string;
      period: string | null;
      status: string;
      created_at: string;
    }[]>();
  if (error) throw new Error(`study: ${error.message}`);

  const tenantName = new Map(tenantList.map((tenant) => [tenant.id, tenant.name]));
  const filters = { cliente: client, estado: state, por: query.por ?? null };

  return (
    <StudioShell
      userEmail={user.email ?? ""}
      currentHref="/studio/estudios"
      back={STUDIO_HOME}
      breadcrumb={["Studio", "Estudios"]}
      title="Estudios"
      lead="Abre un estudio para prepararlo, revisarlo y decidir su publicación."
      headerAccent={{ surface: "var(--color-sky-surface)", line: "var(--color-sky-line)" }}
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

        <section className="flex flex-wrap gap-3 rounded-xl border border-line bg-surface p-4">
          <Link
            href="/admin/studies"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c]"
          >
            Comenzar un estudio <Forward />
          </Link>
          <Link
            href={STUDIO_TEMPLATES}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken"
          >
            Ver plantillas <Forward />
          </Link>
        </section>

        <section aria-label="Filtros" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Estado:</span>
            <Link href={pageHref(STUDIO_STUDIES, { ...filters, estado: null }, 1)} className={state === null ? FILTER_ON : FILTER_OFF}>
              Todos
            </Link>
            {STUDY_STATES.map((value) => (
              <Link
                key={value}
                href={pageHref(STUDIO_STUDIES, { ...filters, estado: value }, 1)}
                className={state === value ? FILTER_ON : FILTER_OFF}
              >
                {studyStateLabel(value)}
              </Link>
            ))}
          </div>
          {tenantList.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">Cliente:</span>
              <Link href={pageHref(STUDIO_STUDIES, { ...filters, cliente: null }, 1)} className={client === null ? FILTER_ON : FILTER_OFF}>
                Todos
              </Link>
              {tenantList.map((tenant) => (
                <Link
                  key={tenant.id}
                  href={pageHref(STUDIO_STUDIES, { ...filters, cliente: tenant.id }, 1)}
                  className={client === tenant.id ? FILTER_ON : FILTER_OFF}
                >
                  {tenant.name}
                  {archiveState.archivedAt[tenant.id] ? " · archivado" : ""}
                </Link>
              ))}
            </div>
          ) : null}
        </section>

        {view.total === 0 ? (
          <StateBlock title="Ningún estudio coincide">
            <p>
              {client || state
                ? "Quita alguno de los filtros para ver más."
                : "Todavía no hay ningún estudio. Empieza creando uno."}
            </p>
          </StateBlock>
        ) : (
          <>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {(studies ?? []).map((study) => (
                <li
                  key={study.id}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5 sm:px-5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                        study.status === "published"
                          ? "border-positive-line bg-positive-surface text-positive"
                          : study.status === "archived"
                            ? "border-line bg-surface-sunken text-muted"
                            : "border-caution-line bg-caution-surface text-caution"
                      }`}
                    >
                      {studyStateLabel(study.status)}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words font-medium text-strong">{study.name}</p>
                      <p className="text-sm text-muted">
                        {tenantName.get(study.tenant_id) ?? "Cliente eliminado"}
                        {study.period ? ` · ${study.period}` : ""}
                      </p>
                    </div>
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
            <Pager
              window={view}
              basePath={STUDIO_STUDIES}
              params={filters}
              noun={{ one: "estudio", many: "estudios" }}
              label="Paginación de estudios"
            />
          </>
        )}
      </div>
    </StudioShell>
  );
}

/** The two filters, applied identically to the count and to the page. */
function applyFilters<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  client: string | null,
  state: string | null,
): T {
  let next = query;
  if (client) next = next.eq("tenant_id", client);
  if (state) next = next.eq("status", state);
  return next;
}
