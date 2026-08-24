import { SkeletonLine } from "@/components/States";

/**
 * The dashboard loads a study's rows and recomputes its aggregates server-side,
 * so the first paint is not instant. Before P8 the reader saw nothing at all
 * while that happened.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-1 flex-col bg-surface-page">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-5 py-4 sm:px-6">
          <SkeletonLine className="h-11 w-11 rounded-lg" />
          <SkeletonLine className="h-4 w-40" />
        </div>
      </div>
      <main id="contenido" className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:px-6 sm:py-11">
        <p role="status" className="sr-only">
          Cargando tus resultados…
        </p>
        <SkeletonLine className="h-48 w-full rounded-2xl" />
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonLine className="h-52 rounded-xl" />
          <SkeletonLine className="h-52 rounded-xl" />
          <SkeletonLine className="h-52 rounded-xl" />
        </div>
      </main>
    </div>
  );
}
