import "server-only";

/**
 * Everything the "Revisar categorías" screen needs, assembled once.
 *
 * Read AFTER `requireInternal()`, with an already-created privileged client —
 * the same contract every other Studio loader holds to.
 *
 * WHAT LEAVES THIS MODULE. Category labels, respondent COUNTS per label, and
 * the decisions a person recorded. No respondent id, no answer value, no quote,
 * no private metadata and no free text beyond the category labels themselves.
 * The review screen is about vocabulary, and vocabulary is all it receives.
 *
 * WHY THE WHOLE STUDY IS READ AND NOT A PAGE. Candidate detection is a property
 * of the complete value set: a pair whose two spellings sit on different pages
 * is exactly the pair nobody has noticed, and it is the reason this feature
 * exists. The read is keyset-paged through the shared helper with an explicit
 * refusal ceiling, so it is complete or it fails — never quietly partial.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { keysetWindow, selectAllPages } from "@/lib/supabase/paginate";
import { parseJourneyDefinition } from "@/lib/calc/journey";
import { parseDashboardConfig } from "@/lib/dashboard/config";
import { loadStudyInterpretation } from "@/lib/interpretation/load";
import { parseDataScope } from "@/lib/studies/scope";
import { foldSegmentValue } from "@/lib/calc/segments";
import {
  inventoryValues,
  scanDimension,
  type CandidateGroup,
  type CandidateScan,
} from "./candidates";
import {
  candidateImpact,
  rankCandidates,
  type CandidateImpact,
  type StudyImpactContext,
} from "./impact";
import { categoryGate, type GateSummary } from "./gate";
import {
  contextSignature,
  currentDecisions,
  optionFoldsOf,
  publishedDecisionsDiffer,
  staleDecisions,
  type CategoryDecision,
  type StaleFinding,
} from "./decisions";
import { recallForGroup, memoryConflict, type MemorySuggestion } from "./memory";

/** Refusal threshold, not a page size. See src/lib/supabase/paginate.ts. */
const MAX_RESPONDENTS = 50_000;
const MAX_DIMENSIONS = 500;
const MAX_LEDGER_ROWS = 20_000;

type RespondentRow = { id: string; segments: Record<string, unknown> | null };

type DecisionRow = {
  id: string;
  tenant_id: string;
  scope_kind: string;
  study_id: string | null;
  template_id: string | null;
  dimension_key: string;
  member_folds: unknown;
  member_values: unknown;
  context_signature: string;
  language: string | null;
  decision: string;
  canonical_key: string | null;
  canonical_label: string | null;
  reason: string | null;
  suggestion_source: string;
  advisor: unknown;
  version: number;
  previous_id: string | null;
  actor_user_id: string | null;
  decided_at: string;
};

const DECISION_COLUMNS =
  "id, tenant_id, scope_kind, study_id, template_id, dimension_key, member_folds, member_values, " +
  "context_signature, language, decision, canonical_key, canonical_label, reason, " +
  "suggestion_source, advisor, version, previous_id, actor_user_id, decided_at";

/**
 * A read that tolerates the ledger table not existing yet.
 *
 * Migration 0022 creates it. On a deployment where the code is ahead of the
 * database, the review screen should still render the candidates it can
 * calculate from the respondents alone — and the write path should fail with
 * the real error — rather than every study page answering 500. The degradation
 * is to "no decisions recorded", which is exactly what is true at that moment.
 */
async function tolerateMissingTable<T>(read: Promise<T[]>, fallback: T[]): Promise<T[]> {
  try {
    return await read;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("42P01") || message.includes("PGRST205") || /does not exist/i.test(message)) {
      return fallback;
    }
    throw error;
  }
}

/**
 * Rebuild the application's group key from the stored member list.
 *
 * The database stores the sorted, de-duplicated fold array; `groupKeyFor`
 * produces `JSON.stringify` of exactly that. Reconstructing rather than storing
 * the string twice is what keeps the two encodings from ever disagreeing.
 */
