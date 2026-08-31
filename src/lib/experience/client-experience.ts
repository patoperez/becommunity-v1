import "server-only";

import type { LongRow } from "@/lib/calc/engine";
import { buildSegmentFilterOptions } from "@/lib/calc/filters";
import { observedScales } from "@/lib/calc/scale";
import type { ConfirmedQualitative } from "@/lib/qualitative/published";
import { summarizeConfirmedQualitative } from "@/lib/qualitative/published";
import { journeyMetricOptions } from "@/lib/studio/journey-picker";
import type { createAdminClient } from "@/lib/supabase/admin";

import { buildLegacyRegistry, registryKeyIndex, type LegacyStudySnapshot } from "./adapter";
import type { BuilderEvidence } from "./builder-workspace";
import type { ClientEvidenceSummary } from "./client-visibility";
import type { BlockDataSet, RegistryKeyIndex, ViewerSelection } from "./data";
import type { ExperienceDefinitionV1 } from "./definition";
import { activeExperience, type ActiveExperience } from "./publication";
import type { SemanticRegistry } from "./registry";
import { resolveExperience } from "./resolve";

/**
 * THE CLIENT-FACING SIDE OF THE COMPOSED EXPERIENCE, and the compatibility
 * boundary it creates.
 *
 * A study is served the composed experience when — and only when — it has an
 * ACTIVE PUBLISHED REVISION that this build can read. Every other study, which
 * today is every study, keeps the legacy dashboard byte for byte. Moving a
 * study across that line is a deliberate act somebody performs on
 * `/studio/e/[studyId]/publicar`, one study at a time.
 *
 * WHAT IS NEVER READ HERE: a draft, an unprepared revision, a prepared revision
 * that was never published, or anything about the review that produced the
 * publication. The pointer is the only way in, and only `publish_` and
 * `restore_` can move it.
 *
 * WHY THE PRIVILEGED CLIENT IS USED FOR ONE READ. `study_experience_revision`
 * denies `anon` and `authenticated` outright — a client-role session cannot
 * read a revision even with a valid JWT and a correct study id, which is the
 * whole point of migration 0023's privilege model. So the definition is read
 * with the admin client, AFTER the caller has proved through ordinary RLS that
 * this user may see this study, and the read is scoped by BOTH the revision id
 * and the study id.
 *
 * THE NUMBERS ARE THE CLIENT'S OWN. Every aggregate is resolved over the rows
 * `loadAuthorizedStudyData` returned — already narrowed by the user's
 * `data_scope`. The registry is built from those same rows, so a client with a
 * restricted scope is offered filter values they have data for and no others.
 * A result their scope leaves empty resolves to nothing and the block is not
 * rendered at all (contract C11, `client-visibility.ts`).
 *
 * NOTHING IS PRECOMPUTED OR CACHED. A publication freezes the CONFIGURATION;
 * the numbers are computed fresh through the canonical engine on every request,
 * exactly as the legacy dashboard computes them. A published revision that
 * carried stored numbers would disagree with the study's own data the first
 * time a correction was imported, and nobody would be told.
 */

export type ComposedClientExperience = {
  revisionId: string;
  revision: number;
  publishedAt: string;
  definitionSha256: string;
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  data: BlockDataSet;
  /** What the drawings need: theme counts, periods, bases. Never a quote. */
  evidence: BuilderEvidence;
  /** What contract C11 needs to decide whether a block reaches the client. */
  summary: ClientEvidenceSummary;
};

export type ComposedSelectionResult =
  /** This study has a composed experience and here it is. */
  | { kind: "composed"; experience: ComposedClientExperience }
  /**
   * This study is a legacy study. Render exactly what it rendered before.
   *
   * `unreadable` marks the one case that is not an ordinary legacy study: the
   * study HAS a published revision and this build cannot read it. The client is
   * still served the legacy dashboard — real data, correct numbers, the screen
   * they had before the composed experience existed — rather than an error page
   * or a partially drawn document. `reason` is INTERNAL and is carried so a
   * Studio screen can shout about it; a client-facing route must discard it,
   * because "we could not read what we published" is precisely the kind of
   * sentence C11 keeps off a client's screen.
   */
  | { kind: "legacy"; unreadable?: true; reason?: string };

/** The pieces the caller has already loaded and authorized. */
export type ClientExperienceInput = {
  study: { id: string; tenantId: string; name: string; period: string | null; status: string };
  clientName: string;
  rows: readonly LongRow[];
  qualitative: readonly ConfirmedQualitative[];
  /** Whether a downloadable report genuinely exists for this study. */
  reportAvailable: boolean;
  /** The reader's transient choices. Never written anywhere. */
  selection?: ViewerSelection;
};

/**
 * The registry a client's own rows produce.
 *
 * Built with the SAME pure functions the internal path uses, from the SAME
 * shape of snapshot, so a handle in a published definition resolves to the same
 * result it named when the revision was prepared. The inputs differ — these
 * rows are scoped — and that is exactly the intended difference.
 */
