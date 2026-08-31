/**
 * What has to be true before a composed experience may reach a client, and
 * what a person may knowingly decide to publish anyway.
 *
 * THE LINE BETWEEN THE TWO IS THE WHOLE POINT, AND IT IS NOT SEVERITY.
 *
 *   A BLOCKER is something the published page would be LYING about. A chart
 *   pointing at a result the study does not produce. A semáforo colouring a
 *   number against a standard nobody finished writing. A percentage whose
 *   numerator was never chosen. A control the client can move that moves
 *   nothing. A cloud of themes nobody approved. These cannot be overridden,
 *   by anybody, with any acknowledgement, because there is no sentence a
 *   person could sign that makes the page true.
 *
 *   A WARNING is a judgement somebody is entitled to make. A hidden page. A
 *   result resting on four answers. A moment of the recorrido shown
 *   deliberately without a number. A panel that moves forty blocks. These are
 *   acknowledged BY CODE, by a named person, at a recorded time — and the
 *   acknowledgement is re-asserted at publication, so agreeing to three
 *   warnings never authorizes publishing a fourth.
 *
 * THERE IS NO "IGNORE EVERYTHING". Acknowledgement is per code and the exact
 * set is stored; a control that dismissed the list wholesale would make the
 * record meaningless the moment the list changed.
 *
 * WHAT THIS MODULE IS NOT. It is not the authorization check — that is
 * `requireInternal()`, the Server Action's own re-check, and
 * `assert_experience_publisher` in the database, and an unauthorized publisher
 * never reaches this code. It is not the staleness check either, in the sense
 * that matters: this module REPORTS that the draft moved on, and migration
 * 0025 REFUSES the write, because a report a caller can skip is not a boundary.
 *
 * IT IS PURE. No database, no `server-only`, no clock. It takes the document,
 * the registry, what the study actually holds, and the two stored facts a
 * prepared revision carries, and returns findings. The gate drives it directly.
 */

import { schemeProblems } from "./bands";
import { blockSpec } from "./blocks";
import {
  EXPERIENCE_SCHEMA_VERSION,
  allBlocks,
  type ExperienceBlock,
  type ExperienceDefinitionV1,
  type ExperiencePage,
} from "./definition";
import { effectiveFilterTargets, panelControls } from "./filters";
import type { SemanticRegistry } from "./registry";
import { findDimension, findMetric } from "./registry";
import { HARD_CODES, SOFT_CODES, validateExperienceDefinition } from "./validate";

/**
 * A panel this wide is not wrong, but a reader moving one control and watching
 * forty blocks change is a reader who has lost track of what they are looking
 * at. It is a warning, and the number is stated here rather than buried.
 */
export const WIDE_PANEL_BLOCKS = 24;

/** A result resting on fewer answers than this is called out. */
export const LOW_SAMPLE_RESPONSES = 5;

/**
 * THE FOUR BLOCK TYPES THE CLIENT RENDERER DOES NOT DRAW, and why that is a
 * BLOCKER rather than a warning.
 *
 * On the builder's canvas and in the internal previews, each of these renders
 * as a bordered DESCRIPTION of what the client will get — "el inventario
 * completo de resultados", "el lector arma su propia comparación", "la lectura
 * aprobada del equipo", "descargar el informe". That is the right drawing for a
 * person arranging a page, and it is a sentence about the client rather than
 * the thing itself.
 *
 * The first published client screen printed those descriptions to the client,
 * including "El cliente los ve plegados, para revisarlos si quiere." — the
 * product talking about the reader, to the reader. Found by looking at the
 * screenshot.
 *
 * There are three ways out and only one of them is honest. Drawing the
 * description to a client is the product lying about itself. Drawing NOTHING is
 * silently losing content a consultant deliberately placed — the approved
 * reading is real client-facing work, and a page that quietly drops it is worse
 * than one that refuses to publish. So publication REFUSES, names the block,
 * and says what to do: hide it, remove it, or wait for the renderer.
 *
 * `report_download` is on the list for a different reason: the download IS
 * offered to a client, once, from the identity layer, which is wired to the
 * real authenticated report. A second control describing the same download is
 * a duplicate at best, and the identity switch is where that decision belongs.
 */
