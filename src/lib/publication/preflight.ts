/**
 * THE PREFLIGHT — pure, closed, and it decides nothing about a number.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS.
 *
 * One function over a SUBJECT the server assembled: what the store holds, what
 * the document is, whether it still resolves against this study's current
 * canonical results, what identity those results have, and what a person has
 * already acknowledged. It answers with blockers, warnings, the acknowledgements
 * required, and one verdict.
 *
 * It is pure — no clock, no randomness, no transport, no database — which is
 * what lets an offline gate drive the REAL preflight rather than a copy of it.
 * A copy is exactly how a publication gate ends up green while the product
 * publishes something else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER IS PART OF THE ANSWER.
 *
 * Stages short-circuit downward, and each stage's blocker EXPLAINS the absence
 * of everything below it. A study with no canonical package should be told
 * exactly that once, not told it eleven times in eleven vocabularies — a review
 * screen listing eleven consequences of one cause is a screen a person stops
 * reading.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THERE IS NO THRESHOLD IN THIS FILE.
 *
 * No number, no comparison against a base, no rule about a small sample. The
 * two sample warnings are read off `RenderBlock.sampleDisplay`, which the
 * resolver already decided from an AUTHORED policy carrying a name and a stated
 * reason. Under the system default — `show_all` — neither can fire, whatever the
 * bases are. A gate asserts that with bases of one.
 */

import { clientSeesBlock, filterPanelIsOperable } from "../presentation";
import type { PresentationRenderModel } from "../presentation";
import {
  WARNINGS_REQUIRING_ACKNOWLEDGEMENT,
  warningRequiresAcknowledgement,
  type PublicationBlocker,
  type PublicationBlockerCode,
  type PublicationIdentity,
  type PublicationPreflight,
  type PublicationWarning,
  type PublicationWarningCode,
} from "./contract";
import { blockTitle, pageTitle } from "./inventory";

/** A typed issue as the presentation layer emits them: a code and a path. */
export type PublicationIssue = { code: string; path: string };

/** What the store holds for this study, as columns rather than as a document. */
export type StoredDraftFacts = {
  revision: number;
  definitionSha256: string;
  registryVersion: string;
  bindingFingerprint: string;
};

/** One qualitative group a block in this document binds. */
export type QualitativeBinding = {
  /** The group's own label, as a client would read it. Never a handle. */
  label: string;
  reviewStatus: "pending" | "confirmed" | "mixed";
};

/**
 * Everything the preflight reasons over. Assembled by the server-only workspace.
 *
 * Every field below the first that failed is `null`, and that is the contract:
 * a subject carrying a `readRefusal` has no document, and one carrying a decode
 * failure has no model.
 */
