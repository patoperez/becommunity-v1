/**
 * Canonical multi-file package parsing and preflight (Unit 2).
 *
 * This module PARSES AND VALIDATES ONLY. It contains no Supabase client, no
 * insert, no RPC and no write of any kind, and nothing here reaches a canonical
 * table. The transactional commit and its rollback are Unit 3.
 */
export { preflightCanonicalPackage } from "./preflight";
export type { PreflightFileInput } from "./preflight";
export {
  CANONICAL_PACKAGE_SPECS,
  CUICUILCO_PACKAGE_SPEC_V1,
} from "./spec";
export type {
  AssetRoleSpec,
  CanonicalPackageSpec,
  CanonicalSheetSpec,
  ColumnEntitySheetSpec,
  RowRecordSheetSpec,
} from "./spec";
export {
  fileHash,
  packageIdempotencyKey,
  sheetSignature,
  structuralSignature,
} from "./fingerprint";
export { SheetView, WorkbookView, columnLetters, columnNumber, columnRange } from "./sheet-view";
export {
  ABSENCE_STATES,
  classifySourceValue,
  isPopulated,
  isSpreadsheetError,
  normalizeLoose,
  normalizeToken,
  normalizeWhitespace,
  readNumeric,
} from "./values";
export type { AbsenceState, ClassifiedValue, SourceValueStatus } from "./values";
export type {
  AliasCandidate,
  CanonicalPackagePreflight,
  ExpectationResult,
  FindingSeverity,
  FormulaReconciliation,
  PreflightAsset,
  PreflightFinding,
  PreflightSheet,
  VisualEvidence,
} from "./types";
export { FINDING_SEVERITIES } from "./types";
