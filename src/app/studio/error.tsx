"use client";

import { useEffect } from "react";
import Link from "next/link";
import { primaryAction, secondaryAction } from "@/components/Actions";
import { PageState } from "@/components/States";

export default function StudioError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <PageState
      kicker="Studio"
      title="No pudimos abrir esta parte del trabajo"
      action={<><button type="button" onClick={reset} className={primaryAction}>Reintentar</button><Link href="/studio" className={secondaryAction}>Volver al inicio de Studio</Link></>}
    >
      <p>Lo que ya guardaste sigue intacto. Reintenta ahora; si vuelve a ocurrir, comparte con el equipo en qué paso estabas.</p>
    </PageState>
  );
}
