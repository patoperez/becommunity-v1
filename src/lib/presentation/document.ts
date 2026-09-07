/**
 * THE VERSIONED PRESENTATION DOCUMENT — a layout, and nothing but a layout.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A DOCUMENT MAY CONTAIN.
 *
 * Pages, blocks, order, grid placement per breakpoint, authored copy, opaque
 * bindings, chart variants, filter panels, EXPLICIT filter connections, journey
 * routes, editorial slots, a sample-display policy, a methodology-disclosure
 * level, visibility, and the publication metadata the existing draft/revision
 * model already requires.
 *
 * WHAT IT MAY NOT CONTAIN, and cannot: a number drawn from a study, a formula,
 * a threshold that changes a value, a canonical key of any kind. A binding is a
 * handle; a handle is opaque; the value arrives at resolution time from the
 * canonical document and from nowhere else. `supabase/migrations/0023…sql:105`
 * already says this of the column these documents live in — "Presentation only
 * … referencing results by opaque registry handle. Never a respondent, an
 * answer, a quote or a canonical metric key." This file is that sentence,
 * executable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VERSIONING, AND WHY THE NUMBER IS 4.
 *
 * `study_experience_draft.schema_version` and
 * `study_experience_revision.schema_version` are INTEGER columns bounded 1..1000
 * (`0023…sql:82-85`), and both write functions refuse a document whose own
 * `schemaVersion` field disagrees with the argument (`0024…sql:86-88`,
 * `0025…sql:407-409`). So the version here is an integer, not a semver string —
 * anything else could not be stored at all.
 *
 * Versions 1, 2 and 3 ARE ALREADY TAKEN by the legacy experience definition
 * (`EXPERIENCE_SCHEMA_VERSION = 3` on `claude/experience-publication-versioning`
 * at 6311f0a), and TWO DRAFTS EXIST on the hosted project at a version nobody
 * recorded — it may be 1, 2 or 3, and the database's `between 1 and 1000` check
 * will not say which. Unit 6A therefore does three things and not one:
 *
 *   1. it claims 4, so a presentation document can never be mistaken for a
 *      legacy one by version alone;
 *   2. it carries `documentKind: "canonical_presentation"`, so a legacy blob
 *      stamped with a 4 by hand is still refused — a version is a number and
 *      numbers can be edited, a discriminator is a claim about what the thing IS;
 *   3. it RECOGNISES 1..3 explicitly and refuses them with a message that names
 *      the legacy family, rather than failing as though the document were
 *      corrupt. An unknown version fails safely and VISIBLY.
 *
 * NOTHING IS MIGRATED HERE. The legacy `migrate.ts` rule that a published
 * snapshot is never migrated is kept and widened: this layer migrates nothing at
 * all, in either direction. Reinterpreting somebody's stored draft as a document
 * of a different family is exactly the silent behaviour the brief forbids.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";

import {
  METHODOLOGY_DISCLOSURE_LEVELS,
  type MethodologyDisclosureLevel,
} from "./capabilities";
import { failure, issue, success, type PresentationIssue, type PresentationOutcome } from "./errors";
import { isPresentationHandle, type PresentationHandle } from "./handles";

/** The version this build writes and the ONLY one it reads. */
export const PRESENTATION_DOCUMENT_SCHEMA_VERSION = 4;

/** The discriminator that outranks the number. */
export const PRESENTATION_DOCUMENT_KIND = "canonical_presentation";

/**
 * Versions belonging to the LEGACY experience definition, recognised so they can
 * be refused by name instead of by confusion.
 */
export const LEGACY_EXPERIENCE_SCHEMA_VERSIONS: readonly number[] = [1, 2, 3];

/** The responsive grid. Twelve tracks, as the legacy builder used. */
export const GRID_COLUMNS = 12;

/** The three breakpoints a placement must state. */
export type Breakpoint = "desktop" | "tablet" | "mobile";

/** How a block behaves when its track count cannot be honoured. */
export type ResponsiveBehavior =
  /** Let the grid reflow it onto its own row. */
  | "reflow"
  /** Stack its internal parts vertically. */
  | "stack"
  /** Keep its width and scroll horizontally inside its own box. */
  | "scroll_x";

