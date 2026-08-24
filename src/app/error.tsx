"use client";

import Link from "next/link";
import { primaryAction, secondaryAction } from "@/components/Actions";
import { PageState } from "@/components/States";

/**
 * The application error boundary. Before P8 an unhandled server error reached
 * the user as the framework's own default screen — in English, with no way back
 * into the product.
 *
 * `error` is deliberately not rendered: it can carry internal detail, and the
 * adversarial input suite asserts that refusals leak no internal detail class.
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <PageState
      kicker="Algo falló"
      title="No pudimos cargar esta parte"
      action={
        <>
          <button type="button" onClick={reset} className={primaryAction}>
            Reintentar
          </button>
          <Link href="/dashboard" className={secondaryAction}>
            Volver al inicio
          </Link>
        </>
      }
    >
      <p>
        El problema es nuestro, no de lo que hiciste. Puedes reintentar ahora
        mismo; si vuelve a ocurrir, avísale al equipo de Be Community.
      </p>
    </PageState>
  );
}