export type PublicationSubject = {
  /** Whether the actor may publish at all. Re-checked by the database too. */
  authorized: boolean;
  /**
   * Whether the surface a client reads hands the renderer live filter controls.
   *
   * It is a fact about the DELIVERABLE, not about this screen, and it is
   * required rather than defaulted. Every "would a client see this" question
   * below is asked with it, the review preview is mounted with it, and a gate
   * renders the real component and compares the two counts — because the last
   * time this was two separate answers, the review said 23 over a preview of 20.
   */
  clientSurfaceIsLive: boolean;
  /** Why the canonical read produced nothing, or null when it produced results. */
  readRefusal:
    | "no_canonical_package"
    | "multiple_canonical_packages"
    | "specification_not_registered"
    | "canonical_read_refused"
    | null;
  /** The stored canonical draft's own columns, or null when none is stored. */
  stored: StoredDraftFacts | null;
  /** The draft revision the reviewer is acting on, as the screen showed it. */
  reviewedRevision: number | null;
  /** Why the stored row would not decode, or null when it decoded. */
  decodeIssues: readonly PublicationIssue[] | null;
  /** True when the decoded document carries a binding. */
  bound: boolean | null;
  /** Why the document does not resolve, or null when it resolved. */
  resolutionIssues: readonly PublicationIssue[] | null;
  /** The render model, when the document resolved. */
  model: PresentationRenderModel | null;
  /** Whether resolving twice produced identical bytes. Null when it never resolved. */
  reproducible: boolean | null;
  /** The identity of the registry built from the study's CURRENT results. */
  current: PublicationIdentity | null;
  /** The identity the stored draft was authored against. */
  authored: Pick<PublicationIdentity, "registryVersion" | "bindingFingerprint"> | null;
  /**
   * The identity the study's LAST publication was pinned to, when there is one.
   *
   * Compared field by field against `current` so a drift is ATTRIBUTED — «el
   * paquete canónico cambió» rather than «la huella cambió» — which is the whole
   * reason the columns exist beside the fingerprint.
   */
  lastPublished: PublicationIdentity | null;
  /**
   * Block ids the AUTHOR marked as required content.
   *
   * Ids rather than titles, because the model is matched by id and the
   * SENTENCE is built from the title — so nothing internal reaches a screen.
   * It comes from the document, which the preflight does not otherwise read:
   * the resolved model deliberately carries no authoring material, and a
   * requirement is authoring material.
   */
  requiredBlockIds: readonly string[];
  /** The qualitative groups this document's blocks bind. */
  qualitative: readonly QualitativeBinding[];
  /** The publication version the reviewer saw, and the one the store holds. */
  expectedActiveVersion: number | null;
  actualActiveVersion: number | null;
  /** The structural difference against the current publication, when there is one. */
  structureChanged: boolean;
  /** Warning codes the reviewer has ticked. */
  acknowledged: readonly string[];
};

/* -------------------------------------------------------------------------- */

const blocker = (
  code: PublicationBlockerCode,
  detail: string,
  where: readonly string[] = [],
): PublicationBlocker => ({ code, detail, where });

const warning = (
  code: PublicationWarningCode,
  detail: string,
  where: readonly string[] = [],
): PublicationWarning => ({
  code,
  detail,
  where,
  requiresAcknowledgement: warningRequiresAcknowledgement(code),
});

const READ_REFUSAL_DETAIL: Record<NonNullable<PublicationSubject["readRefusal"]>, string> = {
  no_canonical_package:
    "Este estudio todavía no tiene un paquete canónico confirmado, así que no hay resultados que publicar.",
  multiple_canonical_packages:
    "Este estudio tiene más de un paquete canónico confirmado y no está dicho cuál es el suyo. Elegir uno aquí sería una decisión del producto disfrazada de detalle técnico.",
  specification_not_registered:
    "La especificación de resultados de este estudio no está registrada en esta versión, así que no se puede saber qué significan sus números.",
  canonical_read_refused:
    "No se pudieron leer los resultados canónicos de este estudio, así que no hay nada contra lo que comprobar la presentación.",
};

/**
 * WHICH PART OF THE STUDY IDENTITY MOVED, in the order a reviewer wants it.
 *
 * This is an ATTRIBUTION table, not a blocker table, and the distinction is the
 * one the contract records: every field below is INSIDE the binding digest, so
 * none of them can be detected on its own from a stored draft, which carries the
 * digest and not its parts. What they CAN be compared against is the last
 * publication's own pinned columns — that row stores all of them, precisely so a
 * drift can be named rather than merely noticed.
 *
 * The package comes first because, if the study's evidence was re-imported,
 * everything below it moving is a consequence, and saying so first is what makes
 * the list readable. The order is fixed so two runs produce the same sentence.
 */
const IDENTITY_ATTRIBUTIONS: readonly {
  field: keyof PublicationIdentity;
  sentence: string;
}[] = [
  { field: "packageIdempotencyKey", sentence: "se importó evidencia distinta para este estudio" },
  { field: "planFingerprint", sentence: "los datos canónicos se proyectaron de otra forma" },
  { field: "calculationVersion", sentence: "los cálculos cambiaron de versión" },
  { field: "resultsContractVersion", sentence: "el contrato de resultados cambió de versión" },
  { field: "registryVersion", sentence: "el vocabulario de presentación cambió de versión" },
];