/* -------------------------------------------------------------------------- */
/* sample display policy                                                       */
/* -------------------------------------------------------------------------- */

/**
 * WHAT TO DO ABOUT A SMALL BASE — and the default is to show it.
 *
 * The canonical layer applies NO suppression (`docs/CANONICAL_RESULTS_MODEL.md`
 * §5): a small base is reported, never used to withhold a result, down to a
 * single respondent. That is a property of the results, and this layer does not
 * get to change it.
 *
 * What this layer owns is the DISPLAY decision, and it is a decision somebody
 * makes on purpose. `show_all` is the default and the only mode that needs no
 * argument. The two suppressing modes require an author and a stated reason,
 * which is not ceremony: it is what makes "a person decided to hide this" a
 * different fact from "the software hid it", and it is why a hide-below rule
 * cannot be inherited, defaulted or stamped onto a document by an adapter. The
 * legacy `adaptLegacyStudy` stamped `hide_below 5` on every definition it
 * produced; that behaviour is deliberately not carried across.
 */
export type SampleDisplayPolicy =
  | { mode: "show_all" }
  | {
      mode: "annotate_below";
      threshold: number;
      /** The caption to show beside a result under the threshold. */
      note: string;
      authoredBy: string;
      rationale: string;
    }
  | {
      mode: "hide_below";
      threshold: number;
      authoredBy: string;
      rationale: string;
    };

/** The system default, and it shows everything. */
export const DEFAULT_SAMPLE_POLICY: SampleDisplayPolicy = { mode: "show_all" };

/* -------------------------------------------------------------------------- */
/* blocks                                                                      */
/* -------------------------------------------------------------------------- */

/** Where a block sits, at each breakpoint. */
export type BlockPlacement = {
  /** Position within its page. Ties are broken by block id, so order is total. */
  order: number;
  /** Track counts, 1..12 per breakpoint. */
  span: Record<Breakpoint, number>;
  responsive: ResponsiveBehavior;
};

/** Copy a human wrote. Never a number, never a computed string. */
export type AuthoredCopy = {
  title: string | null;
  description: string | null;
  annotation: string | null;
};

type BlockCommon = {
  id: string;
  copy: AuthoredCopy;
  placement: BlockPlacement;
  visible: boolean;
  /**
   * The filter panels that MOVE this block.
   *
   * Explicit, by panel id, and that is the whole point. Sharing a dimension
   * with a panel is not a connection; a block responds when, and only when, a
   * connection names it. The approved dashboard depends on this distinction:
   * its risk panel and its "Razones declaradas de riesgo" list share every
   * dimension, and the list is deliberately NOT moved by the panel.
   */
  connectedFilterPanelIds: string[];
  /** Null means "inherit the document's policy". */
  samplePolicy: SampleDisplayPolicy | null;
  /** Null means "inherit the document's level". */
  methodologyDisclosure: MethodologyDisclosureLevel | null;
};

/** One canonical result, drawn one way. */
export type ResultBlock = BlockCommon & {
  kind: "result";
  binding: PresentationHandle;
  chartVariant: string;
};

/** One visible journey route: a presentation decision over source evidence. */
export type JourneyRoute = {
  id: string;
  title: string;
  order: number;
  /** The SOURCE group this route draws from. Evidence, not decision. */
  sourceGroup: PresentationHandle;
  /** The touchpoints this route shows, in the order it shows them. */
  touchpoints: PresentationHandle[];
};

/**
 * The block that turns FOUR source groups into the visible routes a client sees.
 *
 * The approved dashboard shows five routes over four groups by splitting the
 * first category into "Operación" and "Interacción". That split is a
 * presentation act and lives here, in configuration — never in the canonical
 * contract, which carries the four categories the workbook's merged bands state.
 */
export type JourneyRoutesBlock = BlockCommon & {
  kind: "journey_routes";
  routes: JourneyRoute[];
  chartVariant: string;
};

/** A panel of filter controls. It moves only what names it. */
export type FilterPanelBlock = BlockCommon & {
  kind: "filter_panel";
  dimensions: PresentationHandle[];
};

/**
 * Authored prose, or a slot the contract says somebody must fill.
 *
 * When `slot` names an editorial registry entry and `content` is null, the block
 * resolves as CONFIGURATION REQUIRED — visibly waiting for a human, never
 * invented and never quietly dropped.
 */
