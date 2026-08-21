import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadStudyRows } from "@/lib/calc/load";
import { parseJourneyDefinition } from "@/lib/calc/journey";
import { loadConfirmedQualitative } from "@/lib/qualitative/published";
import {
  buildSegmentFilterOptions,
  filterRowsBySegments,
  validateSegmentFilters,
} from "@/lib/calc/filters";
import { buildStudyPdf } from "@/lib/reporting/pdf";
import { parseReportFilters } from "@/lib/reporting/filters";

export const dynamic = "force-dynamic";

type Study = {
  id: string;
  tenant_id: string;
  name: string;
  period: string | null;
  status: string;
  journey_definition: unknown;
};

function filename(value: string): string {
  const slug = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${slug || "estudio"}-informe.pdf`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studyId: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("No autorizado", { status: 401 });

  const { studyId } = await params;
  const { data: study, error: studyError } = await supabase.from("study")
    .select("id, tenant_id, name, period, status, journey_definition")
    .eq("id", studyId).maybeSingle<Study>();
  if (studyError) return new Response("No fue posible cargar el estudio", { status: 500 });
  if (!study) return new Response("Estudio no encontrado", { status: 404 });

  const [{ data: tenant }, rows, qualitative] = await Promise.all([
    supabase.from("tenant").select("name").eq("id", study.tenant_id).maybeSingle<{ name: string }>(),
    loadStudyRows(supabase, study.id),
    loadConfirmedQualitative(supabase, study.id),
  ]);
  const parsedFilters = parseReportFilters(request.nextUrl.searchParams);
  if (!parsedFilters.ok) return Response.json({ error: parsedFilters.error }, { status: 400 });
  const filters = parsedFilters.filters;
  const options = buildSegmentFilterOptions([...rows, ...qualitative]);
  const validation = validateSegmentFilters(filters, options);
  if (!validation.ok) return Response.json({ error: "Filtros invalidos", details: validation.errors }, { status: 400 });

  const filteredRows = filterRowsBySegments(rows, filters, options);
  const filteredQualitative = filterRowsBySegments(qualitative, filters, options);
  const bytes = await buildStudyPdf({
    tenantName: tenant?.name ?? "Be Community",
    study,
    rows: filteredRows,
    journeyStages: parseJourneyDefinition(study.journey_definition),
    qualitative: filteredQualitative,
    filters,
  });
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename(study.name)}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