export function clientStudySnapshot(input: ClientExperienceInput): LegacyStudySnapshot {
  const rows = input.rows as LongRow[];
  const spans = observedScales(rows);
  const themes = summarizeConfirmedQualitative([...input.qualitative]).themes;
  return {
    studyId: input.study.id,
    tenantId: input.study.tenantId,
    studyName: input.study.name,
    clientName: input.clientName,
    period: input.study.period,
    status: input.study.status,
    // The composed document carries its own arrangement; the legacy
    // configuration is not consulted for a published revision and is passed as
    // the empty shapes the snapshot type requires.
    dashboardConfig: null,
    journeyDefinition: { stages: [] },
    metrics: journeyMetricOptions(rows).map((option) => ({
      key: option.key,
      name: option.name,
      question: option.question,
      unit: option.key.startsWith("nps")
        ? "nps"
        : option.key.startsWith("sat") || option.key.startsWith("csat")
          ? "percent"
          : "score",
      responses: option.people,
      available: option.available,
      scale: spans.get(option.key) ?? null,
    })),
    dimensions: buildSegmentFilterOptions(rows).map((option) => ({
      key: option.key,
      values: option.values,
    })),
    themes: themes.map((theme) => ({ label: theme.theme, confirmed: theme.count })),
    periods: input.study.period ? [input.study.period] : [],
  };
}

export function clientEvidence(
  input: ClientExperienceInput,
  registry: SemanticRegistry,
): { evidence: BuilderEvidence; summary: ClientEvidenceSummary } {
  const summarized = summarizeConfirmedQualitative([...input.qualitative]);
  const themes = summarized.themes.map((theme) => ({
    label: theme.theme,
    count: theme.count,
    n: theme.n,
  }));
  const crossable = registry.dimensions.filter(
    (dimension) => dimension.filterEligible && dimension.values.length > 0,
  );
  return {
    evidence: {
      themes,
      periods: input.study.period ? [input.study.period] : [],
      // Counted from the rows themselves: somebody on the list who answered
      // nothing is not part of any aggregate, so they are not part of the base.
      respondents: new Set(input.rows.map((row) => row.respondent_id)).size,
      crossableResults: registry.metrics.length,
      crossableCharacteristics: crossable.map((dimension) => dimension.label),
      qualitativeSources: [
        ...new Set(input.qualitative.flatMap((row) => (row.source ? [row.source] : []))),
      ].sort((a, b) => a.localeCompare(b, "es-MX")),
    },
    summary: {
      themes,
      crossableResults: registry.metrics.length,
      reportAvailable: input.reportAvailable,
    },
  };
}

/**
 * The published document and the registry it resolves against, WITHOUT the
 * numbers.
 *
 * Split out because the filter action needs the registry to check a reader's
 * chosen values BEFORE it computes anything, and resolving the whole study
 * twice — once to learn what is allowed, once with the allowed selection — is a
 * second pass over every row of a study for an answer the first pass already
 * had. This is the same code path, stopped where that caller's need stops.
 */
export type ActiveComposition = {
  active: ActiveExperience;
  registry: SemanticRegistry;
  index: RegistryKeyIndex;
};

export async function activeComposition(
  admin: ReturnType<typeof createAdminClient>,
  input: ClientExperienceInput,
): Promise<
  | { kind: "composed"; composition: ActiveComposition }
  | { kind: "legacy"; unreadable?: true; reason?: string }
> {
  const result = await activeExperience(admin, input.study.id);
  if (!result.ok) return { kind: "legacy", unreadable: true, reason: result.reason };
  if (!result.active) return { kind: "legacy" };

  const snapshot = clientStudySnapshot(input);
  return {
    kind: "composed",
    composition: {
      active: result.active,
      registry: buildLegacyRegistry(snapshot),
      index: registryKeyIndex(snapshot),
    },
  };
}

/** The numbers, resolved once, for one reader and one selection. */
export function resolveClientExperience(
  composition: ActiveComposition,
  input: ClientExperienceInput,
): ComposedClientExperience {
  const resolved = resolveExperience({
    rows: input.rows,
    registry: composition.registry,
    index: composition.index,
    definition: composition.active.definition,
    selection: input.selection,
    confirmed: input.qualitative,
  });
  const described = clientEvidence(input, resolved.registry);
  return {
    revisionId: composition.active.revisionId,
    revision: composition.active.revision,
    publishedAt: composition.active.publishedAt,
    definitionSha256: composition.active.definitionSha256,
    definition: composition.active.definition,
    registry: resolved.registry,
    data: resolved.data,
    evidence: described.evidence,
    summary: described.summary,
  };
}

/** Load and resolve in one step, for a route that wants both. */
export async function selectClientExperience(
  admin: ReturnType<typeof createAdminClient>,
  input: ClientExperienceInput,
): Promise<ComposedSelectionResult> {
  const loaded = await activeComposition(admin, input);
  if (loaded.kind !== "composed") return loaded;
  return { kind: "composed", experience: resolveClientExperience(loaded.composition, input) };
}
