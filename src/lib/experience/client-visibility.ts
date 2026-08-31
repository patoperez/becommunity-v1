/**
 * Contract C11, applied to a composed experience: absence is not a
 * client-facing finding.
 *
 * WHAT THIS FILE STOPS FROM HAPPENING. `BlockView` is the honest INTERNAL
 * drawing of a block, and it is honest in the way an internal screen must be:
 * a block pointing at nothing says "este bloque todavía no apunta a un
 * resultado", a block whose numbers were not computed says so, a drawing this
 * build does not implement says which one is missing. Every one of those
 * sentences is correct, useful, and addressed to the person composing.
 *
 * A CLIENT MUST NEVER READ ANY OF THEM. What Be Community chose not to publish,
 * or has not finished, renders as NOTHING on a client's screen — no card, no
 * heading, no reserved row, no explanatory copy. So the client renderer asks
 * this function first, and a block that would have produced one of those
 * sentences is simply not rendered: no `<li>`, no gap in the grid, no trace.
 *
 * WHAT IS DELIBERATELY NOT SILENCED. A caveat about a result the client IS
 * shown — a small base, a suppressed segment, a missing value behind a visible
 * number — stays exactly where it is. That is analytical honesty rather than an
 * omission, and hiding it would be the opposite failure: a client reading a
 * number without being told what it rests on. The line is between "we are not
 * showing you this" (silence) and "here it is, and here is what it rests on"
 * (say it).
 *
 * IT IS PURE, so the gate can drive every branch with a literal document and a
 * literal data set, which is the only way to prove a negative like "no internal
 * sentence can reach a client".
 */

import { blockSpec } from "./blocks";
import { dataKeyForBlock, dataKeyForThemes, type BlockDataSet } from "./data";
import type { ExperienceBlock, ExperienceDefinitionV1, ExperiencePage } from "./definition";
import { effectiveFilterTargets, panelControls } from "./filters";
import { evaluateSampleVisibility, resolveSamplePolicy } from "./sample-policy";

/** What the client renderer knows about the study, beyond the numbers. */
export type ClientEvidenceSummary = {
  /** Approved themes only. Never a pending one, never a quote. */
  themes: readonly { label: string; count: number; n: number }[];
  /** Results the comparison explorer could offer. */
  crossableResults: number;
  /** Whether a downloadable report genuinely exists for this study. */
  reportAvailable: boolean;
};

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function blockHasCopy(block: ExperienceBlock): boolean {
  return (
    hasText(block.title)
    || hasText(block.copy.body)
    || hasText(block.copy.eyebrow)
    || hasText(block.copy.caption)
    || block.copy.items.length > 0
  );
}

/**
 * Whether a resolved data entry carries anything a reader could look at.
 *
 * Three ways it does not: the block points at something the study no longer
 * produces (`ok: false`), nobody answered (`overall.n === 0` and no category
 * has an answer), or the study's own disclosure rule withholds the whole thing.
 * The third is the subtle one — a partially suppressed chart still renders,
 * because the values it does show are real and the ones it withholds are named
 * by the drawing itself.
 */
export function dataHasContent(
  entry: BlockDataSet[string] | undefined,
  definition: ExperienceDefinitionV1,
  block: ExperienceBlock,
): boolean {
  if (!entry || !entry.ok) return false;
  const data = entry.data;
  const policy = resolveSamplePolicy(definition.sampleVisibilityPolicy, block.query?.samplePolicy);

  const cells = data.series.flatMap((series) => series.cells);
  const anyCellVisible = cells.some((cell) => {
    if (cell.value === null || cell.n === 0) return false;
    return evaluateSampleVisibility(cell.n, policy).state !== "suppressed";
  });
  if (anyCellVisible) return true;

  if (data.overall.value === null || data.overall.n === 0) return false;
  return evaluateSampleVisibility(data.overall.n, policy).state !== "suppressed";
}

/**
 * Whether one block reaches the client at all.
 *
 * Ordered by block type rather than by a generic rule, because "what makes this
 * block worth rendering" genuinely differs: a paragraph needs words, a chart
 * needs a number, a panel needs something to move, and a recorrido needs a
 * moment somebody chose to show.
 */