function toDecision(row: DecisionRow): CategoryDecision {
  const folds = Array.isArray(row.member_folds)
    ? row.member_folds.filter((value): value is string => typeof value === "string")
    : [];
  const values = Array.isArray(row.member_values)
    ? row.member_values.filter((value): value is string => typeof value === "string")
    : [];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scopeKind: (row.scope_kind as CategoryDecision["scopeKind"]) ?? "study",
    studyId: row.study_id,
    templateId: row.template_id,
    dimensionKey: row.dimension_key,
    groupKey: JSON.stringify(folds),
    contextSignature: row.context_signature,
    decision: row.decision as CategoryDecision["decision"],
    canonicalKey: row.canonical_key,
    canonicalLabel: row.canonical_label,
    memberValues: values,
    reason: row.reason,
    suggestionSource: row.suggestion_source as CategoryDecision["suggestionSource"],
    language: row.language,
    version: row.version,
    previousId: row.previous_id,
    actorUserId: row.actor_user_id,
    decidedAt: row.decided_at,
    advisor: (row.advisor as CategoryDecision["advisor"]) ?? null,
  };
}

/** One row of the review queue. */
export type CategoryCandidateView = {
  group: CandidateGroup;
  impact: CandidateImpact;
  /** Counts before and after, so the screen can show both columns. */
  distributionBefore: { raw: string; count: number }[];
  distributionAfter: { raw: string; count: number }[];
  /** The decision currently in force for this group, if any. */
  decided: CategoryDecision | null;
  /** What this client's team decided elsewhere. Never applied automatically. */
  memory: MemorySuggestion[];
  memoryConflict: string | null;
};

export type CategoryDimensionView = {
  key: string;
  label: string | null;
  scan: CandidateScan;
  /** The complete value list, so a person can group two the scan did not raise. */
  values: { raw: string; count: number }[];
  contextSignature: string;
};

export type CategoryWorkspace = {
  studyId: string;
  tenantId: string;
  dimensions: CategoryDimensionView[];
  /** Undecided candidates, ordered by what they would change. */
  queue: CategoryCandidateView[];
  /** Decided ones, newest first, so an undo is always reachable. */
  decided: CategoryCandidateView[];
  ledger: CategoryDecision[];
  gate: GateSummary;
  stale: StaleFinding[];
  /** True when the client is reading a different grouping from the current one. */
  publishedIsBehind: boolean;
  snapshotCapturedAt: string | null;
  context: StudyImpactContext;
  respondents: number;
};