export type EditorialBlock = BlockCommon & {
  kind: "editorial";
  slot: PresentationHandle | null;
  content: { body: string } | null;
};

export type PresentationBlock = ResultBlock | JourneyRoutesBlock | FilterPanelBlock | EditorialBlock;

export type PresentationPage = {
  id: string;
  title: string;
  order: number;
  blocks: PresentationBlock[];
};

/**
 * Publication metadata, shaped by the tables that already exist.
 *
 * Every bound here mirrors a CHECK in migration 0025 so a document that
 * validates locally is a document the database will accept: the hash is 64
 * lower-case hex characters, the fingerprint is 1..200 characters, the note is
 * at most 200, and there are at most 64 acknowledged warning codes drawn from
 * `[a-z0-9_]`.
 */
export type PublicationMetadata = {
  status: "draft" | "prepared" | "published";
  sourceDraftRevision: number | null;
  definitionSha256: string | null;
  studyFingerprint: string | null;
  acknowledgedWarnings: string[];
  preparedNote: string | null;
};

/** A whole presentation. */
export type PresentationDocument = {
  schemaVersion: number;
  documentKind: typeof PRESENTATION_DOCUMENT_KIND;
  id: string;
  title: string;
  locale: "es-MX";
  /** The study-wide default. Blocks may override it; nothing may default it away. */
  samplePolicy: SampleDisplayPolicy;
  methodologyDisclosure: MethodologyDisclosureLevel;
  pages: PresentationPage[];
  publication: PublicationMetadata;
};

/* -------------------------------------------------------------------------- */
/* the schema                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Authored text, held to the boundary the platform already applies elsewhere.
 *
 * Control characters are refused outright — they are never typed on purpose and
 * they are how a caption smuggles a terminal escape or a bidirectional override
 * into a report. Everything else is left alone and escaped at render: React's
 * text nodes are the platform's answer to markup in copy, and this layer must
 * not become a second, weaker one.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200e\u200f\u202a-\u202e]/;

const authoredText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !CONTROL_CHARACTERS.test(value), {
      message: "el texto lleva caracteres de control",
    });

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "identificador inválido");

const handleSchema = z.string().refine(isPresentationHandle, { message: "handle inválido" });

const samplePolicySchema: z.ZodType<SampleDisplayPolicy> = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("show_all") }),
  z.strictObject({
    mode: z.literal("annotate_below"),
    threshold: z.number().int().min(1).max(10000),
    note: authoredText(200),
    authoredBy: authoredText(120).refine((v) => v.trim().length > 0, { message: "requiere autoría" }),
    rationale: authoredText(400).refine((v) => v.trim().length > 0, { message: "requiere una razón" }),
  }),
  z.strictObject({
    mode: z.literal("hide_below"),
    threshold: z.number().int().min(1).max(10000),
    authoredBy: authoredText(120).refine((v) => v.trim().length > 0, { message: "requiere autoría" }),
    rationale: authoredText(400).refine((v) => v.trim().length > 0, { message: "requiere una razón" }),
  }),
]);

const disclosureSchema = z.enum(
  METHODOLOGY_DISCLOSURE_LEVELS as unknown as [MethodologyDisclosureLevel, ...MethodologyDisclosureLevel[]],
);

const placementSchema = z.strictObject({
  order: z.number().int().min(0).max(4096),
  span: z.strictObject({
    desktop: z.number().int().min(1).max(GRID_COLUMNS),
    tablet: z.number().int().min(1).max(GRID_COLUMNS),
    mobile: z.number().int().min(1).max(GRID_COLUMNS),
  }),
  responsive: z.enum(["reflow", "stack", "scroll_x"]),
});

const copySchema = z.strictObject({
  title: authoredText(160).nullable(),
  description: authoredText(600).nullable(),
  annotation: authoredText(600).nullable(),
});

const commonFields = {
  id: identifier,
  copy: copySchema,
  placement: placementSchema,
  visible: z.boolean(),
  connectedFilterPanelIds: z.array(identifier).max(16),
  samplePolicy: samplePolicySchema.nullable(),
  methodologyDisclosure: disclosureSchema.nullable(),
};

const blockSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...commonFields,
    kind: z.literal("result"),
    binding: handleSchema,
    chartVariant: z.string().min(1).max(48),
  }),
  z.strictObject({
    ...commonFields,
    kind: z.literal("journey_routes"),
    chartVariant: z.string().min(1).max(48),
    routes: z
      .array(
        z.strictObject({
          id: identifier,
          title: authoredText(160),
          order: z.number().int().min(0).max(4096),
          sourceGroup: handleSchema,
          touchpoints: z.array(handleSchema).max(512),
        }),
      )
      .max(64),
  }),
  z.strictObject({
    ...commonFields,
    kind: z.literal("filter_panel"),
    dimensions: z.array(handleSchema).max(32),
  }),
  z.strictObject({
    ...commonFields,
    kind: z.literal("editorial"),
    slot: handleSchema.nullable(),
    content: z.strictObject({ body: authoredText(4000) }).nullable(),
  }),
]);

const pageSchema = z.strictObject({
  id: identifier,
  title: authoredText(160),
  order: z.number().int().min(0).max(4096),
  blocks: z.array(blockSchema).max(256),
});

const publicationSchema = z.strictObject({
  status: z.enum(["draft", "prepared", "published"]),
  sourceDraftRevision: z.number().int().min(1).nullable(),
  definitionSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  studyFingerprint: z.string().min(1).max(200).nullable(),
  acknowledgedWarnings: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)).max(64),
  preparedNote: authoredText(200).nullable(),
});

const documentSchema = z.strictObject({
  schemaVersion: z.number().int(),
  documentKind: z.literal(PRESENTATION_DOCUMENT_KIND),
  id: identifier,
  title: authoredText(160),
  locale: z.literal("es-MX"),
  samplePolicy: samplePolicySchema,
  methodologyDisclosure: disclosureSchema,
  pages: z.array(pageSchema).max(64),
  publication: publicationSchema,
});

/* -------------------------------------------------------------------------- */
/* validation                                                                  */
/* -------------------------------------------------------------------------- */

