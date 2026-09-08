/**
 * THE COMPOSER — the Studio authoring engine, and nothing that knows a study.
 *
 * Everything reachable from here is pure: functions over a
 * `PresentationDocument` and a `PresentationCatalog`, both of which are already
 * client-safe by construction. There is no transport, no storage, no clock, no
 * randomness and no canonical address anywhere behind this barrel, which is why
 * a `"use client"` composer surface may import it and an offline gate may drive
 * it without a database.
 *
 * It lives OUTSIDE `src/lib/presentation/` on purpose. That directory is held to
 * a stricter rule than this one — the presentation gate proves it contains no
 * `Math.`, no division and no multiplication anywhere, because it is the layer
 * that must be shown never to compute a study quantity. Deterministic id
 * minting is 32-bit hashing and is nothing but multiplication. Putting it there
 * would have meant either weakening that proof or writing a worse hash, and
 * both are bad trades for a file that has no business near a number.
 */

export {
  COMPOSER_HISTORY_DEPTH,
  COMPOSER_LIMITS,
  addBlock,
  addPage,
  adoptDocument,
  blockIsFilterable,
  catalogEntry,
  connectBlockToPanel,
  connectionCandidates,
  disconnectBlockFromPanel,
  dropIndexFor,
  duplicateBlock,
  duplicatePage,
  findBlock,
  findPage,
  moveBlock,
  moveBlockToIndex,
  movePage,
  movePageToIndex,
  openComposer,
  openPage,
  panelsMoving,
  redo,
  removeBlock,
  removePage,
  renamePage,
  selectBlock,
  setBlockBinding,
  setBlockCopy,
  setBlockDisclosure,
  setBlockDisplayFormat,
  setBlockResponsive,
  setBlockSamplePolicy,
  setBlockSpan,
  setBlockVisibility,
  setChartVariant,
  setDocumentDisclosure,
  setDocumentSamplePolicy,
  setEditorialBody,
  togglePanelDimension,
  undo,
} from "./editor";
export type {
  AddBlockRequest,
  ComposerContext,
  ComposerRefusal,
  ComposerRefusalCode,
  ComposerState,
  CopyField,
  IneligibleReason,
} from "./editor";

export {
  COMPOSER_ID_PATTERN,
  composerId,
  composerToken,
  mintFreeComposerId,
  takenComposerIds,
} from "./ids";
export type { ComposerIdKind } from "./ids";

export type {
  BlueprintChoice,
  ComposerPayload,
  ComposerUnavailable,
  ComposerUnavailableReason,
  ComposerWorkspace,
  LoadDraft,
  LoadResult,
  PersistenceState,
  PreviewResult,
  RefreshPreview,
  SaveDraft,
  SaveRefusalReason,
  SaveResult,
} from "./payload";

/**
 * THE SAVE SESSION — durable-draft state, and the transitions that keep it
 * honest. Pure: no timer, no transport, no clock.
 */
export {
  IDEMPOTENCY_KEY_PATTERN,
  SAVE_STATE_LABEL,
  acceptSaveResponse,
  adoptStoredVersion,
  autosaveIsDue,
  beginSave,
  canSave,
  dismissSaveFailure,
  documentChanged,
  hasUnsavedChanges,
  openSaveSession,
  retryAttempt,
} from "./save-session";
export type { SaveAttempt, SaveSession, SaveState } from "./save-session";

export {
  IMPLEMENTED_BY_SEMANTIC,
  JOURNEY_ROUTES_VARIANTS,
  IMPLEMENTED_CHART_VARIANTS,
  chartVariantIsImplemented,
  judgeChartVariant,
  offeredChartVariants,
} from "./renderer-capabilities";
export type { VariantRefusal } from "./renderer-capabilities";

/**
 * THE READING SESSION — a reader's own ephemeral state, kept out of the
 * document and out of the edit history on purpose.
 */
export {
  acceptViewerResponse,
  dismissViewerMessage,
  openViewerSession,
  requestViewerCleared,
  requestViewerOption,
  requestViewerPanelCleared,
  requestViewerSelection,
  viewerSessionIsNeutral,
  viewerSessionIsSettled,
} from "./viewer-session";
export type { ViewerResponse, ViewerSession, ViewerSessionStatus } from "./viewer-session";
