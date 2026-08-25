import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { parseJourneyDefinition } from "@/lib/calc/journey";
import { loadTenantArchiveState } from "./lifecycle";
import {
  attentionForStudy,
  rankAttention,
  type AttentionItem,
  type AttentionKind,
  type StudyFacts,
} from "./attention-model";

/**
 * The operational state behind "¿Qué necesita mi atención?" (P8.2).
 *
 * Read AFTER the caller has proved an internal role, with the already-created
 * admin client.
 *
 * FOUR QUERIES, NOT ONE PER STUDY. The internal home used to load every study's
 * complete authorized dataset — rows, segments, confirmed qualitative, the lot —
 * just to decide which studies were empty. This reads the newest studies, then
 * answers all of them at once: the metric keys that exist, the review states
 * that exist, and the imports that never finished. Nothing here reads a quote,
 * a respondent id or a segment value.
 */

/** How far back the home looks. Older work is found through the lists. */
const RECENT_STUDIES = 40;
const MAX_RESPONSES = 200_000;
const MAX_OBSERVATIONS = 50_000;

type StudyRow = {
  id: string;
  tenant_id: string;
  name: string;
  period: string | null;
  status: string;
  journey_definition: unknown;
};

export type AttentionBoard = {
  shown: AttentionItem[];
  hidden: number;
  /** How many studies were examined, so the empty state can be honest. */
  studiesExamined: number;
};

export async function loadAttentionBoard(
  admin: ReturnType<typeof createAdminClient>,
  href: (kind: AttentionKind, studyId: string) => string,
): Promise<AttentionBoard> {
  const { data: studies, error: studyError } = await admin
    .from("study")
    .select("id, tenant_id, name, period, status, journey_definition")
    .order("created_at", { ascending: false })
    .limit(RECENT_STUDIES)
    .returns<StudyRow[]>();
  if (studyError) throw new Error(`study: ${studyError.message}`);
  const studyList = studies ?? [];
  if (studyList.length === 0) return { shown: [], hidden: 0, studiesExamined: 0 };

  const studyIds = studyList.map((study) => study.id);
  const tenantIds = [...new Set(studyList.map((study) => study.tenant_id))];

  const [
    { data: tenants, error: tenantError },
    { data: responses, error: responseError },
    { data: observations, error: observationError },
    { data: imports, error: importError },
    archiveState,
  ] = await Promise.all([
    admin.from("tenant").select("id, name").in("id", tenantIds)
      .returns<{ id: string; name: string }[]>(),
    admin.from("quant_response").select("study_id, metric_key").in("study_id", studyIds)
      .limit(MAX_RESPONSES).returns<{ study_id: string; metric_key: string }[]>(),
    admin.from("qual_observation").select("study_id, review_status").in("study_id", studyIds)
      .limit(MAX_OBSERVATIONS).returns<{ study_id: string; review_status: string }[]>(),
    admin.from("import_batch").select("study_id, status").in("study_id", studyIds)
      .in("status", ["staged", "failed"]).returns<{ study_id: string; status: string }[]>(),
    loadTenantArchiveState(admin, tenantIds),
  ]);
  if (tenantError) throw new Error(`tenant: ${tenantError.message}`);
  if (responseError) throw new Error(`quant_response: ${responseError.message}`);
  if (observationError) throw new Error(`qual_observation: ${observationError.message}`);
  if (importError) throw new Error(`import_batch: ${importError.message}`);

  const tenantName = new Map((tenants ?? []).map((tenant) => [tenant.id, tenant.name]));
  const responseCount = new Map<string, number>();
  const metricsByStudy = new Map<string, Set<string>>();
  for (const row of responses ?? []) {
    responseCount.set(row.study_id, (responseCount.get(row.study_id) ?? 0) + 1);
    const metrics = metricsByStudy.get(row.study_id) ?? new Set<string>();
    metrics.add(row.metric_key);
    metricsByStudy.set(row.study_id, metrics);
  }
  const pending = new Map<string, number>();
  const confirmed = new Map<string, number>();
  for (const row of observations ?? []) {
    if (row.review_status === "pending") {
      pending.set(row.study_id, (pending.get(row.study_id) ?? 0) + 1);
    } else if (row.review_status === "confirmed") {
      confirmed.set(row.study_id, (confirmed.get(row.study_id) ?? 0) + 1);
    }
  }
  const unfinished = new Map<string, number>();
  for (const row of imports ?? []) {
    unfinished.set(row.study_id, (unfinished.get(row.study_id) ?? 0) + 1);
  }

  const items = studyList.flatMap((study) => {
    const stages = parseJourneyDefinition(study.journey_definition);
    const metrics = metricsByStudy.get(study.id) ?? new Set<string>();
    const facts: StudyFacts = {
      studyId: study.id,
      studyName: study.name,
      clientName: tenantName.get(study.tenant_id) ?? "Cliente eliminado",
      period: study.period,
      status: study.status,
      clientArchived: Boolean(archiveState.archivedAt[study.tenant_id]),
      quantResponses: responseCount.get(study.id) ?? 0,
      confirmedObservations: confirmed.get(study.id) ?? 0,
      pendingObservations: pending.get(study.id) ?? 0,
      unfinishedImports: unfinished.get(study.id) ?? 0,
      stagesWithoutResult: stages.filter((stage) => !metrics.has(stage.metric)).length,
      totalStages: stages.length,
    };
    return attentionForStudy(facts, href);
  });

  const ranked = rankAttention(items);
  return { ...ranked, studiesExamined: studyList.length };
}