function declaredVersion(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = (value as { schemaVersion?: unknown }).schemaVersion;
  return typeof candidate === "number" && Number.isInteger(candidate) ? candidate : null;
}

function declaredKind(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = (value as { documentKind?: unknown }).documentKind;
  return typeof candidate === "string" ? candidate : null;
}

/**
 * Validate an untrusted value as a presentation document.
 *
 * The VERSION is decided before the shape, on purpose. A legacy definition
 * would fail the shape check too, but it would fail as a heap of unknown-field
 * errors — and "your document is malformed" is the wrong thing to tell somebody
 * whose document is simply of another family. The version gate answers that
 * first, names the family, and stops.
 */
export function validatePresentationDocument(value: unknown): PresentationOutcome<PresentationDocument> {
  const version = declaredVersion(value);
  const kind = declaredKind(value);

  if (version === null) {
    return failure([
      issue(
        "malformed_document",
        "$",
        "el documento no declara un `schemaVersion` entero, así que no puede identificarse.",
      ),
    ]);
  }

  if (kind !== PRESENTATION_DOCUMENT_KIND) {
    // A legacy document, or something wearing a presentation version number.
    const legacy = LEGACY_EXPERIENCE_SCHEMA_VERSIONS.includes(version);
    return failure([
      issue(
        "unsupported_schema_version",
        "$.documentKind",
        legacy
          ? `el documento declara la versión ${version}, que pertenece a la definición de experiencia heredada ` +
              `(versiones ${LEGACY_EXPERIENCE_SCHEMA_VERSIONS.join(", ")}). No se reinterpreta ni se migra: ` +
              "esta capa lee únicamente documentos de presentación canónica."
          : `el documento no se declara como «${PRESENTATION_DOCUMENT_KIND}», así que no se lee como tal.`,
      ),
    ]);
  }

  if (version !== PRESENTATION_DOCUMENT_SCHEMA_VERSION) {
    return failure([
      issue(
        "unsupported_schema_version",
        "$.schemaVersion",
        `versión ${version} desconocida para esta compilación, que implementa únicamente la ` +
          `${PRESENTATION_DOCUMENT_SCHEMA_VERSION}. Una versión desconocida se rechaza, nunca se adivina.`,
      ),
    ]);
  }

  const parsed = documentSchema.safeParse(value);
  if (!parsed.success) {
    const errors: PresentationIssue[] = parsed.error.issues.map((entry) =>
      issue("malformed_document", `$.${entry.path.join(".")}`, entry.message),
    );
    return failure(errors.length > 0 ? errors : [issue("malformed_document", "$", "documento inválido")]);
  }

  const document = parsed.data as PresentationDocument;
  const structural = structuralIssues(document);
  return structural.length > 0 ? failure(structural) : success(document);
}

