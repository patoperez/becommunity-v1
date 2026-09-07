/**
 * OPAQUE PRESENTATION HANDLES — the only name a stored layout may use.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A HANDLE AND NOT A KEY.
 *
 * The canonical layer addresses things by keys that describe STORAGE: an item
 * key is `<instrument>_<column letter>`, an attribute key is
 * `perfil_cliente_h`, a metric key is the `metric_definition.key` a projection
 * declared. Those names are true, useful and INTERNAL. A stored presentation
 * that referenced them would publish the shape of the warehouse to anyone who
 * opened a saved dashboard, and would break the moment a projection revision
 * renamed a column.
 *
 * A handle is therefore built from exactly two kinds of material:
 *
 *   1. a word from the CLOSED VOCABULARY in `capabilities.ts` — `nps`,
 *      `renewal-index`, `touchpoint-tdp` — which is a semantic, not a location;
 *   2. text the client is ALREADY SHOWN (a cohort's label, a dimension's
 *      label, a group's label) reduced to a slug, or an ORDINAL POSITION.
 *
 * It is never built from an item key, an attribute key, an instrument key, a
 * metric key, a band-scheme key, a series key or a table name. `handles.ts`
 * cannot import those, and a gate re-derives every handle in the catalogue and
 * the blueprint and fails if one contains a canonical key as a substring.
 *
 * OPAQUE means "carries no address", not "is unreadable". `value:nps-desertores`
 * tells a human which block they are looking at and tells an attacker nothing
 * about where the number is stored — which is the property that matters.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * A validated handle.
 *
 * Branded so a bare string cannot be passed where a handle is required: every
 * handle in the system is produced by `presentationHandle` or by
 * `parsePresentationHandle`, and both validate the grammar.
 */
export type PresentationHandle = string & { readonly __presentationHandle: unique symbol };

/**
 * The facets a handle may live in.
 *
 * A facet is a coarse KIND, not a location. It exists so a validator can reject
 * "this block wants to draw a filter control from a value handle" without
 * consulting the registry at all.
 */
export type PresentationFacet =
  /** One final, already-calculated number. */
  | "value"
  /** A categorical breakdown whose parts are already counted and shared. */
  | "distribution"
  /** An ordered set of periods. */
  | "series"
  /** Population and base accounting. */
  | "population"
  /** A dimension a surface may offer as a filter control. */
  | "dimension"
  /** One SOURCE journey group. */
  | "journey-group"
  /** One measured journey touchpoint. */
  | "journey-touchpoint"
  /** A curated qualitative aggregate. */
  | "qualitative"
  /** A slot the contract says a human or a configuration fills. */
  | "editorial";

/** Every facet, in a fixed order, so a gate can walk the set. */
export const PRESENTATION_FACETS: readonly PresentationFacet[] = [
  "dimension",
  "distribution",
  "editorial",
  "journey-group",
  "journey-touchpoint",
  "population",
  "qualitative",
  "series",
  "value",
] as const;

const FACET_SET: ReadonlySet<string> = new Set(PRESENTATION_FACETS);

/**
 * The grammar, and it is deliberately narrow.
 *
 * `facet:segment(-segment)*` where a segment is lower-case ASCII alphanumerics.
 * No dot, no slash, no colon beyond the first, no upper case and no underscore
 * — the last one matters, because every canonical item, attribute and metric
 * key in this project is snake_case. A handle that cannot contain an underscore
 * cannot accidentally BE one of those keys.
 */
const HANDLE_PATTERN = /^[a-z][a-z-]*:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** True when `value` is a syntactically valid handle in a known facet. */
export function isPresentationHandle(value: unknown): value is PresentationHandle {
  if (typeof value !== "string") return false;
  if (!HANDLE_PATTERN.test(value)) return false;
  return FACET_SET.has(value.slice(0, value.indexOf(":")));
}

/** The facet of a valid handle. */
export function handleFacet(handle: PresentationHandle): PresentationFacet {
  return handle.slice(0, handle.indexOf(":")) as PresentationFacet;
}

/**
 * Reduce client-safe display text to a handle segment.
 *
 * Accents are folded rather than dropped so «Desertores» and «Miembros
 * activos» keep their words, and everything that is not an ASCII alphanumeric
 * becomes a single separator. The result can therefore collide — two labels
 * differing only in punctuation slug identically — which is why every caller
 * that builds handles from labels disambiguates with an ordinal.
 *
 * Text that reduces to nothing at all (a label of punctuation, or an empty
 * one) yields the empty string, and the caller must fall back to its ordinal.
 * Returning a silent placeholder here would let two unrelated entries share a
 * handle.
 */
export function slugifyLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build a handle from a facet and already-safe segments.
 *
 * Every segment must already be a slug or an ordinal; this function validates
 * rather than sanitises, because silently rewriting a bad segment is how a
 * canonical key would slip through in a mangled but still recognisable form.
 * An invalid segment is a programming error and throws.
 */
export function presentationHandle(facet: PresentationFacet, ...segments: string[]): PresentationHandle {
  const body = segments.filter((segment) => segment.length > 0).join("-");
  const candidate = `${facet}:${body}`;
  if (!isPresentationHandle(candidate)) {
    throw new Error(
      `handle inválido: ${JSON.stringify(candidate)}. Un handle se construye solo con vocabulario cerrado, ` +
        "texto de presentación ya visible o posiciones ordinales.",
    );
  }
  return candidate as PresentationHandle;
}

/** Validate an untrusted string as a handle, or return null. */
export function parsePresentationHandle(value: unknown): PresentationHandle | null {
  return isPresentationHandle(value) ? value : null;
}

/**
 * Order handles deterministically.
 *
 * Codepoint order, never locale order: `localeCompare` is configurable at
 * runtime and would make a serialized catalogue depend on the machine that
 * produced it.
 */
export function compareHandles(a: PresentationHandle, b: PresentationHandle): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
