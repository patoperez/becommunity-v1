import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseJourneyDefinition } from "@/lib/calc/journey";
import {
  buildSegmentFilterOptions,
  filterRowsBySegments,
  validateSegmentFilters,
} from "@/lib/calc/filters";
import { buildStudyPdf } from "@/lib/reporting/pdf";
import { parseReportFilters } from "@/lib/reporting/filters";
import { loadAuthorizedStudyData } from "@/lib/studies/authorized";
import { parseDashboardConfig } from "@/lib/dashboard/config";

export const dynamic = "force-dynamic";

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
  if (!z.string().uuid().safeParse(studyId).success) return new Response("Estudio no encontrado", { status: 404 });
  const authorized = await loadAuthorizedStudyData(supabase, studyId);
  if (!authorized) return new Response("Estudio no encontrado", { status: 404 });
  const { study, rows, qualitative, tenantName, brand, publishedInterpretation } = authorized;
  const { sections } = parseDashboardConfig(study.dashboard_config);
  if (!sections.report) return new Response("Informe no disponible", { status: 404 });
  const parsedFilters = parseReportFilters(request.nextUrl.searchParams);
  if (!parsedFilters.ok) return Response.json({ error: parsedFilters.error }, { status: 400 });
  const filters = sections.filters ? parsedFilters.filters : {};
  const options = buildSegmentFilterOptions([...rows, ...qualitative]);
  const validation = validateSegmentFilters(filters, options);
  if (!validation.ok) return Response.json({ error: "Filtros invalidos", details: validation.errors }, { status: 400 });

  const filteredRows = filterRowsBySegments(rows, filters, options);
  const filteredQualitative = filterRowsBySegments(qualitative, filters, options);
  const bytes = await buildStudyPdf({
    tenantName,
    brand,
    study,
    rows: filteredRows,
    // The scale each result is answered on is a property of the STUDY, not of
    // the reader's current selection.
    allRows: rows,
    journeyStages: parseJourneyDefinition(study.journey_definition),
    qualitative: filteredQualitative,
    filters,
    sections,
    interpretation: publishedInterpretation,
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
