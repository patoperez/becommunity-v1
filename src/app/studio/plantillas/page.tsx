import { StudioShell } from "@/components/shell/StudioShell";
import { STUDIO_HOME } from "@/components/shell/BackLink";
import { logout } from "@/app/dashboard/actions";
import { requireInternal } from "@/lib/studio/guard";
import {
  createStudyFromTemplate,
  deleteTemplate,
  saveStudyAsTemplate,
  updateTemplateMetadata,
} from "@/app/admin/studies/actions";
import { ConfirmAction } from "@/components/studio/ConfirmAction";
import { Flash } from "@/components/studio/Flash";
import { StateBlock } from "@/components/States";
import { loadTenantArchiveState } from "@/lib/studio/lifecycle";
import { STUDIO_TEMPLATES } from "@/lib/studio/routes";

export const metadata = { title: "Plantillas · Be Community" };

type Search = Promise<{ ok?: string; error?: string }>;

const input =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";
const button =
  "min-h-11 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-[#183b5c]";

/**
 * The template library, on its own address.
 *
 * A template is described by WHAT IT BRINGS — how many results, how many
 * moments, whether it already knows how to read a file — rather than by a count
 * of internal objects. Nothing here asks for an identifier: a template is
 * chosen, a client is chosen, and the study is named in ordinary words.
 *
 * Template ownership is unchanged and still per-author: `/studio/plantillas`
 * shows the templates you saved. Sharing them across the team is a query and
 * permission change recorded as decision D5 and is not part of this unit.
 */
