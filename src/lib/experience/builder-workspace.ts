import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { loadStudyRows } from "@/lib/calc/load";
import type { LongRow } from "@/lib/calc/engine";
import { keysetWindow, selectAllPages } from "@/lib/supabase/paginate";
import {
  summarizeConfirmedQualitative,
  type ConfirmedQualitative,
} from "@/lib/qualitative/published";
import type { StudioStudyWorkspace } from "@/lib/studio/study-workspace";

import { adaptLegacyStudy, registryKeyIndex, type AdapterWarning } from "./adapter";
import type { ExperienceDefinitionV1 } from "./definition";
import { resolveDefinitionData, type BlockDataSet, type RegistryKeyIndex } from "./data";
import type { SemanticRegistry } from "./registry";
import { loadExperienceDraft, type StoredDraft } from "./storage";
import { loadLegacyStudySnapshot } from "./study-snapshot";
import { validateExperienceDefinition, type ValidationReport } from "./validate";

/**
 * Everything the dashboard builder needs about one study, assembled once.
 *
 * READ AFTER `requireInternal()`, with the admin client that check produced —
 * the same contract every other Studio loader has. It issues selects and one
 * draft read, and nothing else.
 *
 * THREE THINGS COME BACK, AND KEEPING THEM SEPARATE IS THE POINT.
 *
 *   `adapted`     what the study's own configuration produces today. It is
 *                 recomputed on every load, never stored, and it is what the
 *                 builder starts from when no draft exists and what "volver a
 *                 la configuración del estudio" restores.
 *
 *   `draft`       what somebody saved. Present or absent; never merged with the
 *                 adapted arrangement, because a silent merge is how an edit
 *                 somebody deliberately removed comes back.
 *
 *   `data`        the real numbers, computed through the canonical engine for
 *                 exactly the aggregates the document asks for.
 *
 * WHAT NEVER LEAVES THIS MODULE. `rows` — the study's long rows — and
 * `keyIndex`, the map from opaque registry handle to canonical metric key.
 * Both stay on the server: the browser receives aggregates and labels, and a
 * definition that names handles. There is no path from what the builder sends
 * to the browser back to a respondent, an answer or a column name.
 */

export type BuilderEvidence = {
  /**
   * Confirmed themes, summarised by the SAME function the client dashboard
   * uses. `count` is how many confirmed observations carry the theme; `n` is
   * how many distinct voices are behind it, which is the base a disclosure rule
   * reads. They are different numbers and both are kept, because reporting one
   * as the other is how a builder preview stops matching the client's screen.
   */
  themes: { label: string; count: number; n: number }[];
  /** Every period the study has data for, oldest first. */
  periods: string[];
  /** People with at least one recorded numeric answer. */
  respondents: number;
  /** How many results the comparison explorer can offer the reader. */
  crossableResults: number;
  /** Which characteristics it can group by, named the way a person reads them. */
  crossableCharacteristics: string[];
};

export type BuilderWorkspace = {
  study: {
    id: string;
    tenantId: string;
    name: string;
    clientName: string;
    period: string | null;
    status: string;
  };
  adapted: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  adapterWarnings: AdapterWarning[];
  /** The stored draft, when there is one and it still parses. */
  draft: StoredDraft | null;
  /** Why the stored draft could not be read, when that is what happened. */
  draftProblem: string | null;
  /** What the builder opens on: the draft when there is one, else the adapted. */
  definition: ExperienceDefinitionV1;
  report: ValidationReport;
  data: BlockDataSet;
  evidence: BuilderEvidence;
  /** Server-side only. Never included in what a page hands to a client component. */
  keyIndex: RegistryKeyIndex;
  rows: readonly LongRow[];
};

/**
 * The registry and the adapted arrangement, WITHOUT the aggregates, the draft
 * or the confirmed themes.
 *
 * The two Server Actions need a registry to validate a handle against, and
 * nothing else. Loading the whole workspace to get one meant every autosave
 * recomputed every aggregate on the server and threw the result away. This is
 * the same code path, stopped where the caller's need stops.
 */
export type BuilderRegistryContext = {
  registry: SemanticRegistry;
  keyIndex: RegistryKeyIndex;
  adapted: ExperienceDefinitionV1;
  rows: readonly LongRow[];
};

export async function loadBuilderRegistry(
  admin: ReturnType<typeof createAdminClient>,
  workspace: StudioStudyWorkspace,
): Promise<BuilderRegistryContext> {
  const rows = await loadStudyRows(admin, workspace.study.id);
  const snapshot = await loadLegacyStudySnapshot(admin, workspace, rows);
  const { definition: adapted, registry } = adaptLegacyStudy(snapshot);
  return { registry, keyIndex: registryKeyIndex(snapshot), adapted, rows };
}