export const CLIENT_UNSUPPORTED_BLOCKS = [
  "interpretation",
  "pivot_explorer",
  "all_results_disclosure",
  "report_download",
] as const;

const CLIENT_UNSUPPORTED_ADVICE: Record<string, string> = {
  interpretation:
    "La lectura aprobada del equipo se publica hoy por la vía de “Interpretación”, no por este bloque. "
    + "Quítalo u ocúltalo antes de publicar.",
  pivot_explorer:
    "La comparación libre todavía no se dibuja en la experiencia compuesta del cliente. Quítala u "
    + "ocúltala antes de publicar.",
  all_results_disclosure:
    "El inventario completo todavía no se dibuja en la experiencia compuesta del cliente. Quítalo u "
    + "ocúltalo antes de publicar.",
  report_download:
    "La descarga se le ofrece al cliente desde la portada, con su propio interruptor. Quita este "
    + "bloque y enciéndela ahí si quieres ofrecerla.",
};

/**
 * Everything that stops a publication.
 *
 * The structural hard errors from `validate.ts` are included BY THEIR OWN
 * CODES rather than collapsed into one "the document is invalid". A reviewer
 * told `unknown_metric` knows to look at a block; a reviewer told "invalid"
 * knows nothing.
 */
export const PUBLICATION_BLOCKER_CODES = [
  ...HARD_CODES,
  /** The stored document no longer satisfies the strict boundary at all. */
  "definition_invalid",
  /** Written under a schema version the client renderer does not implement. */
  "schema_version_unsupported",
  /** Nothing a client would see: no visible page, or no visible block on one. */
  "no_visible_content",
  /** The identity layer says it shows something it does not have. */
  "identity_incomplete",
  /** A semáforo is being used to colour a number and is not finished. */
  "semaforo_incomplete",
  /** An awareness percentage is missing the answers that mean "no lo conocía". */
  "awareness_incomplete",
  /** A control a client can move that moves nothing at all. */
  "deceptive_filter_panel",
  /** Qualitative content configured for display that nobody approved. */
  "unapproved_qualitative",
  /** The draft moved on after this revision was prepared. */
  "draft_moved_on",
  /**
   * A block type the composer can express and the CLIENT RENDERER does not
   * draw. See `CLIENT_UNSUPPORTED_BLOCKS` for the four, and why this is a
   * blocker rather than a warning.
   */
  "not_rendered_for_client",
] as const;
export type PublicationBlockerCode = (typeof PUBLICATION_BLOCKER_CODES)[number];

export const PUBLICATION_WARNING_CODES = [
  ...SOFT_CODES,
  /** A page that exists and is deliberately not shown. */
  "hidden_page",
  /** A block whose explanatory prose was never written. */
  "empty_copy",
  /** A visible result resting on very few answers. */
  "low_sample",
  /** A moment of the recorrido shown on purpose without a number. */
  "moment_without_result",
  /** One panel moving a great many blocks at once. */
  "wide_filter_panel",
  /** Something configured — a recorrido, a semáforo, a filter — and never placed. */
  "feature_not_placed",
  /** The study's own configuration moved since this revision was prepared. */
  "study_configuration_moved",
] as const;
export type PublicationWarningCode = (typeof PUBLICATION_WARNING_CODES)[number];

export type PublicationFinding<C extends string = string> = {
  code: C;
  /** What it is about, so a review screen can point at it. */
  where: { kind: "definition" | "page" | "block" | "filter" | "journey" | "band"; id: string };
  /** The name a person reads, so the screen never prints an identifier. */
  label: string;
  /** One plain sentence in Spanish, because the composer is in Spanish. */
  detail: string;
};

export type PreflightReport = {
  blockers: PublicationFinding<PublicationBlockerCode>[];
  warnings: PublicationFinding<PublicationWarningCode>[];
  /** The distinct blocker codes, sorted. Empty exactly when publication is possible. */
  blockerCodes: PublicationBlockerCode[];
  /** The distinct warning codes, sorted. This is what gets acknowledged. */
  warningCodes: PublicationWarningCode[];
};

/**
 * What a study currently holds, in the only three facts the preflight needs.
 * Deliberately not the workspace: this module must stay drivable from a gate
 * with a literal.
 */
