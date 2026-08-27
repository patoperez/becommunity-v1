import { PageState, SkeletonLine } from "@/components/States";

export default function InsightsLoading() {
  return (
    <PageState kicker="Insights" title="Estamos preparando tus hallazgos">
      <p role="status">Reunimos el panorama, el recorrido y las comparaciones del estudio.</p>
      <div className="mt-6 space-y-3" aria-hidden="true">
        <SkeletonLine className="h-4 w-2/3" />
        <SkeletonLine className="h-28 w-full" />
        <SkeletonLine className="h-4 w-1/2" />
      </div>
    </PageState>
  );
}
