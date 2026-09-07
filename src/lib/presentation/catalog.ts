/**
 * THE CATALOGUE PROJECTION — the registry, minus the half a client may not have.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * An editor eventually needs to know what it may bind to: which handles exist,
 * what each one means, how it may be drawn, whether a value is there, and which
 * filters it accepts or refuses. All of that is describable and all of it lives
 * in `RegistryEntry`.
 *
 * What an editor must NOT have is the binding itself. `registry.addresses` says
 * where a value sits inside the results document, and it stays on the server —
 * not because an array index is dangerous on its own, but because the moment a
 * client holds addresses, the temptation is to resolve one, and resolving one
 * client-side is how a browser starts owning a number.
 *
 * This projection is therefore a DROP, not a transform: every field it keeps is
 * copied unchanged from an entry that was already client-safe, and the one
 * field it removes is removed entirely. There is nothing to get subtly wrong,
 * which is the property worth having at a boundary.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ResultUnit } from "../results/contract";
import type {
  ChartVariant,
  PresentationAvailability,
  PresentationSemantic,
  ProvenanceCategory,
} from "./capabilities";
import type { PresentationHandle } from "./handles";

/**
 * The base a result rests on, at the coarseness a client may be shown.
 *
 * The three counts and nothing else: `AnswerAccounting`'s nine fields are an
 * auditor's tool, and publishing them per block would invite a surface to
 * recombine them — which is arithmetic, which is forbidden here.
 */
export type ResponseContext = {
  eligible: number;
  responded: number;
  valid: number;
};

/** One thing a presentation may name. Every field is client-safe. */
export type RegistryEntry = {
  handle: PresentationHandle;
  semantic: PresentationSemantic;
  /** Display text the client is already shown. Never a key. */
  label: string;
  /** The units this entry's values are already expressed in. */
  displayFormats: readonly ResultUnit[];
  /** The variants that may draw it. */
  compatibleVariants: readonly ChartVariant[];
  availability: PresentationAvailability;
  /** Null for structural entries that rest on no single base. */
  responseContext: ResponseContext | null;
  provenance: ProvenanceCategory;
  /** Filter dimensions this entry accepts, as handles. */
  supportedFilters: readonly PresentationHandle[];
  /** Filter dimensions an authority forbids crossing with it, as handles. */
  forbiddenFilters: readonly PresentationHandle[];
  /**
   * For a journey group: the touchpoint handles the SOURCE placed in it, in the
   * source's own order. Empty for everything else.
   *
   * This is the four-group evidence. The five VISIBLE routes the approved
   * dashboard draws are presentation configuration and live in the document,
   * never here — a route is a decision, a group is a fact.
   */
  members: readonly PresentationHandle[];
};

/** One catalogue row. Structurally an entry; nominally a promise about safety. */
export type PresentationCatalogEntry = RegistryEntry;

/** Everything an editor may know about what it can bind to. */
export type PresentationCatalog = {
  registryVersion: string;
  contractVersion: string;
  entries: readonly PresentationCatalogEntry[];
};
