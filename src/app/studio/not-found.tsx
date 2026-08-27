import { ActionLink } from "@/components/Actions";
import { PageState } from "@/components/States";
import { STUDIO_ROOT, STUDIO_STUDIES } from "@/lib/studio/routes";

export const metadata = { title: "No encontramos eso en Studio" };

/**
 * Studio's own absence state.
 *
 * The root `not-found` speaks to a client ("puede que el estudio todavía no
 * esté publicado"), which is the wrong explanation for internal staff: a
 * consultant reaching a dead Studio link has usually followed a URL to a study
 * or a client that was deleted, and the way forward is a list, not the portal.
 */
export default function StudioNotFound() {
  return (
    <PageState
      kicker="No encontrado"
      title="Eso ya no está en Studio"
      action={
        <>
          <ActionLink href={STUDIO_STUDIES}>Ver los estudios</ActionLink>
          <ActionLink href={STUDIO_ROOT} variant="secondary">
            Ir al inicio de Studio
          </ActionLink>
        </>
      }
    >
      <p>
        El estudio o el cliente al que apunta este enlace ya no existe, o la dirección está
        incompleta. Desde las listas puedes encontrar lo que sí está.
      </p>
    </PageState>
  );
}
