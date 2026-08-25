import { StudioShell } from "@/components/shell/StudioShell";
import { StudioHomeView } from "@/components/studio/StudioHomeView";
import { logout } from "@/app/dashboard/actions";
import { requireInternal } from "@/lib/studio/guard";

export const metadata = { title: "Studio · Be Community" };

/**
 * Be Community Studio — home.
 *
 * `/dashboard` still answers for internal staff and renders the same view, so
 * a bookmark from before this route existed lands on the same product. This is
 * the address the navigation, the back controls and every new link use.
 */
export default async function StudioHomePage() {
  const { user } = await requireInternal();
  return (
    <StudioShell
      userEmail={user.email ?? ""}
      currentHref="/studio"
      breadcrumb={["Studio", "Inicio"]}
      title="Tu espacio de trabajo"
      lead="Desde aquí preparas, revisas y publicas los estudios de cada cliente. Nada llega a un cliente hasta que se publica."
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
      <StudioHomeView />
    </StudioShell>
  );
}