export async function loadBuilderWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  workspace: StudioStudyWorkspace,
): Promise<BuilderWorkspace> {
  // One read of the study's rows, shared by the snapshot and the aggregates.
  const rows = await loadStudyRows(admin, workspace.study.id);
  const snapshot = await loadLegacyStudySnapshot(admin, workspace, rows);
  const { definition: adapted, registry, warnings } = adaptLegacyStudy(snapshot);
  const keyIndex = registryKeyIndex(snapshot);

  const [stored, confirmed] = await Promise.all([
    loadExperienceDraft(admin, workspace.study.id),
    loadConfirmedThemes(admin, workspace.study.id),
  ]);

  const draft = stored.ok ? stored.draft : null;
  const draftProblem = stored.ok ? null : stored.reason;
  const definition = draft?.definition ?? adapted;

  return {
    study: {
      id: workspace.study.id,
      tenantId: workspace.study.tenantId,
      name: workspace.study.name,
      clientName: workspace.study.clientName,
      period: workspace.study.period,
      status: workspace.study.status,
    },
    adapted,
    registry,
    adapterWarnings: warnings,
    draft,
    draftProblem,
    definition,
    report: validateExperienceDefinition(definition, registry),
    data: resolveDefinitionData(rows, registry, keyIndex, definition),
    evidence: buildEvidence(snapshot, registry, rows, confirmed),
    keyIndex,
    rows,
  };
}

/**
 * The confirmed themes of one study, and nothing else about them.
 *
 * It reads three columns — the primary key, the respondent, and the CONFIRMED
 * theme. Never `quote`, never `suggested_theme`, never a pending observation.
 * The builder arranges evidence; it is not a place where an unreviewed sentence
 * can appear, so the query cannot return one.
 */
async function loadConfirmedThemes(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
): Promise<ConfirmedQualitative[]> {
  type Row = { id: string; respondent_id: string | null; confirmed_theme: string | null };
  const rows = await selectAllPages<Row>(
    "qual_observation themes",
    (cursor, size) =>
      keysetWindow(
        admin
          .from("qual_observation")
          .select("id, respondent_id, confirmed_theme")
          .eq("study_id", studyId)
          .eq("review_status", "confirmed"),
        { column: "id", cursor, size },
      ).returns<Row[]>(),
    { maxRows: 100_000, cursorOf: (row) => row.id },
  );
  return (rows ?? []).flatMap((row) => {
    const theme = typeof row.confirmed_theme === "string" ? row.confirmed_theme.trim() : "";
    if (!theme) return [];
    return [{
      id: String(row.id),
      respondent_id: row.respondent_id ? String(row.respondent_id) : null,
      theme,
      stage_key: null,
      quote: null,
      source: null,
      category: null,
    }];
  });
}

function buildEvidence(
  snapshot: Awaited<ReturnType<typeof loadLegacyStudySnapshot>>,
  registry: SemanticRegistry,
  rows: readonly LongRow[],
  confirmed: ConfirmedQualitative[],
): BuilderEvidence {
  const crossable = registry.dimensions.filter(
    (dimension) => dimension.filterEligible && dimension.values.length > 0,
  );
  return {
    themes: summarizeConfirmedQualitative(confirmed).themes.map((theme) => ({
      label: theme.theme,
      count: theme.count,
      n: theme.n,
    })),
    periods: [...snapshot.periods],
    // Counted from the rows themselves rather than from the import, so it is
    // the base a result actually rests on: somebody on the list who answered
    // nothing is not part of any aggregate.
    respondents: new Set(rows.map((row) => row.respondent_id)).size,
    crossableResults: registry.metrics.length,
    crossableCharacteristics: crossable.map((dimension) => dimension.label),
  };
}

/**
 * What a page hands to the client component.
 *
 * A separate function rather than a spread, so adding a field to the workspace
 * cannot accidentally ship the rows or the handle index to a browser. Anything
 * the builder needs has to be named here, deliberately, once.
 */
export function builderClientPayload(workspace: BuilderWorkspace) {
  return {
    study: workspace.study,
    adapted: workspace.adapted,
    registry: workspace.registry,
    adapterWarnings: workspace.adapterWarnings.map((warning) => ({
      code: warning.code,
      detail: warning.detail,
    })),
    definition: workspace.definition,
    draft: workspace.draft
      ? {
          revision: workspace.draft.revision,
          updatedAt: workspace.draft.updatedAt,
        }
      : null,
    draftProblem: workspace.draftProblem,
    data: workspace.data,
    evidence: workspace.evidence,
  };
}

export type BuilderClientPayload = ReturnType<typeof builderClientPayload>;
