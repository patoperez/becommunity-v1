/**
 * ONE PLACE WHERE A DOCUMENT MEETS A STUDY'S ROWS.
 *
 * Four surfaces resolve a composed document's numbers: the builder's workspace,
 * the draft preview's page, the preview's refresh action and the builder's own
 * refresh action. Each of them has to do the same three things in the same
 * order — widen the registry with whatever the DOCUMENT derives, widen the
 * handle index to match, and add the derived columns to the rows before any
 * aggregate is computed over them.
 *
 * Four copies of that sequence is four chances for one of them to drift, and a
 * surface that forgot step three would silently narrow to nothing when somebody
 * filtered by "Rojo" — a wrong answer that looks like an honest empty state. So
 * the sequence lives here, once, and every surface calls this.
 *
 * IT ADDS NOTHING THE DOCUMENT DID NOT ASK FOR. A study with no configured
 * semáforo gets exactly the registry, index and rows the canonical loader
 * produced, unchanged and uncopied.
 */

import type { LongRow } from "@/lib/calc/engine";
import type { ConfirmedQualitative } from "@/lib/qualitative/published";

import {
  indexWithDerivedBands,
  registryWithDerivedBands,
  withDerivedBandColumns,
} from "./band-filters";
import {
  resolveDefinitionData,
  type BlockDataSet,
  type RegistryKeyIndex,
  type ViewerSelection,
} from "./data";
import type { ExperienceDefinitionV1 } from "./definition";
import { effectiveFilterTargets, filterDimensionKinds } from "./filters";
import type { SemanticRegistry } from "./registry";

export type ResolvedExperience = {
  /** The study's registry, plus every characteristic the document derives. */
  registry: SemanticRegistry;
  index: RegistryKeyIndex;
  rows: readonly LongRow[];
  data: BlockDataSet;
};

export function resolveExperience(input: {
  rows: readonly LongRow[];
  registry: SemanticRegistry;
  index: RegistryKeyIndex;
  definition: ExperienceDefinitionV1;
  selection?: ViewerSelection;
  confirmed?: readonly ConfirmedQualitative[];
}): ResolvedExperience {
  const registry = registryWithDerivedBands(input.definition, input.registry);
  const index = indexWithDerivedBands(input.definition, input.index);
  const rows = withDerivedBandColumns(input.rows, input.definition, index);
  const movedBy = effectiveFilterTargets(
    input.definition,
    filterDimensionKinds(input.definition, registry),
  );
  return {
    registry,
    index,
    rows,
    data: resolveDefinitionData(
      rows,
      registry,
      index,
      input.definition,
      input.selection,
      movedBy,
      input.confirmed ?? [],
    ),
  };
}
