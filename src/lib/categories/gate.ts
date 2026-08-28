/**
 * What an unreviewed category question is allowed to stop.
 *
 * THE POSITION THIS FILE TAKES. Importing is never blocked. Saving is never
 * blocked. Working is never blocked. The only thing an unanswered category
 * question can hold up is PUBLICATION — the moment the number stops being an
 * internal draft and becomes something a school acts on.
 *
 * AND EVEN THEN, ALMOST NOTHING BLOCKS. A gate that fires often is a gate that
 * gets satisfied rather than answered: the fastest way past "you must decide
 * this" is to click the merge, which is the exact false merge this whole
 * feature exists to prevent. So the bar is deliberately narrow and every clause
 * of it is doing work:
 *
 *   DETERMINISTIC ONLY. A machine-measured resemblance never blocks anything.
 *   Neither does a model: `ai` is not in the list, cannot be added to it by
 *   configuration, and the gate reads the RULE that found the candidate rather
 *   than any confidence attached to it.
 *
 *   HIGH CONFIDENCE ONLY. `unicode` means the two values are the same text
 *   differently encoded — they are indistinguishable on screen, and shipping
 *   both is a defect on its face. `accent` and `punctuation` are strong but not
 *   certain, so they block only when they also matter.
 *
 *   MATERIAL ONLY. One respondent in a characteristic nothing is broken down
 *   by does not hold up a report.
 *
 * THREE WAYS PAST A BLOCK, ALL OF THEM HONEST: group them, record that they
 * stay separate, or postpone with a written reason. Every one of the three is a
 * decision in the ledger with an author and a timestamp. There is no fourth way
 * and no override flag, because an override flag is the one people use.
 *
 * Pure. `setStudyPublication` re-derives this server-side from the database, so
 * a caller that never opened the review screen is refused there too.
 */

import { DETERMINISTIC_RULES } from "./normalize";
import type { CandidateGroup } from "./candidates";
import type { CandidateImpact } from "./impact";

/**
 * How many people must actually CHANGE BUCKET before a `strong` candidate can
 * hold up a publication.
 *
 * Measured on the moved count, not the affected count. Every pair affects at
 * least two people by definition — one per spelling — so a threshold on
 * "affected" is a threshold that is always met, which is no threshold at all.
 * "Moved" is the number who stop being counted under the wording they chose,
 * and a merge that moves one person out of sixty is housekeeping.
 */
export const MIN_BLOCKING_MOVED = 2;
/** And it must reach this share of the characteristic, or the published reading. */
export const MIN_BLOCKING_SHARE = 0.05;

export type GateVerdict = "blocks" | "warns" | "quiet";

export type GateFinding = {
  dimensionKey: string;
  groupKey: string;
  verdict: GateVerdict;
  /** One sentence, in the words the publication screen will use. */
  summary: string;
  /** Why this verdict and not a stronger or weaker one. */
  because: string;
};

/**
 * The verdict for one undecided candidate.
 *
 * `quiet` means the question is worth asking on the review screen and is not
 * worth mentioning on the publication screen. Most candidates are quiet, and
 * that is the intended distribution.
 */