export type PreflightEvidence = {
  /** Approved qualitative themes, already narrowed to confirmed ones upstream. */
  approvedThemes: readonly { label: string; count: number; n: number }[];
  /** The qualitative sources those approved themes actually came from. */
  approvedSources: readonly string[];
};

export type PreflightInput = {
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  evidence: PreflightEvidence;
  /**
   * The two facts a PREPARED revision carries, when one is being reviewed.
   * Absent when the draft itself is being checked before preparation.
   */
  prepared?: {
    sourceDraftRevision: number;
    studyFingerprint: string;
  } | null;
  /** The draft's revision right now, or null when the study has no draft. */
  currentDraftRevision?: number | null;
  /** The study fingerprint right now. */
  currentStudyFingerprint?: string | null;
};

function sortedUnique<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function blockName(block: ExperienceBlock): string {
  const spec = blockSpec(block.type);
  return block.title?.trim() || spec?.label || "Un bloque";
}

function visiblePages(definition: ExperienceDefinitionV1): ExperiencePage[] {
  return definition.pages.filter((page) => page.visible);
}

function visibleBlocks(page: ExperiencePage): ExperienceBlock[] {
  return page.blocks.filter((block) => block.visible && block.layout.desktop.visible);
}

/**
 * Every block a client would actually see, across every visible page.
 *
 * A block hidden by its own switch, or laid out as invisible on the desktop
 * breakpoint, is not published content and is never the subject of a blocker
 * about published content. It can still raise a warning — "you configured this
 * and nobody will see it" is worth saying.
 */
function clientVisibleBlocks(definition: ExperienceDefinitionV1): ExperienceBlock[] {
  return visiblePages(definition).flatMap(visibleBlocks);
}

