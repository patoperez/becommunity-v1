import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { summarizeConfirmedQualitative } from "@/lib/qualitative/published";
import type { StudioStudyWorkspace } from "@/lib/studio/study-workspace";

import { loadBuilderRegistry } from "./builder-workspace";
import type { ExperienceDefinitionV1 } from "./definition";
import { structuralDiff, type StructuralDiff } from "./diff";
import { definitionHash, studyFingerprint } from "./fingerprint";
import { publicationPreflight, type PreflightEvidence, type PreflightReport } from "./preflight";
import {
  activeExperience,
  latestRevision,
  revisionIsReadable,
  type ActiveExperience,
  type StoredRevision,
  type UnreadableRevision,
} from "./publication";
import type { SemanticRegistry } from "./registry";
import { loadExperienceDraft, type StoredDraft } from "./storage";

/**
 * Everything the publication review needs about one study, assembled once.
 *
 * WHY IT IS NOT `loadBuilderWorkspace`. The review screen answers "is this
 * ready and what will change", not "what do the numbers say". It therefore
 * stops at `loadBuilderRegistry` — the same code path, ended where this
 * caller's need ends — and never resolves a single aggregate. The numbers are
 * the PREVIEW's job, and the preview is a different route so that opening the
 * review does not pay for rendering every chart in the study.
 *
 * WHAT IT DELIBERATELY DOES NOT DECIDE. Whether anything may be published. It
 * assembles the facts; the Server Action re-derives them from scratch and the
 * database refuses independently. A page that computed the verdict and an
 * action that trusted it would be one authorization check, not three.
 */

export type PublicationWorkspace = {
  study: StudioStudyWorkspace["study"];
  registry: SemanticRegistry;

  /** The saved draft, when there is one. */
  draft: StoredDraft | null;
  /** Why the saved draft could not be read, when that is what happened. */
  draftProblem: string | null;
  /** What the review is about: the saved draft, or the study's own arrangement. */
  draftDefinition: ExperienceDefinitionV1;
  /** The canonical hash of `draftDefinition`. */
  draftHash: string;
  draftPreflight: PreflightReport;

  /** What the study's results, names and disclosure rule are right now. */
  studyFingerprint: string;

  /** The newest immutable revision, when the study has one. */
  prepared: StoredRevision | UnreadableRevision | null;
  /**
   * The prepared revision re-checked against the world as it is now. Null when
   * there is no prepared revision or its document cannot be read.
   */
  preparedPreflight: PreflightReport | null;
  /**
   * True when the prepared revision no longer describes the saved draft. A
   * stale review may be looked at and compared; it may not be published, and
   * the database refuses it independently of this flag.
   */
  preparedStale: boolean;

  /** What the client is being served right now, when it is a composed one. */
  active: ActiveExperience | null;
  /**
   * Set when the study HAS a published revision this build cannot read. The
   * client is being served the legacy dashboard, and that is worth shouting
   * about on an internal screen — see `activeExperience`.
   */
  activeProblem: string | null;

  /** Prepared versus published. Null when either side is missing. */
  preparedVersusActive: StructuralDiff | null;
  /** Draft versus published. What a fresh preparation would change. */
  draftVersusActive: StructuralDiff | null;
};

export async function loadPublicationWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  workspace: StudioStudyWorkspace,
): Promise<PublicationWorkspace> {
  const studyId = workspace.study.id;

  const context = await loadBuilderRegistry(admin, workspace);
  const [stored, prepared, activeResult] = await Promise.all([
    loadExperienceDraft(admin, studyId),
    latestRevision(admin, studyId),
    activeExperience(admin, studyId),
  ]);

  const draft = stored.ok ? stored.draft : null;
  const draftProblem = stored.ok ? null : stored.reason;
  const draftDefinition = draft?.definition ?? context.adapted;

  const evidence: PreflightEvidence = {
    approvedThemes: summarizeConfirmedQualitative(context.confirmed).themes.map((theme) => ({
      label: theme.theme,
      count: theme.count,
      n: theme.n,
    })),
    approvedSources: [
      ...new Set(context.confirmed.flatMap((row) => (row.source ? [row.source] : []))),
    ].sort(),
  };

  const fingerprint = await studyFingerprint({
    registryVersion: context.registry.registryVersion,
    samplePolicy: draftDefinition.sampleVisibilityPolicy,
    categorySignature: null,
  });

  const draftHash = await definitionHash(draftDefinition);

  const draftPreflight = publicationPreflight({
    definition: draftDefinition,
    registry: context.registry,
    evidence,
  });

  const preparedReadable = prepared && revisionIsReadable(prepared) ? prepared : null;
  const preparedStale = preparedReadable
    ? draft === null || draft.revision !== preparedReadable.sourceDraftRevision
    : false;

  const preparedPreflight = preparedReadable
    ? publicationPreflight({
        definition: preparedReadable.definition,
        registry: context.registry,
        evidence,
        prepared: {
          sourceDraftRevision: preparedReadable.sourceDraftRevision,
          studyFingerprint: preparedReadable.studyFingerprint,
        },
        currentDraftRevision: draft?.revision ?? null,
        currentStudyFingerprint: fingerprint,
      })
    : null;

  const active = activeResult.ok ? activeResult.active : null;
  const activeProblem = activeResult.ok ? null : activeResult.reason;

  return {
    study: workspace.study,
    registry: context.registry,
    draft,
    draftProblem,
    draftDefinition,
    draftHash,
    draftPreflight,
    studyFingerprint: fingerprint,
    prepared,
    preparedPreflight,
    preparedStale,
    active,
    activeProblem,
    preparedVersusActive:
      preparedReadable && active ? structuralDiff(active.definition, preparedReadable.definition) : null,
    draftVersusActive: active ? structuralDiff(active.definition, draftDefinition) : null,
  };
}