export function gateVerdict(group: CandidateGroup, impact: CandidateImpact): GateFinding {
  const deterministic = DETERMINISTIC_RULES.includes(group.rule);
  const names = group.values.map((value) => `“${value.raw}”`).join(" y ");
  const people =
    impact.affectedRespondents === 1
      ? "1 persona"
      : `${impact.affectedRespondents} personas`;

  if (!deterministic) {
    return {
      dimensionKey: group.dimensionKey,
      groupKey: group.groupKey,
      verdict: impact.materiality >= 0.4 ? "warns" : "quiet",
      summary: `${names} podrían querer decir lo mismo (${people}).`,
      because:
        "Es un parecido de redacción, no una diferencia de escritura. Un parecido nunca impide " +
        "publicar: sólo una persona que conozca los cuestionarios puede decidirlo.",
    };
  }

  // TWO ANSWERS THAT RENDER IDENTICALLY. They differ only by an invisible
  // character or an exotic space, so on every screen, in every filter and in
  // the PDF they are the same string appearing twice with two different counts.
  // There is no size at which shipping that to a client is acceptable, and it
  // is rare enough that blocking outright costs nobody a working day.
  if (group.strength === "equivalent") {
    return {
      dimensionKey: group.dimensionKey,
      groupKey: group.groupKey,
      verdict: "blocks",
      summary: `${names} se ven idénticas en pantalla y se cuentan por separado (${people}).`,
      because:
        "Sólo se diferencian por caracteres invisibles o espacios especiales. El cliente vería " +
        "dos opciones que no puede distinguir, con cifras distintas. Decide antes de publicar.",
    };
  }

  // AN ACCENT OR A PUNCTUATION MARK. Strong evidence, not proof: "Publico" and
  // "Público" is a plausible typo and also two different words. It holds up a
  // publication only when it would actually move a visible number.
  //
  // `reachesClient` is deliberately NOT part of this test. It is true of every
  // surface of every published study, so including it would block on almost
  // every accent pair — and a gate that fires on everything is answered by
  // clicking the merge, which is the false merge this feature exists to
  // prevent. It amplifies a warning; it does not create a blocker.
  const substantial = impact.movedRespondents >= MIN_BLOCKING_MOVED;
  const visible =
    impact.shareOfDimension >= MIN_BLOCKING_SHARE || impact.narrativeMentions.length > 0;

  if (substantial && visible) {
    return {
      dimensionKey: group.dimensionKey,
      groupKey: group.groupKey,
      verdict: "blocks",
      summary: `${names} se diferencian sólo por acentos o puntuación (${people}).`,
      because:
        impact.narrativeMentions.length > 0
          ? "Además aparecen con esas palabras en la lectura que el equipo ya publicó, así que " +
            "el texto y las cifras dirían cosas distintas."
          : `${impact.movedRespondents} personas cambiarían de categoría, el ` +
            `${Math.round(impact.shareOfDimension * 100)}% de quienes respondieron esta ` +
            "característica.",
    };
  }

  return {
    dimensionKey: group.dimensionKey,
    groupKey: group.groupKey,
    verdict: impact.reachesClient ? "warns" : "quiet",
    summary: `${names} se diferencian sólo por acentos o puntuación (${people}).`,
    because: substantial
      ? "Afecta a una parte pequeña de la característica, así que no detiene la publicación."
      : "Casi nadie cambiaría de categoría, así que no detiene la publicación.",
  };
}

export type GateSummary = {
  blocking: GateFinding[];
  warnings: GateFinding[];
  /** Questions worth asking, not worth mentioning before publishing. */
  quiet: GateFinding[];
  canPublish: boolean;
  /** One line for the publication screen. */
  summary: string;
};

/**
 * The gate over every UNDECIDED candidate in a study.
 *
 * The caller passes only candidates with no current decision — a grouped,
 * separate or postponed group has been answered and is not a finding here. That
 * filtering happens at the load boundary so this stays a pure statement of the
 * rule.
 */
export function categoryGate(
  entries: readonly { group: CandidateGroup; impact: CandidateImpact }[],
): GateSummary {
  const findings = entries.map((entry) => gateVerdict(entry.group, entry.impact));
  const blocking = findings.filter((finding) => finding.verdict === "blocks");
  const warnings = findings.filter((finding) => finding.verdict === "warns");
  const quiet = findings.filter((finding) => finding.verdict === "quiet");

  return {
    blocking,
    warnings,
    quiet,
    canPublish: blocking.length === 0,
    summary: summarize(blocking.length, warnings.length),
  };
}

function summarize(blocking: number, warnings: number): string {
  if (blocking === 1) {
    return "Hay una diferencia de escritura sin decidir que impide publicar.";
  }
  if (blocking > 1) {
    return `Hay ${blocking} diferencias de escritura sin decidir que impiden publicar.`;
  }
  if (warnings === 1) {
    return "Hay una posible categoría repetida. Puedes publicar de todos modos.";
  }
  if (warnings > 1) {
    return `Hay ${warnings} posibles categorías repetidas. Puedes publicar de todos modos.`;
  }
  return "No hay categorías pendientes de revisar.";
}
