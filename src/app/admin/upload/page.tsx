import Link from "next/link";
import { redirect } from "next/navigation";
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
      <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
        <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-900 dark:bg-red-950">
          <h1 className="text-lg font-semibold text-red-800 dark:text-red-200">Acceso denegado</h1>
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">
            Esta sección es solo para el equipo interno de Be Community.
          </p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-red-800 underline dark:text-red-200">
            Volver al portal
          </Link>
        </div>
      </div>
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

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Cargar datos de estudio</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Equipo interno · Be Community</p>
        </div>
        <Link
          href="/dashboard"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Volver
        </Link>
      </header>

      <main id="contenido" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <UploadForm
          tenants={tenants ?? []}
          studies={studyOptions}
          history={history}
          initialTenantId={query.tenant}
          initialStudyId={query.study}
        />
      </main>
    </div>
  );
}
