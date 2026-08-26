"use client";

import { useEffect } from "react";
import { StateBlock } from "@/components/States";

export default function InsightsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="contenido" className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6">
      <StateBlock
        tone="danger"
        title="No pudimos abrir tus resultados"
        action={
          <button
            type="button"
            onClick={reset}
            className="min-h-11 rounded-lg border border-danger-line bg-surface px-4 py-2.5 text-sm font-semibold text-danger"
          >
            Reintentar
          </button>
        }
      >
        <p>Tu información sigue protegida. Intenta de nuevo o vuelve al inicio de Insights.</p>
      </StateBlock>
    </main>
  );
}

