/**
 * The canonical package preflight contract.
 *
 * Unit 2 reads and validates a multi-file study package. It writes NOTHING:
 * no Supabase call, no canonical row, no legacy row. Its whole output is the
 * DTO below, which an operator reads before deciding whether a later unit may
 * commit anything at all.
 *
 * PRIVACY IS PART OF THE TYPE. Every field here is either structure (sheet
 * names, coordinates, counts, hashes, colours) or a message the product wrote.
 * No respondent name, no answer, no qualitative text and no identifier value
 * appears anywhere in this shape, and none may be added: the preflight is
 * shown in an internal screen, logged, and stored on `import_job.error_report`,
 * so anything placed here is copied into all three. A finding says WHERE the
 * problem is — sheet and cell — and lets the human open the source workbook.
 */

export const FINDING_SEVERITIES = ["blocker", "warning", "info"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/**
 * One thing the preflight noticed.
 *
 * `code` is stable and machine-readable, so a later unit, a test or an
 * operator's saved filter can refer to a finding without matching Spanish
 * prose. `message` is the Spanish sentence the operator reads.
 */
export type PreflightFinding = {
  code: string;
  severity: FindingSeverity;
  /** Semantic role of the file, or null when the finding is package-level. */
  assetRole: string | null;
  /** Exact source worksheet name, or null when the finding is file-level. */
  sheet: string | null;
  /** `B6`, `B6:S6`, or a column letter. Null when not cell-specific. */
  coordinate: string | null;
  message: string;
  expected: number | string | null;
  actual: number | string | null;
};

/** An expectation from the approved mapping, and what the package really has. */
export type ExpectationResult = {
  code: string;
  label: string;
  assetRole: string | null;
  sheet: string | null;
  coordinate: string | null;
  expected: number;
  actual: number;
  satisfied: boolean;
};

/** What one worksheet physically contains. Structure only. */
export type PreflightSheet = {
  /** The name EXACTLY as the source spells it — lineage depends on this. */
  name: string;
  /** Whitespace-normalised name, which is all that matching may use. */
  normalizedName: string;
  index: number;
  state: "visible" | "hidden" | "veryHidden";
  /** True when the specification asked for this sheet. */
  expected: boolean;
  maxRow: number;
  maxColumn: number;
  populatedCells: number;
  mergedRanges: number;
};

/**
 * Style evidence, counted and never interpreted.
 *
 * A fill colour means different things on different sheets of the same study —
 * a metric band here, a curated warning there, a structural group elsewhere.
 * The preflight reports how much evidence exists and where; deciding what a
 * colour means belongs to a configured `visual_annotation`, reviewed by a human.
 */
export type VisualEvidence = {
  assetRole: string;
  sheet: string;
  /** Cells whose style carries an explicit ARGB/RGB fill. */
  explicitFillCells: number;
  /** Cells filled through a theme reference, which stores no colour. */
  themeFillCells: number;
  mergedRanges: number;
  /** Distinct explicit fills, most frequent first. Bounded. */
  fills: Array<{ rgb: string; cells: number }>;
};

/**
 * Formula cells, and whether the file carries the value they produced.
 *
 * A `<f>` with no cached `<v>` is a cell nobody ever evaluated. Read as an
 * empty string it becomes a missing answer; coerced it becomes a zero. Both
 * are wrong, and both are silent, so the count is surfaced with coordinates.
 */
export type FormulaReconciliation = {
  assetRole: string;
  sheet: string;
  formulaCells: number;
  withCachedValue: number;
  withoutCachedValue: number;
  /** Coordinates of uncached formula cells, bounded and sorted. */
  uncachedCoordinates: string[];
};

/**
 * A column whose values differ only in case, accents or spacing.
 *
 * The VALUES are deliberately absent. Merging "No recuperé nada" into
 * "No he recuperado nada" is a versioned, human-approved decision, and the
 * screen that asks for that decision reads the source through its own
 * authorised path. This DTO only says: this column, this many spellings,
 * these coordinates — go and look.
 */
export type AliasCandidate = {
  assetRole: string;
  sheet: string;
  column: string;
  /** Distinct raw spellings that collapse to one normalised value. */
  variants: number;
  /** Rows carrying one of those spellings. */
  occurrences: number;
  /** Bounded, sorted sample of coordinates a reviewer can open. */
  sampleCoordinates: string[];
};

/** One uploaded file, as the preflight understood it. */
export type PreflightAsset = {
  /** Resolved semantic role, or null when the signature matched none. */
  role: string | null;
  /**
   * The operator's own file name, echoed so they can tell the two uploads
   * apart. It is NEVER identity: roles come from structure, and the package
   * key is built from content hashes.
   */
  fileName: string;
  sizeBytes: number;
  /** `sha256:<64 hex>` of the exact uploaded bytes. */
  sha256: string;
  /** Hash of the sheet-name shape; the same for every re-export of a book. */
  sheetSignature: string;
  /** Hash of shape plus extents; identifies this particular export. */
  structuralSignature: string;
  dateSystem: "1900" | "1904" | null;
  sheets: PreflightSheet[];
  /** Sheets the specification did not ask for. A warning, never a blocker. */
  unexpectedSheets: string[];
  /** Required sheets this file does not have. */
  missingSheets: string[];
  /** Set when the file could not be read at all. */
  readError: string | null;
};

export type CanonicalPackagePreflight = {
  specId: string;
  specLabel: string;
  mappingVersion: number;
  /**
   * `sha256:<64 hex>` derived from the mapping version, the semantic roles and
   * the file hashes in canonical order — never from a file name or an upload
   * order. Null while any role is unresolved, because an undecided package has
   * no identity to be idempotent about.
   */
  packageIdempotencyKey: string | null;
  assets: PreflightAsset[];
  expectations: ExpectationResult[];
  findings: PreflightFinding[];
  visualEvidence: VisualEvidence[];
  formulaReconciliation: FormulaReconciliation[];
  aliasCandidates: AliasCandidate[];
  counts: { blockers: number; warnings: number; info: number };
  /** False whenever a single blocker exists. Nothing may be committed. */
  confirmationAllowed: boolean;
};
