import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import UploadForm from "./UploadForm";

export const metadata = { title: "Cargar datos · Be Community" };

export default async function UploadPage() {
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
  const { data: tenants } = await admin
    .from("tenant")
    .select("id, name")
    .order("name")
    .returns<{ id: string; name: string }[]>();

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

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <UploadForm tenants={tenants ?? []} />
      </main>
    </div>
  );
}