export function blockReachesClient(input: {
  block: ExperienceBlock;
  definition: ExperienceDefinitionV1;
  data: BlockDataSet;
  evidence: ClientEvidenceSummary;
}): boolean {
  const { block, definition, data, evidence } = input;
  if (!block.visible || !block.layout.desktop.visible) return false;

  switch (block.type) {
    case "divider":
    case "spacer":
      // Pure spacing. It carries no claim, so it can never carry a false one —
      // but it is also meaningless on its own, and the renderer drops a
      // separator that would end up first or last after everything around it
      // was dropped. That trimming happens in `visibleBlocksForClient`.
      return true;

    case "section":
    case "rich_text":
    case "finding":
    case "interpretation":
    case "recommendation":
      return blockHasCopy(block);

    case "cover":
      // Legacy only: version 2 moved identity into its own global layer and the
      // migration removes the block. One that survives an older document is
      // rendered when it has words and dropped when it does not.
      return blockHasCopy(block);

    case "image":
      return block.image !== null;

    case "report_download":
      // Only where it is truthfully supported. Offering a download that does
      // not exist is the most concrete possible version of the page lying.
      return evidence.reportAvailable;

    case "all_results_disclosure":
    case "pivot_explorer":
      return evidence.crossableResults > 0;

    case "theme_cloud":
    case "qualitative_themes": {
      const entry = data[dataKeyForThemes(block.id)];
      if (entry && entry.ok && (entry.data.themes?.length ?? 0) > 0) return true;
      // A cloud with no computed themes falls back to nothing rather than to
      // the study-wide summary: a block configured for one source must not
      // quietly show another source's words.
      return false;
    }

    case "journey": {
      if (!block.journeyRef) return false;
      const journey = definition.journeyReferences.find(
        (candidate) => candidate.id === block.journeyRef,
      );
      if (!journey || !journey.visible) return false;
      return journey.moments.some((moment) => moment.visible);
    }

    case "filter_panel": {
      if (!block.filterPanel) return false;
      const controls = panelControls(definition, block);
      if (controls.length === 0) return false;
      const targets = effectiveFilterTargets(definition);
      return controls.some((filter) => (targets.get(filter.id)?.size ?? 0) > 0);
    }

    case "metric":
    case "chart":
    case "comparison":
    case "retention":
      return dataHasContent(data[dataKeyForBlock(block.id)], definition, block);

    default: {
      // A block type this build does not know about is not guessed at. The
      // exhaustive cases above cover every declared type; this is the branch
      // that runs if one is added and this file is not updated, and it chooses
      // silence over a shape nobody designed.
      const spec = blockSpec(block.type);
      return spec ? false : false;
    }
  }
}

/**
 * The blocks of one page, in reading order, with everything a client must not
 * see removed — and then the separators that no longer separate anything.
 *
 * The trimming matters more than it sounds. A page whose three charts were all
 * withheld would otherwise render as two horizontal rules and a spacer: an
 * empty frame that says "something was here", which is exactly the placeholder
 * C11 forbids.
 */
export function visibleBlocksForClient(input: {
  page: ExperiencePage;
  definition: ExperienceDefinitionV1;
  data: BlockDataSet;
  evidence: ClientEvidenceSummary;
}): ExperienceBlock[] {
  const { page, definition, data, evidence } = input;
  const kept = [...page.blocks]
    .sort((a, b) => a.layout.desktop.order - b.layout.desktop.order)
    .filter((block) => blockReachesClient({ block, definition, data, evidence }));

  const structural = (block: ExperienceBlock) =>
    block.type === "divider" || block.type === "spacer";

  // Drop leading and trailing separators, then collapse runs of them.
  const trimmed: ExperienceBlock[] = [];
  for (const block of kept) {
    if (structural(block)) {
      if (trimmed.length === 0) continue;
      const previous = trimmed[trimmed.length - 1];
      if (structural(previous)) continue;
    }
    trimmed.push(block);
  }
  while (trimmed.length > 0 && structural(trimmed[trimmed.length - 1])) trimmed.pop();

  // A section heading whose entire section came out empty is a heading over
  // nothing. It is dropped for the same reason a separator is.
  const withoutEmptySections: ExperienceBlock[] = [];
  for (let index = 0; index < trimmed.length; index += 1) {
    const block = trimmed[index];
    if (block.type === "section") {
      const next = trimmed[index + 1];
      if (!next || next.type === "section") continue;
    }
    withoutEmptySections.push(block);
  }
  return withoutEmptySections;
}

/** The pages a client can actually open: visible, and with something on them. */
export function visiblePagesForClient(input: {
  definition: ExperienceDefinitionV1;
  data: BlockDataSet;
  evidence: ClientEvidenceSummary;
}): { page: ExperiencePage; blocks: ExperienceBlock[] }[] {
  return [...input.definition.pages]
    .filter((page) => page.visible)
    .sort((a, b) => a.order - b.order)
    .map((page) => ({
      page,
      blocks: visibleBlocksForClient({
        page,
        definition: input.definition,
        data: input.data,
        evidence: input.evidence,
      }),
    }))
    .filter((entry) => entry.blocks.length > 0);
}