/** Every part of the identity that moved between two pinned identities. */
function attributeDrift(
  from: PublicationIdentity | null,
  to: PublicationIdentity | null,
): string[] {
  if (from === null || to === null) return [];
  return IDENTITY_ATTRIBUTIONS.filter((rule) => from[rule.field] !== to[rule.field]).map(
    (rule) => rule.sentence,
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Run the preflight over one assembled subject.
 *
 * Every blocker and every warning below is emitted from a fact in the subject.
 * Nothing is inferred from the absence of a fact, and nothing is suppressed to
 * make a verdict come out.
 */
export function runPublicationPreflight(subject: PublicationSubject): PublicationPreflight {
  const blockers: PublicationBlocker[] = [];
  const warnings: PublicationWarning[] = [];

  // [0] AUTHORIZATION. First, because everything below it is a description of a
  //     study, and describing one to somebody who may not see it is the leak.
  if (!subject.authorized) {
    blockers.push(
      blocker(
        "not_authorized",
        "Esta sesión no puede publicar este estudio. El servidor lo rechazaría igual.",
      ),
    );
    return verdict(blockers, warnings, subject.acknowledged);
  }

  // [1] ARE THERE CANONICAL RESULTS AT ALL?
  if (subject.readRefusal !== null) {
    blockers.push(blocker(subject.readRefusal, READ_REFUSAL_DETAIL[subject.readRefusal]));
    return verdict(blockers, warnings, subject.acknowledged);
  }

  // [2] IS THERE A DRAFT, AND DOES IT READ BACK?
  if (subject.stored === null) {
    blockers.push(
      blocker(
        "no_stored_draft",
        "Este estudio todavía no tiene una presentación guardada. Compón una en Construcción y guárdala antes de publicar.",
      ),
    );
    return verdict(blockers, warnings, subject.acknowledged);
  }
  if (subject.decodeIssues !== null) {
    // FOUR DIFFERENT THINGS, AND A REVIEWER CAN ACT ON THREE OF THEM.
    //
    // Collapsing them into «no se puede leer» would tell somebody whose document
    // belongs to another client exactly what it tells somebody whose bytes were
    // corrupted, and those need different people to do different things. The
    // order is by severity: a foreign scope is the one failure whose consequence
    // is another client's numbers, so it is tested first.
    blockers.push(classifyDecodeFailure(subject.decodeIssues));
    return verdict(blockers, warnings, subject.acknowledged);
  }

  // [3] STALENESS, BEFORE ANYTHING ABOUT THE DOCUMENT ITSELF.
  //
  // A reviewer approves ONE revision. If the store has moved since the screen
  // was drawn, everything below describes a document nobody is publishing.
  if (subject.reviewedRevision !== null && subject.reviewedRevision !== subject.stored.revision) {
    blockers.push(
      blocker(
        "draft_revision_moved",
        `Se revisó la revisión ${subject.reviewedRevision} y la guardada ahora es la ${subject.stored.revision}: alguien la editó mientras tanto. Vuelve a cargar y revisa lo que hay ahora.`,
      ),
    );
  }

  // [4] IS IT A CANONICAL PRESENTATION, AND IS IT BOUND?
  if (subject.bound === false) {
    blockers.push(
      blocker(
        "document_unbound",
        "La presentación guardada no está enlazada a los resultados de ningún estudio, así que no describe a éste. No se publica.",
      ),
    );
  }

  // [5] DRIFT. The draft carries a registry version and a binding digest, so
  //     those are the two things that can be compared, and each gets its own
  //     code. What moved INSIDE the digest is named only where it can be named —
  //     by comparing the last publication's own pinned columns against the
  //     study's current identity — and appended as an attribution, never
  //     invented.
  if (subject.current !== null && subject.authored !== null) {
    if (subject.authored.registryVersion !== subject.current.registryVersion) {
      blockers.push(
        blocker(
          "registry_version_drift",
          "Esta presentación se compuso contra otra versión del vocabulario de presentación. No se reinterpreta: hay que abrirla en Construcción y revisarla.",
        ),
      );
    } else if (subject.authored.bindingFingerprint !== subject.current.bindingFingerprint) {
      // ONE OF THE TWO, NEVER BOTH. The binding digests the registry version
      // among many other things, so a registry change moves it too — and
      // reporting both would tell a reviewer that two things went wrong when
      // one did.
      const moved = attributeDrift(subject.lastPublished, subject.current);
      blockers.push(
        blocker(
          "binding_drift",
          "Los resultados de este estudio ya no son los que esta presentación nombra. No se vuelve a enlazar en silencio: hay que abrirla en Construcción y revisarla." +
            (moved.length > 0 ? ` Desde la última publicación, ${moved.join(" y ")}.` : ""),
        ),
      );
    }
  }

  // [6] DOES IT RESOLVE?
  if (subject.resolutionIssues !== null) {
    blockers.push(
      blocker(
        "document_unresolved",
        "La presentación guardada no resuelve contra los resultados actuales de este estudio. No se dibuja una aproximación ni se publica una.",
      ),
    );
    return verdict(blockers, warnings, subject.acknowledged);
  }
  if (subject.model === null) {
    // Defensive and unreachable: a subject with no resolution issues carries a
    // model. It refuses rather than continuing, because continuing would mean
    // deciding the content warnings from nothing.
    blockers.push(
      blocker(
        "document_unresolved",
        "No se obtuvo la vista resuelta de esta presentación, así que no hay nada que revisar ni que publicar.",
      ),
    );
    return verdict(blockers, warnings, subject.acknowledged);
  }

  // [7] REPRODUCIBILITY.
  if (subject.reproducible === false) {
    blockers.push(
      blocker(
        "render_model_not_reproducible",
        "Resolver dos veces la misma presentación sobre la misma lectura dio resultados distintos. Una publicación promete que lo aprobado es lo que se sirve, y ahora mismo no se puede prometer.",
      ),
    );
  }

  // [8] THE CONTENT, block by block. Every count below comes from the resolved
  //     model, so it describes what a client would actually see.
  const inspected = inspectBlocks(
    subject.model,
    subject.clientSurfaceIsLive,
    new Set(subject.requiredBlockIds),
  );

  // [8a] CONTENT THE AUTHOR SAID IS REQUIRED, AND IS NOT THERE.
  //
  // A BLOCKER, and the only one in this file that a person could have
  // prevented by editing the layout. It is deliberately not acknowledgeable:
  // the approved north-star for this study shows the journey pain cloud, and
  // ticking «entiendo que no aparecerá» is not the same decision as the one
  // that approved it. The two remedies are in the sentence, because a blocker
  // nobody can act on is a wall.
  if (inspected.requiredMissing.length > 0) {
    blockers.push(
      blocker(
        "required_content_missing",
        "Estos bloques llevan contenido que el plano aprobado exige, y ahora mismo están " +
          "vacíos: al cliente no le aparecería nada en su lugar. Escribe el contenido que " +
          "falta, o quita el bloque del documento en Construcción si ya no forma parte de la " +
          "entrega. No se puede publicar confirmando que desaparecerá.",
        inspected.requiredMissing,
      ),
    );
  }

  if (inspected.unresolved.length > 0) {
    blockers.push(
      blocker(
        "block_unresolved",
        "Hay resultados que el contrato deja como pregunta abierta: las autoridades no coinciden o ninguna enuncia la relación. Publicarlos los presentaría como cerrados.",
        inspected.unresolved,
      ),
    );
  }

  // THE REQUIRED ONES ARE NOT REPEATED HERE. They are already a blocker, and
  // a screen that listed the same block twice — once as «no se puede publicar»
  // and once as «confírmalo y publica» — would be offering a way past the
  // blocker that does not exist.
  if (inspected.configurationRequired.length > 0) {
    warnings.push(
      warning(
        "configuration_required_blocks",
        "Hay bloques que esperan contenido que alguien tiene que escribir. Al cliente no le aparecerá nada en su lugar: ni un hueco, ni un título, ni una explicación. Si publicas así, esa parte simplemente no existirá para quien lo lea.",
        inspected.configurationRequired,
      ),
    );
  }

  if (inspected.unavailable.length > 0) {
    warnings.push(
      warning(
        "unavailable_blocks",
        "Hay bloques cuya medición este estudio no tiene. No se muestran al cliente como un hueco: sencillamente no aparecen.",
        inspected.unavailable,
      ),
    );
  }

  if (inspected.hidden.length > 0) {
    warnings.push(
      warning(
        "hidden_blocks",
        "Hay bloques marcados como no visibles. Están en el documento y no se dibujan.",
        inspected.hidden,
      ),
    );
  }

  if (inspected.withheld.length > 0) {
    warnings.push(
      warning(
        "withheld_by_sample_policy",
        "Alguien escribió una política de muestra que reserva estos resultados, con su nombre y su razón. El cliente no los verá. Esta decisión no la tomó el sistema y no se puede tomar sola.",
        inspected.withheld,
      ),
    );
  }

  if (inspected.annotated.length > 0) {
    warnings.push(
      warning(
        "annotated_by_sample_policy",
        "Alguien escribió una política de muestra que añade una nota junto a estos resultados. Se publican con esa nota.",
        inspected.annotated,
      ),
    );
  }

  if (inspected.inoperablePanels.length > 0) {
    warnings.push(
      warning(
        "inoperable_filter_panels",
        "Hay paneles de filtros que ningún bloque usa, así que no cambiarían ninguna cifra. El " +
          "cliente no los recibe: en su página no aparece el panel, ni un hueco donde estaría. Si " +
          "querías que filtraran algo, conéctalos en Construcción antes de publicar.",
        inspected.inoperablePanels,
      ),
    );
  }

  if (inspected.granularDimensions.length > 0) {
    warnings.push(
      warning(
        "granular_filter_dimensions",
        "Estas características de filtro incluyen opciones que una sola persona tiene. Quien lea el " +
          "tablero puede elegir una de ellas y quedarse mirando las cifras de esa única persona. No " +
          "se oculta nada por tu cuenta y ninguna cifra cambia: la decisión de dejar la " +
          "característica en el panel o quitarla en Construcción es tuya.",
        inspected.granularDimensions,
      ),
    );
  }

  const pending = subject.qualitative.filter((group) => group.reviewStatus !== "confirmed");
  if (pending.length > 0) {
    warnings.push(
      warning(
        "qualitative_review_pending",
        "Estas categorías cualitativas son la codificación de la propia fuente: nadie del equipo las ha revisado todavía. Publicar es la decisión de mostrárselas al cliente tal como vinieron.",
        pending.map((group) => group.label),
      ),
    );
  }

  if (inspected.visible === 0) {
    warnings.push(
      warning(
        "nothing_visible",
        "Con lo que hay ahora, el cliente no vería nada en esta presentación. Es un documento válido y una entrega extraña, así que la decisión es tuya.",
      ),
    );
  }

  // [9] THE STATE OF THE WORLD.
  if (subject.expectedActiveVersion !== subject.actualActiveVersion) {
    blockers.push(
      blocker(
        "publication_pointer_moved",
        subject.actualActiveVersion === null
          ? "La publicación que estaba en curso ya no está. Vuelve a cargar esta pantalla antes de decidir."
          : `Alguien publicó la versión ${subject.actualActiveVersion} mientras revisabas. Vuelve a cargar y mira lo que hay ahora.`,
      ),
    );
  }

  if (subject.actualActiveVersion === null) {
    warnings.push(
      warning(
        "first_publication",
        "Sería la primera publicación de este estudio: el cliente pasaría de no ver nada a ver esto.",
      ),
    );
  } else {
    if (subject.structureChanged) {
      warnings.push(
        warning(
          "structure_changed",
          "La estructura de esta presentación no es la de lo publicado ahora. Abajo está la diferencia, página por página.",
        ),
      );
    }
    // THE STORED RENDER MODEL WOULD OTHERWISE HIDE THIS. What a client is served
    // right now is the model that was approved, unchanged — which is the property
    // this unit exists to guarantee, and which also means the published page says
    // nothing about the study's evidence having moved since. So this screen does.
    const moved = attributeDrift(subject.lastPublished, subject.current);
    if (moved.length > 0) {
      warnings.push(
        warning(
          "evidence_changed_since_publication",
          `Desde que se publicó la versión actual, ${moved.join(" y ")}. Lo que el cliente ve sigue siendo exactamente lo aprobado; publicar de nuevo es lo que lo pondría al día.`,
          moved,
        ),
      );
    }
  }

  return verdict(blockers, warnings, subject.acknowledged);
}

/* -------------------------------------------------------------------------- */

function verdict(
  blockers: PublicationBlocker[],
  warnings: PublicationWarning[],
  acknowledged: readonly string[],
): PublicationPreflight {
  // REQUIRED IS DERIVED FROM WHAT WAS RAISED, never from the whole vocabulary.
  // A reviewer must not be asked to acknowledge a condition this document does
  // not have — a screen full of inapplicable checkboxes teaches people to tick
  // every box without reading one.
  const required = WARNINGS_REQUIRING_ACKNOWLEDGEMENT.filter((code) =>
    warnings.some((entry) => entry.code === code),
  );
  const unacknowledged = required.filter((code) => !acknowledged.includes(code));
  return {
    blockers,
    warnings,
    required,
    unacknowledged,
    canPublish: blockers.length === 0 && unacknowledged.length === 0,
  };
}

/**
 * WHICH decode failure this is, from the presentation layer's own codes.
 *
 * The digest check lives HERE and not as a second comparison of its own, and
 * that is deliberate. `decodePresentationFromStorage` already recomputes the
 * SHA-256 over the stored bytes and refuses `persistence_hash_mismatch` when it
 * disagrees — so a preflight that recomputed the digest a second time would be
 * asserting something the step before it has proved, and would report green
 * every time for the rest of the product's life. What is worth doing is
 * translating that refusal into the sentence a reviewer needs.
 */
function classifyDecodeFailure(issues: readonly PublicationIssue[]): PublicationBlocker {
  const has = (code: string) => issues.some((issue) => issue.code === code);

  if (has("persistence_scope_mismatch")) {
    return blocker(
      "study_scope_drift",
      "La presentación almacenada pertenece a otro estudio. No se publica aquí bajo ninguna circunstancia: resolvería sin fallar y respondería con las cifras de otro cliente.",
    );
  }
  if (has("persistence_hash_mismatch")) {
    return blocker(
      "draft_digest_moved",
      "Los bytes guardados no corresponden a la huella que se guardó junto a ellos. Algo escribió sin pasar por el guardado del producto, y no se publica hasta saber qué.",
    );
  }
  if (
    has("unsupported_schema_version") ||
    has("malformed_document") ||
    has("duplicate_id") ||
    has("unknown_reference") ||
    has("invalid_layout") ||
    has("invalid_filter_connection")
  ) {
    return blocker(
      "document_invalid",
      "Lo que hay guardado no es una presentación canónica válida de la versión que este producto lee. No se reinterpreta ni se migra.",
    );
  }
  return blocker(
    "stored_draft_undecodable",
    "La presentación guardada no se puede leer de vuelta tal como está almacenada. No se publica una aproximación: hay que revisarla antes.",
  );
}

type Inspection = {
  unresolved: string[];
  unavailable: string[];
  configurationRequired: string[];
  hidden: string[];
  withheld: string[];
  annotated: string[];
  /** Blocks the author marked required whose content is not there. */
  requiredMissing: string[];
  /** Panels the author placed that a client will not receive. */
  inoperablePanels: string[];
  /**
   * Filter characteristics offering an option only one person carries.
   *
   * One sentence per dimension, naming the panel, the characteristic and how
   * many of its options are that small. Never the option's own label: naming
   * «Giro: Notaría (1 persona)» on a review screen is naming the person.
   */
  granularDimensions: string[];
  /** How many blocks a client would actually see something in. */
  visible: number;
};

/**
 * Read every block's OUTCOME out of the resolved model.
 *
 * Nothing here recomputes anything. `availability` is the contract's own
 * four-valued state, `sampleDisplay` is the outcome the resolver decided from an
 * authored policy, and `visible` is what the author wrote. This function
 * classifies; it does not judge.
 */
function inspectBlocks(
  model: PresentationRenderModel,
  live: boolean,
  requiredBlockIds: ReadonlySet<string>,
): Inspection {
  const found: Inspection = {
    unresolved: [],
    unavailable: [],
    configurationRequired: [],
    hidden: [],
    withheld: [],
    annotated: [],
    requiredMissing: [],
    inoperablePanels: [],
    granularDimensions: [],
    visible: 0,
  };

  for (const page of model.pages) {
    for (const block of page.blocks) {
      const where = `${pageTitle(page)} · ${blockTitle(block)}`;
      // THE COUNT IS THE RENDERER'S OWN VERDICT, taken once, before the
      // classification below. It used to be `found.visible += 1` at the bottom
      // of this loop — a third implementation of a rule two other files also
      // held — and it disagreed with both of them about a filter panel.
      const seen = clientSeesBlock(block, live);
      if (seen) found.visible += 1;

      // REQUIRED AND ABSENT, whatever the reason it is absent. A required
      // block waiting for content, hidden by its author, emptied by a policy
      // or holding nothing at all are four ways to deliver the same missing
      // half of the approved experience, and the reviewer needs to be stopped
      // by all four rather than by the one this file happened to test for.
      if (requiredBlockIds.has(block.id) && !seen) {
        found.requiredMissing.push(where);
        continue;
      }

      if (!block.visible) {
        found.hidden.push(where);
        continue;
      }
      if (block.availability === "unresolved") {
        found.unresolved.push(where);
        continue;
      }
      if (block.availability === "configuration_required") {
        found.configurationRequired.push(where);
        continue;
      }
      if (block.availability === "unavailable") {
        found.unavailable.push(where);
        continue;
      }
      if (block.sampleDisplay.state === "withheld_by_policy") {
        found.withheld.push(where);
        continue;
      }
      if (block.payload.shape === "filter_controls") {
        if (!filterPanelIsOperable(block, live)) {
          found.inoperablePanels.push(where);
          continue;
        }
        // COUNTED, NOT COMPARED. `participants` is the canonical layer's own
        // unfiltered figure for that option, already measured; this counts how
        // many of a dimension's options carry exactly one person. No threshold
        // is chosen, nothing is hidden, and no number moves.
        for (const dimension of block.payload.dimensions) {
          const alone = dimension.options.filter((option) => option.participants === 1).length;
          if (alone === 0) continue;
          found.granularDimensions.push(
            `${where} · ${dimension.label}: ${alone} ${alone === 1 ? "opción" : "opciones"} ` +
              `${alone === 1 ? "corresponde" : "corresponden"} a una sola persona`,
          );
        }
      }
      if (block.sampleDisplay.state === "shown_with_note") {
        found.annotated.push(where);
      }
    }
  }

  return found;
}
