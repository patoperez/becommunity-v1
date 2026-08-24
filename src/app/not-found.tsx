import { ActionLink } from "@/components/Actions";
import { PageState } from "@/components/States";

export const metadata = { title: "No encontramos esa página" };

export default function NotFound() {
  return (
    <PageState
      kicker="No encontrado"
      title="Esa página no existe o ya no está disponible"
      action={<ActionLink href="/dashboard">Ir al inicio</ActionLink>}
    >
      <p>
        Puede que el enlace haya cambiado, o que el estudio al que apunta todavía
        no esté publicado. Desde el inicio verás todo lo que sí está disponible
        para ti.
      </p>
    </PageState>
  );
}
