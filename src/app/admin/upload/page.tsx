import Link from "next/link";
import { redirect } from "next/navigation";
import { StudioShell } from "@/components/shell/StudioShell";
import { STUDIO_HOME, STUDIES_LIST } from "@/components/shell/BackLink";
import { logout } from "@/app/dashboard/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import UploadForm, {
  type ImportHistoryItem,
  type StudyOption,
  type TenantOption,
} from "./UploadForm";

export const metadata = { title: "Cargar datos · Be Community" };

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; study?: string }>;
}) {
  // Server-side authorization (§6.4) — not just hiding the link in the UI.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single<{ role: string }>();

  if (profile?.role !== "internal") {
    return (
      <main id="contenido" className="flex flex-1 items-center justify-center bg-surface-page px-4">
        <div className="max-w-md rounded-xl border border-danger-line bg-danger-surface p-8 text-center">
          <h1 className="text-lg font-semibold text-danger">Acceso denegado</h1>
          <p className="mt-2 text-sm text-danger">
            Esta sección es solo para el equipo interno de Be Community.
          </p>
          <Link href="/dashboard" className="mt-4 inline-block min-h-11 text-sm font-semibold text-danger underline underline-offset-4">
            Volver al portal
          </Link>
        </div>
      </main>
    );
  }

  // Internal users have no tenant, so the tenant list is fetched with the admin
  // client (server-only, §6.3) after the role check above.
  const admin = createAdminClient();
  const [{ data: tenants }, { data: studies }, { data: batches }] = await Promise.all([
    admin
      .from("tenant")
      .select("id, name")
      .order("name")
      .returns<TenantOption[]>(),
    admin
      .from("study")
      .select("id, tenant_id, name, period")
      .order("created_at", { ascending: false })
      .returns<{ id: string; tenant_id: string; name: string; period: string | null }[]>(),
    admin
      .from("import_batch")
      .select("id, tenant_id, study_id, file_name, status, expected_respondents, expected_quant, expected_qual, created_at, committed_at")
      .order("created_at", { ascending: false })
      .limit(30)
      .returns<{
        id: string;
        tenant_id: string;
        study_id: string;
        file_name: string;
        status: ImportHistoryItem["status"];
        expected_respondents: number;
        expected_quant: number;
        expected_qual: number;
        created_at: string;
        committed_at: string | null;
      }[]>(),
  ]);

  const query = await searchParams;
  const tenantNames = new Map((tenants ?? []).map((tenant) => [tenant.id, tenant.name]));
  const studyNames = new Map((studies ?? []).map((study) => [study.id, study.name]));
  const studyOptions: StudyOption[] = (studies ?? []).map((study) => ({
    id: study.id,
    tenantId: study.tenant_id,
    name: study.name,
    period: study.period,
  }));
  const history: ImportHistoryItem[] = (batches ?? []).map((batch) => ({
    id: batch.id,
    tenantName: tenantNames.get(batch.tenant_id) ?? "Cliente eliminado",
    studyName: studyNames.get(batch.study_id) ?? "Estudio eliminado",
    fileName: batch.file_name,
    status: batch.status,
    respondents: batch.expected_respondents,
    quant: batch.expected_quant,
    qual: batch.expected_qual,
    createdAt: batch.created_at,
    committedAt: batch.committed_at,
  }));

  // The parent is wherever a real study context came from. Arriving with a
  // study or client already chosen means the operator came from the study list,
  // so that is where "up" goes; otherwise the parent is the Studio home.
  const cameFromAStudy = Boolean(query.study || query.tenant);

  return (
    <StudioShell
      userEmail={user.email ?? ""}
      currentHref="/admin/upload"
      back={cameFromAStudy ? STUDIES_LIST : STUDIO_HOME}
      breadcrumb={["Studio", "Carga de datos"]}
      title="Cargar datos de estudio"
      lead="Trae un archivo, revisa cómo se va a leer y confírmalo. Nada se escribe hasta el último paso, y una carga confirmada se puede revertir."
      utility={<form action={logout}><button type="submit" className="min-h-11 rounded-lg border border-paper/40 px-3 py-1.5 text-sm font-medium text-paper transition-colors duration-[var(--motion-state)] hover:bg-paper/10">Cerrar sesión</button></form>}
    >
      <UploadForm
        tenants={tenants ?? []}
        studies={studyOptions}
        history={history}
        initialTenantId={query.tenant}
        initialStudyId={query.study}
      />
    </StudioShell>
  );
}