export async function loadCategoryWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
): Promise<CategoryWorkspace | null> {
  const { data: study, error } = await admin
    .from("study")
    .select("id, tenant_id, status, dashboard_config, journey_definition")
    .eq("id", studyId)
    .maybeSingle<{
      id: string;
      tenant_id: string;
      status: string;
      dashboard_config: unknown;
      journey_definition: unknown;
    }>();
  if (error) throw new Error(`study: ${error.message}`);
  if (!study) return null;

  const [respondents, { data: dimensionRows }, ledgerRows, tenantLedgerRows, snapshot, interpretation, scopes] =
    await Promise.all([
      selectAllPages<RespondentRow>(
        "respondent",
        (cursor, size) =>
          keysetWindow(
            admin.from("respondent").select("id, segments").eq("study_id", studyId),
            { column: "id", cursor, size },
          ).returns<RespondentRow[]>(),
        { maxRows: MAX_RESPONDENTS, cursorOf: (row) => row.id },
      ),
      admin
        .from("segment_dimension")
        .select("key, label")
        .eq("study_id", studyId)
        .limit(MAX_DIMENSIONS)
        .returns<{ key: string; label: string | null }[]>(),
      tolerateMissingTable(
        selectAllPages<DecisionRow>(
          "category_decision",
          (cursor, size) =>
            keysetWindow(
              admin.from("category_decision").select(DECISION_COLUMNS).eq("study_id", studyId),
              { column: "id", cursor, size },
            ).returns<DecisionRow[]>(),
          { maxRows: MAX_LEDGER_ROWS, cursorOf: (row) => row.id },
        ),
        [],
      ),
      // Memory: this CLIENT's other studies. Scoped by tenant_id on the query
      // itself, not only by RLS and not only by a filter after the fact.
      tolerateMissingTable(
        selectAllPages<DecisionRow>(
          "category_decision",
          (cursor, size) =>
            keysetWindow(
              admin
                .from("category_decision")
                .select(DECISION_COLUMNS)
                .eq("tenant_id", study.tenant_id)
                .neq("study_id", studyId),
              { column: "id", cursor, size },
            ).returns<DecisionRow[]>(),
          { maxRows: MAX_LEDGER_ROWS, cursorOf: (row) => row.id },
        ),
        [],
      ),
      admin
        .from("study_category_snapshot")
        .select("resolution, decision_ids, captured_at")
        .eq("study_id", studyId)
        .maybeSingle<{ resolution: unknown; decision_ids: unknown; captured_at: string }>(),
      loadStudyInterpretation(admin, studyId),
      admin
        .from("profiles")
        .select("data_scope")
        .eq("tenant_id", study.tenant_id)
        .eq("role", "client")
        .limit(500)
        .returns<{ data_scope: unknown }[]>(),
    ]);

  const ledger = (ledgerRows ?? []).map(toDecision);
  const tenantLedger = (tenantLedgerRows ?? []).map(toDecision);
  const inventory = inventoryValues(respondents ?? []);
  const labels = new Map((dimensionRows ?? []).map((row) => [row.key, row.label]));

  const scopedDimensions = new Set<string>();
  for (const profile of scopes.data ?? []) {
    try {
      for (const key of Object.keys(parseDataScope(profile.data_scope))) scopedDimensions.add(key);
    } catch {
      // A scope the schema would now reject tells us nothing about which
      // characteristics matter, and a review screen is not the place to
      // surface it. The access-scope editor reports it where it can be fixed.
    }
  }

  const sections = parseDashboardConfig(study.dashboard_config).sections;
  const stages = parseJourneyDefinition(study.journey_definition).map((stage) => ({
    id: stage.id,
    label: stage.label,
    metric: stage.metric,
  }));
  const published = interpretation.published;
  const narrative = published
    ? [published.whatHappened, published.whyItMatters, published.whatNext].join("\n")
    : "";

  const context: StudyImpactContext = {
    status: study.status,
    totalRespondents: (respondents ?? []).length,
    respondentsPerDimension: Object.fromEntries(
      [...inventory.entries()].map(([key, counts]) => [
        key,
        [...counts.values()].reduce((total, count) => total + count, 0),
      ]),
    ),
    stages,
    sections: sections as unknown as Record<string, boolean>,
    scopedDimensions: [...scopedDimensions],
    // A comparison is drawn over whichever characteristics the study offers, so
    // every characteristic with more than one value is comparable today.
    comparisonDimensions: [...inventory.keys()].filter(
      (key) => new Set([...(inventory.get(key)?.keys() ?? [])].map(foldSegmentValue)).size > 1,
    ),
    publishedNarrative: narrative,
    hasPublishedSnapshot: Boolean(snapshot.data),
  };

  // The aliases already in force, so a settled question is not re-asked.
  const aliasesInForce: Record<string, Record<string, string>> = {};
  for (const decision of currentDecisions(ledger)) {
    if (decision.decision !== "grouped" || !decision.canonicalLabel) continue;
    const forKey = aliasesInForce[decision.dimensionKey] ?? {};
    forKey[foldSegmentValue(decision.canonicalLabel)] = decision.canonicalLabel;
    for (const member of JSON.parse(decision.groupKey) as string[]) {
      forKey[member] = decision.canonicalLabel;
    }
    aliasesInForce[decision.dimensionKey] = forKey;
  }

  const dimensions: CategoryDimensionView[] = [];
  const signatures: Record<string, string> = {};
  const presentFolds: Record<string, string[]> = {};
  const queue: CategoryCandidateView[] = [];

  for (const [key, counts] of [...inventory.entries()].sort(([a], [b]) =>
    a.localeCompare(b, "es-MX"),
  )) {
    const signature = contextSignature({
      dimensionKey: key,
      optionFolds: optionFoldsOf(counts.keys()),
    });
    signatures[key] = signature;
    presentFolds[key] = optionFoldsOf(counts.keys());

    const scan = scanDimension(key, counts, aliasesInForce);
    dimensions.push({
      key,
      label: labels.get(key) ?? null,
      scan,
      values: [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .map(([raw, count]) => ({ raw, count })),
      contextSignature: signature,
    });

    for (const group of scan.groups) {
      queue.push(
        buildView(group, counts, context, ledger, tenantLedger, {
          tenantId: study.tenant_id,
          studyId,
          contextSignature: signature,
        }),
      );
    }
  }

  // A candidate with a decision in force is not a question any more; it moves
  // to the decided list, where undo lives.
  const undecided = queue.filter((entry) => entry.decided === null);
  const decidedFromScan = queue.filter((entry) => entry.decided !== null);

  // Decisions whose group the scan no longer proposes — because the values were
  // grouped, or are gone — still need to be undoable, so they are rebuilt from
  // the ledger rather than from the scan.
  const seen = new Set(decidedFromScan.map((entry) => entry.group.groupKey));
  for (const decision of currentDecisions(ledger)) {
    if (decision.decision === "revoked" || seen.has(decision.groupKey)) continue;
    const counts = inventory.get(decision.dimensionKey) ?? new Map<string, number>();
    decidedFromScan.push(viewFromDecision(decision, counts, context));
    seen.add(decision.groupKey);
  }

  const ranked = rankCandidates(undecided.map((entry) => ({ group: entry.group, impact: entry.impact })));
  const byKey = new Map(undecided.map((entry) => [entry.group.groupKey + entry.group.dimensionKey, entry]));

  return {
    studyId,
    tenantId: study.tenant_id,
    dimensions,
    queue: ranked
      .map((entry) => byKey.get(entry.group.groupKey + entry.group.dimensionKey))
      .filter((entry): entry is CategoryCandidateView => entry !== undefined),
    decided: decidedFromScan.sort((a, b) =>
      (b.decided?.decidedAt ?? "") < (a.decided?.decidedAt ?? "") ? -1 : 1,
    ),
    ledger,
    gate: categoryGate(ranked),
    stale: staleDecisions(ledger, signatures, presentFolds),
    publishedIsBehind:
      Boolean(snapshot.data) &&
      publishedDecisionsDiffer(
        Array.isArray(snapshot.data?.decision_ids)
          ? (snapshot.data.decision_ids as unknown[]).filter(
              (value): value is string => typeof value === "string",
            )
          : [],
        ledger,
      ),
    snapshotCapturedAt: snapshot.data?.captured_at ?? null,
    context,
    respondents: (respondents ?? []).length,
  };
}

function buildView(
  group: CandidateGroup,
  counts: Map<string, number>,
  context: StudyImpactContext,
  ledger: readonly CategoryDecision[],
  tenantLedger: readonly CategoryDecision[],
  scope: { tenantId: string; studyId: string; contextSignature: string },
): CategoryCandidateView {
  const decided =
    currentDecisions(ledger).find(
      (decision) =>
        decision.dimensionKey === group.dimensionKey &&
        decision.groupKey === group.groupKey &&
        decision.decision !== "revoked",
    ) ?? null;

  const impact = candidateImpact(group, counts, context);
  const memory = recallForGroup(
    {
      tenantId: scope.tenantId,
      studyId: scope.studyId,
      dimensionKey: group.dimensionKey,
      groupKey: group.groupKey,
      contextSignature: scope.contextSignature,
    },
    tenantLedger,
  );

  return {
    group,
    impact,
    distributionBefore: [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([raw, count]) => ({ raw, count })),
    distributionAfter: afterRows(counts, group, decided?.canonicalLabel ?? group.suggestedLabel),
    decided,
    memory,
    memoryConflict: memory.length > 0 ? memoryConflict(memory[0], decided) : null,
  };
}

/** A decided group the scan no longer proposes, so undo stays reachable. */
function viewFromDecision(
  decision: CategoryDecision,
  counts: Map<string, number>,
  context: StudyImpactContext,
): CategoryCandidateView {
  const folds: string[] = JSON.parse(decision.groupKey);
  const values = decision.memberValues.length > 0 ? decision.memberValues : folds;
  const group: CandidateGroup = {
    groupKey: decision.groupKey,
    dimensionKey: decision.dimensionKey,
    rule: decision.suggestionSource === "fuzzy" ? "fuzzy" : "punctuation",
    strength: decision.suggestionSource === "fuzzy" ? "weak" : "strong",
    values: values.map((raw) => ({ raw, count: counts.get(raw) ?? 0 })),
    similarity: null,
    suggestedLabel: decision.canonicalLabel ?? values[0] ?? "",
    affectedCount: values.reduce((total, raw) => total + (counts.get(raw) ?? 0), 0),
    warnings: [],
  };
  return {
    group,
    impact: candidateImpact(group, counts, context, decision.canonicalLabel ?? group.suggestedLabel),
    distributionBefore: [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([raw, count]) => ({ raw, count })),
    distributionAfter: afterRows(counts, group, decision.canonicalLabel ?? group.suggestedLabel),
    decided: decision,
    memory: [],
    memoryConflict: null,
  };
}

function afterRows(
  counts: ReadonlyMap<string, number>,
  group: CandidateGroup,
  label: string,
): { raw: string; count: number }[] {
  const members = new Set<string>(JSON.parse(group.groupKey));
  const after = new Map<string, number>();
  let merged = 0;
  for (const [raw, count] of counts) {
    if (members.has(foldSegmentValue(raw))) merged += count;
    else after.set(raw, (after.get(raw) ?? 0) + count);
  }
  if (merged > 0) after.set(label, (after.get(label) ?? 0) + merged);
  return [...after.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([raw, count]) => ({ raw, count }));
}