/**
 * The checks a shape schema cannot express: uniqueness and reference integrity
 * WITHIN the document. Bindings against a registry are resolution's job.
 */
function structuralIssues(document: PresentationDocument): PresentationIssue[] {
  const errors: PresentationIssue[] = [];
  const pageIds = new Set<string>();
  const blockIds = new Set<string>();
  const panelIds = new Set<string>();

  document.pages.forEach((page, pageIndex) => {
    if (pageIds.has(page.id)) {
      errors.push(issue("duplicate_id", `$.pages[${pageIndex}]`, `dos páginas comparten el id «${page.id}»`));
    }
    pageIds.add(page.id);
    page.blocks.forEach((block, blockIndex) => {
      const path = `$.pages[${pageIndex}].blocks[${blockIndex}]`;
      if (blockIds.has(block.id)) {
        errors.push(issue("duplicate_id", path, `dos bloques comparten el id «${block.id}»`));
      }
      blockIds.add(block.id);
      if (block.kind === "filter_panel") panelIds.add(block.id);
    });
  });

  document.pages.forEach((page, pageIndex) => {
    page.blocks.forEach((block, blockIndex) => {
      const path = `$.pages[${pageIndex}].blocks[${blockIndex}]`;
      const seen = new Set<string>();
      for (const panelId of block.connectedFilterPanelIds) {
        if (seen.has(panelId)) {
          errors.push(
            issue("duplicate_id", path, `el bloque nombra dos veces el panel «${panelId}»`),
          );
        }
        seen.add(panelId);
        if (!blockIds.has(panelId)) {
          errors.push(
            issue("unknown_reference", path, `el bloque se conecta a «${panelId}», que no existe`),
          );
        } else if (!panelIds.has(panelId)) {
          errors.push(
            issue(
              "invalid_filter_connection",
              path,
              `«${panelId}» existe pero no es un panel de filtros, así que no puede mover a nadie`,
            ),
          );
        }
      }
      if (block.kind === "filter_panel" && block.connectedFilterPanelIds.length > 0) {
        errors.push(
          issue("invalid_filter_connection", path, "un panel de filtros no se conecta a otro panel"),
        );
      }
    });
  });

  return errors;
}

/* -------------------------------------------------------------------------- */
/* duplication                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Copy a block under a new id.
 *
 * Connections are NOT carried across. A duplicate that inherited them would
 * silently double what a filter moves, and the whole design rests on a
 * connection being something somebody wrote down on purpose.
 */
export function duplicateBlock(block: PresentationBlock, newId: string): PresentationBlock {
  return { ...block, id: newId, connectedFilterPanelIds: [] };
}

/**
 * Copy a page under new ids.
 *
 * `mintBlockId` receives the original block id and its position, so a caller
 * owns the naming scheme. Connections inside the page are REMAPPED when both
 * ends were copied, and dropped otherwise — a copied block never keeps a
 * connection to the original page's panel.
 */
export function duplicatePage(
  page: PresentationPage,
  newPageId: string,
  mintBlockId: (originalId: string, index: number) => string,
): PresentationPage {
  const remap = new Map<string, string>();
  page.blocks.forEach((block, index) => remap.set(block.id, mintBlockId(block.id, index)));
  return {
    ...page,
    id: newPageId,
    blocks: page.blocks.map((block, index) => ({
      ...block,
      id: remap.get(block.id) ?? mintBlockId(block.id, index),
      connectedFilterPanelIds: block.connectedFilterPanelIds
        .map((panelId) => remap.get(panelId))
        .filter((panelId): panelId is string => panelId !== undefined),
    })),
  };
}