export default async function StudioTemplatesPage({ searchParams }: { searchParams: Search }) {
  const { user, admin } = await requireInternal();
  const query = await searchParams;

  const [{ data: tenants }, { data: templates }, { data: studies }] = await Promise.all([
    admin.from("tenant").select("id, name").order("name").returns<{ id: string; name: string }[]>(),
    admin
      .from("study_template")
      .select("id, name, description, version, preview, updated_at")
      .eq("created_by", user.id)
      .order("updated_at", { ascending: false })
      .returns<{
        id: string;
        name: string;
        description: string;
        version: number;
        preview: Record<string, number>;
        updated_at: string;
      }[]>(),
    admin
      .from("study")
      .select("id, name, period")
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<{ id: string; name: string; period: string | null }[]>(),
  ]);
  const tenantList = tenants ?? [];
  const templateList = templates ?? [];
  const archiveState = await loadTenantArchiveState(admin, tenantList.map((tenant) => tenant.id));
  const openTenants = tenantList.filter((tenant) => !archiveState.archivedAt[tenant.id]);

  return (
    <StudioShell
      userEmail={user.email ?? ""}
      currentHref="/studio/plantillas"
      back={STUDIO_HOME}
      breadcrumb={["Studio", "Plantillas"]}
      title="Plantillas"
      lead="Una configuración que ya funcionó, lista para volver a usarse. Solo se copia configuración: las respuestas y las citas nunca entran en una plantilla."
      headerAccent={{ surface: "var(--color-lavender-surface)", line: "var(--color-lavender-line)" }}
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

        <section aria-labelledby="biblioteca">
          <h2 id="biblioteca" className="text-xl">
            Tus plantillas
          </h2>
          {templateList.length === 0 ? (
            <div className="mt-3">
              <StateBlock title="Todavía no guardaste ninguna plantilla">
                <p>
                  Cuando un estudio quede como te gusta, guárdalo como plantilla abajo y podrás
                  empezar el siguiente desde ahí.
                </p>
              </StateBlock>
            </div>
          ) : (
            <ul className="mt-4 grid gap-4 lg:grid-cols-2">
              {templateList.map((template) => (
                <li key={template.id} className="flex flex-col rounded-xl border border-line bg-surface p-5">
                  <h3 className="break-words font-display text-lg font-semibold text-strong">
                    {template.name}
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    {template.description || "Sin descripción"}
                  </p>
                  <p className="mt-2 text-sm text-body">
                    Trae {template.preview.metrics ?? 0} resultado
                    {(template.preview.metrics ?? 0) === 1 ? "" : "s"}, {template.preview.dimensions ?? 0}{" "}
                    característica{(template.preview.dimensions ?? 0) === 1 ? "" : "s"} y{" "}
                    {(template.preview.mappings ?? 0) > 0
                      ? "ya sabe leer el formato del archivo."
                      : "todavía no sabe leer ningún formato de archivo."}
                  </p>

                  <form action={createStudyFromTemplate} className="mt-4 space-y-2 border-t border-line pt-4">
                    <input type="hidden" name="template_id" value={template.id} />
                    <p className="text-sm font-medium text-strong">Empezar un estudio con esta plantilla</p>
                    <select name="tenant_id" required className={input} aria-label="Cliente del nuevo estudio">
                      <option value="">Selecciona cliente</option>
                      {openTenants.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.name}
                        </option>
                      ))}
                    </select>
                    <input name="name" required maxLength={200} placeholder="Nombre del nuevo estudio" className={input} aria-label="Nombre del nuevo estudio" />
                    <input name="period" maxLength={100} placeholder="Periodo (opcional)" className={input} aria-label="Periodo del nuevo estudio" />
                    <button className={button}>Usar plantilla</button>
                  </form>

                  <details className="mt-4 border-t border-line pt-4">
                    <summary className="min-h-11 cursor-pointer text-sm font-medium text-muted">
                      Cambiar el nombre o eliminarla
                    </summary>
                    <form action={updateTemplateMetadata} className="mt-3 space-y-2">
                      <input type="hidden" name="template_id" value={template.id} />
                      <input type="hidden" name="return_to" value={STUDIO_TEMPLATES} />
                      <input name="name" defaultValue={template.name} required className={input} aria-label="Nombre de la plantilla" />
                      <textarea name="description" defaultValue={template.description} maxLength={1000} className={input} aria-label="Descripción de la plantilla" />
                      <button className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-strong hover:bg-surface-sunken">
                        Guardar nueva versión
                      </button>
                    </form>
                    <div className="mt-3">
                      <ConfirmAction
                        trigger="Eliminar esta plantilla"
                        title="Eliminar la plantilla"
                        objectName={`${template.name} · versión ${template.version}`}
                        severity="permanent"
                        consequence={
                          <p>
                            Desaparece de tu biblioteca y ya no se podrá empezar un estudio desde
                            ella.
                          </p>
                        }
                        recovery={
                          <p>
                            No se puede deshacer, pero los estudios que ya la usaron conservan su
                            propia copia y no cambian en nada. Puedes volver a guardar una plantilla
                            desde cualquiera de ellos.
                          </p>
                        }
                        acknowledgement="Entiendo que la plantilla se elimina y no se puede recuperar."
                        confirmLabel="Eliminar la plantilla"
                        action={deleteTemplate}
                        fields={{ template_id: template.id, return_to: STUDIO_TEMPLATES }}
                      />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="guardar"
          className="rounded-2xl border border-lavender-line bg-lavender-surface p-5 sm:p-6"
        >
          <h2 id="guardar" className="text-xl">
            Guardar un estudio como plantilla
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Solo se copia configuración. Las respuestas y las citas nunca entran en la plantilla.
          </p>
          <form action={saveStudyAsTemplate} className="mt-4 grid max-w-3xl gap-3 md:grid-cols-2">
            <input type="hidden" name="return_to" value={STUDIO_TEMPLATES} />
            <select name="study_id" required className={input} aria-label="Estudio de origen">
              <option value="">Selecciona estudio</option>
              {(studies ?? []).map((study) => (
                <option key={study.id} value={study.id}>
                  {study.name}
                  {study.period ? ` · ${study.period}` : ""}
                </option>
              ))}
            </select>
            <select name="template_id" className={input} aria-label="Plantilla de destino">
              <option value="">Crear plantilla nueva</option>
              {templateList.map((template) => (
                <option key={template.id} value={template.id}>
                  Sobrescribir “{template.name}” (v{template.version})
                </option>
              ))}
            </select>
            <input name="name" required maxLength={120} placeholder="Nombre de la plantilla" className={input} aria-label="Nombre de la plantilla" />
            <input name="description" maxLength={1000} placeholder="Descripción" className={input} aria-label="Descripción de la plantilla" />
            <button className={`${button} md:col-span-2 md:w-fit`}>Guardar como plantilla</button>
          </form>
        </section>
      </div>
    </StudioShell>
  );
}
