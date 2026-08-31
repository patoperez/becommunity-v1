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
import { type BlockDataSet, type RegistryKeyIndex } from "./data";
import { resolveExperience } from "./resolve";
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
  /**
   * The qualitative sources this study actually recorded — "encuesta",
   * "focus_group". It is what lets two clouds on one page read two different
   * questions, and the picker offers only what exists rather than a list of
   * shapes the study might one day have.
   */
  qualitativeSources: string[];
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
  /** Server-side only, like `rows`: the browser receives theme COUNTS, never observations. */
  confirmed: ConfirmedQualitative[];
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
  /**
   * The CONFIRMED qualitative observations, so a theme summary can be narrowed
   * by the reader's choice exactly as a number is. Three columns, confirmed
   * only, no quote — see `loadConfirmedThemes`. It is a handful of rows beside
   * the study's answers, which is why it can be afforded on the path §23 exists
   * to keep small.
   */
  confirmed: ConfirmedQualitative[];
};

export async function loadBuilderRegistry(
  admin: ReturnType<typeof createAdminClient>,
  workspace: StudioStudyWorkspace,
): Promise<BuilderRegistryContext> {
  const rows = await loadStudyRows(admin, workspace.study.id);
  const [snapshot, confirmed] = await Promise.all([
    loadLegacyStudySnapshot(admin, workspace, rows),
    loadConfirmedThemes(admin, workspace.study.id),
  ]);
  const { definition: adapted, registry } = adaptLegacyStudy(snapshot);
  return { registry, keyIndex: registryKeyIndex(snapshot), adapted, rows, confirmed };
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

  // One sequence, in one place: widen the registry and the index with whatever
  // the document derives, add the derived columns to the rows, then resolve.
  const resolved = resolveExperience({ rows, registry, index: keyIndex, definition, confirmed });

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
    /*
     * THE REGISTRY THE BUILDER SEES INCLUDES WHAT THE DOCUMENT DERIVES.
     *
     * A configured semáforo that names the result it classifies becomes an
     * ordinary filterable characteristic — the only honest way to offer
     * "Desempeño: Verde / Amarillo / Rojo" for a study that records a score and
     * no category. It is added HERE rather than in the adapter because it is a
     * property of the DOCUMENT, not of the study: two drafts of one study can
     * hold different standards, and the study's own registry must not change
     * because somebody composed a page.
     */
    registry: resolved.registry,
    adapterWarnings: warnings,
    draft,
    draftProblem,
    definition,
    report: validateExperienceDefinition(definition, resolved.registry),
    data: resolved.data,
    evidence: buildEvidence(snapshot, registry, rows, confirmed),
    keyIndex: resolved.index,
    rows: resolved.rows,
    confirmed,
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
  type Row = {
    id: string;
    respondent_id: string | null;
    confirmed_theme: string | null;
    suggested_theme: string | null;
    source: string | null;
  };
  const rows = await selectAllPages<Row>(
    "qual_observation themes",
    (cursor, size) =>
      keysetWindow(
        admin
          .from("qual_observation")
          /*
           * FIVE COLUMNS, AND STILL NEVER `quote`.
           *
           * `suggested_theme` is read only to NAME the spellings a person
           * folded into a confirmed theme — the cloud's "related aliases" — and
           * `source` so two clouds on one page can read different questions.
           * Neither is ever shown as a theme in its own right, and a pending
           * observation is excluded by the filter below, so nothing unreviewed
           * reaches a client through this path.
           */
          .select("id, respondent_id, confirmed_theme, suggested_theme, source")
          .eq("study_id", studyId)
          .eq("review_status", "confirmed"),
        { column: "id", cursor, size },
      ).returns<Row[]>(),
    { maxRows: 100_000, cursorOf: (row) => row.id },
  );
  return (rows ?? []).flatMap((row) => {
    const theme = typeof row.confirmed_theme === "string" ? row.confirmed_theme.trim() : "";
    if (!theme) return [];
    const suggested = typeof row.suggested_theme === "string" ? row.suggested_theme.trim() : "";
    return [{
      id: String(row.id),
      respondent_id: row.respondent_id ? String(row.respondent_id) : null,
      theme,
      stage_key: null,
      quote: null,
      source: row.source ? String(row.source) : null,
      category: null,
      suggestedTheme: suggested === "" ? null : suggested,
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
    qualitativeSources: [
      ...new Set(confirmed.flatMap((row) => (row.source ? [row.source] : []))),
    ].sort((a, b) => a.localeCompare(b, "es-MX")),
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