export function publicationPreflight(input: PreflightInput): PreflightReport {
  const { definition, registry, evidence } = input;
  const blockers: PublicationFinding<PublicationBlockerCode>[] = [];
  const warnings: PublicationFinding<PublicationWarningCode>[] = [];

  // -------------------------------------------------------------------------
  // 1. The schema the client renderer implements
  // -------------------------------------------------------------------------
  // A document from the future is not rendered as best we can: it is refused.
  // Drawing a version-4 arrangement with a version-3 renderer means silently
  // dropping whatever version 4 added, which is a page that is missing
  // something and says nothing about it.
  if (definition.schemaVersion !== EXPERIENCE_SCHEMA_VERSION) {
    blockers.push({
      code: "schema_version_unsupported",
      where: { kind: "definition", id: definition.id },
      label: "Versión del documento",
      detail:
        `Esta experiencia está escrita en la versión ${definition.schemaVersion} y el visor del `
        + `cliente entiende la ${EXPERIENCE_SCHEMA_VERSION}. Ábrela en Construcción para migrarla antes de publicar.`,
    });
  }

  // -------------------------------------------------------------------------
  // 2. Everything the semantic validator already knows
  // -------------------------------------------------------------------------
  const report = validateExperienceDefinition(definition, registry);
  for (const issue of report.errors) {
    blockers.push({
      code: issue.code,
      where: issue.target,
      label: "Configuración inválida",
      detail: issue.detail,
    });
  }
  for (const issue of report.warnings) {
    warnings.push({
      code: issue.code,
      where: issue.target,
      label: "Revisar antes de publicar",
      detail: issue.detail,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Is there anything to publish at all
  // -------------------------------------------------------------------------
  const pages = visiblePages(definition);
  const shown = clientVisibleBlocks(definition);
  if (pages.length === 0) {
    blockers.push({
      code: "no_visible_content",
      where: { kind: "definition", id: definition.id },
      label: "Sin páginas visibles",
      detail:
        "Ninguna página está marcada como visible, así que el cliente abriría una experiencia vacía.",
    });
  } else if (shown.length === 0 && !definition.identity.visible) {
    blockers.push({
      code: "no_visible_content",
      where: { kind: "definition", id: definition.id },
      label: "Sin contenido visible",
      detail:
        "No hay ningún bloque visible en las páginas visibles y la portada está apagada: el cliente no vería nada.",
    });
  }
  for (const page of definition.pages) {
    if (!page.visible) {
      warnings.push({
        code: "hidden_page",
        where: { kind: "page", id: page.id },
        label: page.title,
        detail: `“${page.title}” existe pero está oculta: el cliente no la verá.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. The identity layer says what it shows
  // -------------------------------------------------------------------------
  // A field switched ON with nothing in it is a promise the page cannot keep.
  // A field switched OFF is a decision, and C11 says a decision renders as
  // silence — so it is never a finding.
  const identity = definition.identity;
  if (identity.visible) {
    const missing: string[] = [];
    if (identity.show.title && identity.title.trim() === "") missing.push("el título");
    if (identity.show.organization && !identity.organization?.trim()) missing.push("el cliente");
    if (identity.show.period && !identity.period?.trim()) missing.push("el periodo");
    if (identity.show.description && !identity.description?.trim()) {
      missing.push("la introducción");
    }
    if (missing.length > 0) {
      blockers.push({
        code: "identity_incomplete",
        where: { kind: "definition", id: definition.id },
        label: "Portada incompleta",
        detail:
          `La portada está configurada para mostrar ${missing.join(", ")}, y no hay nada escrito ahí. `
          + "Escríbelo o apaga esa parte de la portada.",
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4b. Blocks the client renderer does not draw
  // -------------------------------------------------------------------------
  const unsupportedForClient = new Set<string>(CLIENT_UNSUPPORTED_BLOCKS);
  for (const block of shown) {
    if (!unsupportedForClient.has(block.type)) continue;
    blockers.push({
      code: "not_rendered_for_client",
      where: { kind: "block", id: block.id },
      label: blockName(block),
      detail:
        `“${blockName(block)}” se ve en la vista interna como una descripción de lo que recibiría el `
        + `cliente, y la experiencia publicada todavía no lo dibuja. `
        + (CLIENT_UNSUPPORTED_ADVICE[block.type] ?? ""),
    });
  }

  // -------------------------------------------------------------------------
  // 5. A semáforo colours a number only when somebody finished writing it
  // -------------------------------------------------------------------------
  const schemes = new Map(definition.bandSchemes.map((scheme) => [scheme.id, scheme]));
  const schemeUsers: { schemeId: string; label: string; where: PublicationFinding["where"] }[] = [];
  for (const block of shown) {
    if (block.bandSchemeId) {
      schemeUsers.push({
        schemeId: block.bandSchemeId,
        label: blockName(block),
        where: { kind: "block", id: block.id },
      });
    }
  }
  const shownJourneyIds = new Set(shown.flatMap((block) => (block.journeyRef ? [block.journeyRef] : [])));
  for (const journey of definition.journeyReferences) {
    if (!shownJourneyIds.has(journey.id) || !journey.visible) continue;
    if (journey.bandSchemeId) {
      schemeUsers.push({
        schemeId: journey.bandSchemeId,
        label: journey.title,
        where: { kind: "journey", id: journey.id },
      });
    }
    for (const moment of journey.moments) {
      if (!moment.visible || !moment.bandSchemeId) continue;
      schemeUsers.push({
        schemeId: moment.bandSchemeId,
        label: `${journey.title} · ${moment.title}`,
        where: { kind: "journey", id: journey.id },
      });
    }
  }
  for (const user of schemeUsers) {
    const scheme = schemes.get(user.schemeId);
    // A missing scheme is already `unknown_reference` from the schema; this is
    // about one that exists and is half-written.
    if (!scheme) continue;
    const problems = schemeProblems(scheme);
    if (problems.length > 0) {
      blockers.push({
        code: "semaforo_incomplete",
        where: user.where,
        label: user.label,
        detail:
          `“${user.label}” pinta su resultado con el semáforo “${scheme.title}”, que todavía no está `
          + `completo: ${problems[0]} Termínalo o quítalo de este bloque.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6. An awareness percentage needs both halves
  // -------------------------------------------------------------------------
  // Schema version 3 already refuses half of one, and `twoToThree` drops a
  // legacy half rather than completing it. This is the check that says so at
  // the publication boundary as well, because "structurally impossible today"
  // is a property of one schema version and this rule outlives it.
  for (const journey of definition.journeyReferences) {
    if (!shownJourneyIds.has(journey.id) || !journey.visible) continue;
    for (const moment of journey.moments) {
      if (!moment.visible) continue;
      const awareness = moment.awareness;
      if (awareness) {
        const metric = findMetric(registry, awareness.metricId);
        if (!metric || awareness.values.length === 0) {
          blockers.push({
            code: "awareness_incomplete",
            where: { kind: "journey", id: journey.id },
            label: `${journey.title} · ${moment.title}`,
            detail:
              `“${moment.title}” muestra el porcentaje de quienes no conocían el momento, y le falta `
              + (metric ? "decir qué respuestas significan “no lo conocía”." : "el resultado que lo mide."),
          });
        }
      }
      if (!moment.metricId) {
        warnings.push({
          code: "moment_without_result",
          where: { kind: "journey", id: journey.id },
          label: `${journey.title} · ${moment.title}`,
          detail:
            `“${moment.title}” se muestra sin ningún número. Es válido si es a propósito; el cliente `
            + "verá el momento y su texto, y ninguna cifra.",
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 7. A control the client can move has to move something
  // -------------------------------------------------------------------------
  // `validate.ts` already warns `panel_moves_nothing` while a panel is being
  // built. At the publication boundary a VISIBLE panel that resolves to no
  // block is different in kind: the client will move it and nothing will
  // happen, which is the page telling them something false about itself.
  for (const block of shown) {
    if (block.type !== "filter_panel" || !block.filterPanel) continue;
    const controls = panelControls(definition, block);
    const targets = effectiveFilterTargets(definition);
    const moved = new Set(
      controls.flatMap((filter) => [...(targets.get(filter.id) ?? [])]),
    );
    if (controls.length === 0 || moved.size === 0) {
      blockers.push({
        code: "deceptive_filter_panel",
        where: { kind: "block", id: block.id },
        label: blockName(block),
        detail:
          `“${blockName(block)}” es un panel que el cliente puede usar y que no cambia ningún bloque. `
          + "Conéctalo a los bloques que debe mover, o quítalo de la página.",
      });
    } else if (moved.size > WIDE_PANEL_BLOCKS) {
      warnings.push({
        code: "wide_filter_panel",
        where: { kind: "block", id: block.id },
        label: blockName(block),
        detail:
          `“${blockName(block)}” mueve ${moved.size} bloques a la vez. Funciona, pero al cliente le `
          + "puede costar seguir qué cambió.",
      });
    }
  }

  // -------------------------------------------------------------------------
  // 8. Only approved qualitative content crosses to a client
  // -------------------------------------------------------------------------
  const approvedSources = new Set(evidence.approvedSources);
  for (const block of shown) {
    if (block.type !== "theme_cloud" && block.type !== "qualitative_themes") continue;
    const source = block.themeCloud?.source ?? null;
    const available =
      source === null
        ? evidence.approvedThemes.length > 0
        : approvedSources.has(source);
    if (!available) {
      blockers.push({
        code: "unapproved_qualitative",
        where: { kind: "block", id: block.id },
        label: blockName(block),
        detail:
          source === null
            ? `“${blockName(block)}” muestra lo que dijeron las personas, y este estudio todavía no tiene `
              + "ningún tema confirmado en la revisión cualitativa."
            : `“${blockName(block)}” lee la fuente “${source}”, y no hay ningún tema confirmado de esa `
              + "fuente. Confírmalos en la revisión cualitativa o cambia la fuente del bloque.",
      });
    }
  }

  // -------------------------------------------------------------------------
  // 9. Judgements a person is entitled to make
  // -------------------------------------------------------------------------
  for (const block of shown) {
    const spec = blockSpec(block.type);
    if (spec && spec.copy !== "none" && spec.copy !== "title_only") {
      const hasCopy = Boolean(block.copy.body?.trim()) || block.copy.items.length > 0;
      if (!hasCopy) {
        warnings.push({
          code: "empty_copy",
          where: { kind: "block", id: block.id },
          label: blockName(block),
          detail:
            `“${blockName(block)}” puede llevar una explicación y no tiene ninguna. El cliente verá el `
            + "bloque sin contexto.",
        });
      }
    }
    const metricId = block.query?.metricId ?? null;
    if (metricId) {
      const metric = findMetric(registry, metricId);
      if (metric && metric.responses > 0 && metric.responses < LOW_SAMPLE_RESPONSES) {
        warnings.push({
          code: "low_sample",
          where: { kind: "block", id: block.id },
          label: blockName(block),
          detail:
            `“${metric.label}” descansa en ${metric.responses} respuestas. La regla de muestra del `
            + "estudio decide si se muestra y cómo se advierte.",
        });
      }
    }
  }

  // Configured and never placed. Three things can be in this state, and all
  // three are worth saying once.
  const placedJourneys = new Set(shown.flatMap((block) => (block.journeyRef ? [block.journeyRef] : [])));
  for (const journey of definition.journeyReferences) {
    if (!placedJourneys.has(journey.id)) {
      warnings.push({
        code: "feature_not_placed",
        where: { kind: "journey", id: journey.id },
        label: journey.title,
        detail: `El recorrido “${journey.title}” está definido y no aparece en ninguna página visible.`,
      });
    }
  }
  const usedSchemes = new Set(schemeUsers.map((user) => user.schemeId));
  for (const scheme of definition.bandSchemes) {
    if (!usedSchemes.has(scheme.id)) {
      warnings.push({
        code: "feature_not_placed",
        where: { kind: "band", id: scheme.id },
        label: scheme.title,
        detail: `El semáforo “${scheme.title}” está escrito y no lo usa ningún bloque visible.`,
      });
    }
  }
  const hostedFilters = new Set(
    allBlocks(definition).flatMap((block) => block.filterRefs).concat(
      definition.pages.flatMap((page) => page.filterRefs),
    ),
  );
  for (const filter of definition.filterDefinitions) {
    if (!hostedFilters.has(filter.id)) {
      const dimension = findDimension(registry, filter.dimensionId);
      warnings.push({
        code: "feature_not_placed",
        where: { kind: "filter", id: filter.id },
        label: filter.label || dimension?.label || "Un filtro",
        detail:
          `El filtro “${filter.label || dimension?.label || filter.id}” está definido y ningún panel `
          + "ni página ofrece su control.",
      });
    }
  }

  // -------------------------------------------------------------------------
  // 10. Has the world moved since this revision was prepared
  // -------------------------------------------------------------------------
  if (input.prepared) {
    const current = input.currentDraftRevision ?? null;
    if (current === null || current !== input.prepared.sourceDraftRevision) {
      blockers.push({
        code: "draft_moved_on",
        where: { kind: "definition", id: definition.id },
        label: "La revisión quedó desactualizada",
        detail:
          current === null
            ? "El borrador del que salió esta revisión ya no existe. Prepara una revisión nueva."
            : `Esta revisión se preparó sobre la versión ${input.prepared.sourceDraftRevision} del `
              + `borrador y el borrador ya va en la ${current}. Prepara una revisión nueva para publicar lo último.`,
      });
    }
    if (
      input.currentStudyFingerprint
      && input.currentStudyFingerprint !== input.prepared.studyFingerprint
    ) {
      warnings.push({
        code: "study_configuration_moved",
        where: { kind: "definition", id: definition.id },
        label: "El estudio cambió",
        detail:
          "La configuración del estudio — sus resultados, la regla de muestra o el agrupado de "
          + "categorías — cambió desde que se preparó esta revisión. Los números se calculan con lo "
          + "de hoy; revisa que la revisión siga diciendo lo que querías.",
      });
    }
  }

  return {
    blockers,
    warnings,
    blockerCodes: sortedUnique(blockers.map((finding) => finding.code)),
    warningCodes: sortedUnique(warnings.map((finding) => finding.code)),
  };
}

/**
 * Whether an acknowledgement covers exactly the warnings that are on screen.
 *
 * EXACTLY, in both directions. A missing code means somebody is publishing a
 * warning they never saw; an extra code means the acknowledgement is about a
 * document that is not this one. Either way the honest answer is to look again,
 * so both are refused and the caller is told which it is.
 */
export function acknowledgementMatches(
  required: readonly string[],
  acknowledged: readonly string[],
): { ok: true } | { ok: false; missing: string[]; unexpected: string[] } {
  const need = new Set(required);
  const have = new Set(acknowledged);
  const missing = [...need].filter((code) => !have.has(code)).sort();
  const unexpected = [...have].filter((code) => !need.has(code)).sort();
  if (missing.length === 0 && unexpected.length === 0) return { ok: true };
  return { ok: false, missing, unexpected };
}
