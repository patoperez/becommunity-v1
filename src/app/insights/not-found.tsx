import Link from "next/link";
import { StateBlock } from "@/components/States";

export default function InsightsNotFound() {
  return (
    <main id="contenido" className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6">
      <StateBlock
        title="Este estudio no está disponible"
        action={
          <Link
            href="/insights"
            className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong"
          >
            Volver a Insights
          </Link>
        }
      >
        <p>Puede que haya cambiado de estado o que el enlace ya no corresponda a tu acceso.</p>
      </StateBlock>
    </main>
  );
}

