import { SkeletonLine } from "@/components/States";

/**
 * Studio counts rows, resolves accounts and computes readiness server-side, so
 * the first paint is not instant. This boundary covers every `/studio/**`
 * route, so no Studio screen can be reached with nothing on it.
 */
export default function StudioLoading() {
  return (
    <div className="flex flex-1 flex-col bg-surface-page">
      <div className="border-b border-line bg-ink">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-3.5 sm:px-6">
          <SkeletonLine className="h-6 w-36 bg-paper/20" />
        </div>
      </div>
      <main id="contenido" className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 sm:px-6 sm:py-8">
        <p role="status" className="sr-only">
          Cargando…
        </p>
        <SkeletonLine className="h-9 w-64" />
        <SkeletonLine className="mt-3 h-4 w-96 max-w-full" />
        <div className="mt-8 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <SkeletonLine className="h-28 rounded-xl" />
          <SkeletonLine className="h-28 rounded-xl" />
          <SkeletonLine className="h-28 rounded-xl" />
          <SkeletonLine className="h-28 rounded-xl" />
        </div>
      </main>
    </div>
  );
}
