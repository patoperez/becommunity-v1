/**
 * TYPED PRESENTATION FAILURES — every refusal has a code, and the code is closed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A CODE AND NOT A MESSAGE.
 *
 * A gate that asserts "resolution failed" passes just as happily when it fails
 * for the wrong reason. Every refusal below therefore carries a member of a
 * CLOSED union, so a gate can say "this input is rejected as
 * `forbidden_filter_cross`, and not as `unknown_handle`" — which is the
 * difference between a proof and a coincidence.
 *
 * A failure is DATA, not an exception, everywhere it can be. Validation and
 * resolution return `{ ok: false, errors }` carrying EVERY problem found, not
 * the first: an editor that reports one broken binding per save is an editor
 * nobody finishes a page in. `PresentationError` (the thrown form) exists only
 * for programming errors — a malformed handle built in code, a registry whose
 * contract version disagrees with the document it was built from.
 *
 * NO FAILURE MESSAGE MAY CARRY A CANONICAL KEY. `detail` is written for a human
 * editing a layout, and the boundary gate scans emitted messages for canonical
 * item, attribute, metric and table names exactly as it scans the render model.
 * A leak through an error string is still a leak.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Every way a presentation document or a resolution may be refused. */
export type PresentationErrorCode =
  /* -------- document shape and versioning -------- */
  /** The document declares a schema version this build does not implement. */
  | "unsupported_schema_version"
  /** The document is not shaped like a presentation document at all. */
  | "malformed_document"
  /** Two pages or two blocks claim the same id. */
  | "duplicate_id"
  /** A block names a page, panel or block that the document does not contain. */
  | "unknown_reference"
  /** A grid span is outside the declared track count for its breakpoint. */
  | "invalid_layout"

  /* -------- bindings -------- */
  /** The handle is well formed and the registry has no entry for it. */
  | "unknown_handle"
  /** The handle exists, in a facet this block kind may not draw. */
  | "handle_facet_mismatch"
  /** The registry entry's semantic cannot be drawn by the requested variant. */
  | "incompatible_chart_variant"
  /** The registry was built from a different results contract than the caller passed. */
  | "registry_contract_mismatch"
  /**
   * The registry and the results describe DIFFERENT STUDIES.
   *
   * Its own code, because it is the failure with no symptom: every address is an
   * array position, so a registry from one study resolves cleanly against
   * another and answers with the wrong numbers.
   */
  | "registry_study_mismatch"
  /** Same study, different projected plan or package. The positions may have moved. */
  | "registry_plan_mismatch"
  /** The document was authored against a different presentation-registry version. */
  | "registry_version_mismatch"
  /**
   * The document was bound to a registry whose handle-to-address map is not this
   * one — a label was renamed, a group reordered, or an entry inserted earlier.
   */
  | "binding_fingerprint_mismatch"
  /** The requested display format cannot be honoured without changing the value. */
  | "incompatible_display_format"

  /* -------- filters -------- */
  /** A filter panel offers a dimension the bound result does not support. */
  | "unsupported_filter_dimension"
  /** An authority forbids crossing this dimension with this result. */
  | "forbidden_filter_cross"
  /** A block connects to something that is not a filter panel. */
  | "invalid_filter_connection"

  /* -------- journey -------- */
  /** A visible route claims a touchpoint its declared source group does not contain. */
  | "route_touchpoint_outside_group"
  /** Two visible routes claim the same touchpoint, or one route claims it twice. */
  | "route_touchpoint_duplicated"

  /* -------- persistence (server-only) -------- */
  /** A stored definition belongs to a different tenant/study than the caller asked for. */
  | "persistence_scope_mismatch"
  /** The scope is malformed, or the stored column and the JSON disagree about the version. */
  | "persistence_scope_invalid"

  /* -------- authored policy -------- */
  /** A suppressing sample policy was written without the authorship it requires. */
  | "sample_policy_unauthored"
  /** A disclosure level outside the closed set. */
  | "unknown_disclosure_level";

/**
 * One refusal.
 *
 * `path` locates the offending node in the document — `pages[1].blocks[4]` —
 * so an editor can put the cursor on it. `detail` is prose for a human and is
 * held to the same no-canonical-keys rule as everything else that leaves the
 * server.
 */
export type PresentationIssue = {
  code: PresentationErrorCode;
  path: string;
  detail: string;
};

/** The result of a validation or a resolution: everything, or every problem. */
export type PresentationOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; errors: PresentationIssue[] };

/** Build a single issue. */
export function issue(code: PresentationErrorCode, path: string, detail: string): PresentationIssue {
  return { code, path, detail };
}

/**
 * Order issues deterministically.
 *
 * By path, then by code, then by detail — codepoint order throughout. Two runs
 * over the same broken document must report the same list in the same order, or
 * a gate comparing serialized output would flap.
 */
export function compareIssues(a: PresentationIssue, b: PresentationIssue): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.detail !== b.detail) return a.detail < b.detail ? -1 : 1;
  return 0;
}

/** A failed outcome with its issues sorted. */
export function failure<T>(errors: PresentationIssue[]): PresentationOutcome<T> {
  return { ok: false, errors: errors.slice().sort(compareIssues) };
}

/** A successful outcome. */
export function success<T>(value: T): PresentationOutcome<T> {
  return { ok: true, value };
}

/**
 * A PROGRAMMING error in this layer, thrown rather than returned.
 *
 * Reserved for the cases a caller cannot cause with data: a handle built from
 * an invalid segment, a registry asked to bind a semantic it has no binding
 * for. Anything an author could write into a document is an issue, not a throw.
 */
export class PresentationError extends Error {
  readonly code: PresentationErrorCode;

  constructor(code: PresentationErrorCode, message: string) {
    super(message);
    this.name = "PresentationError";
    this.code = code;
  }
}
