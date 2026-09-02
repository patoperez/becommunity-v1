import type {
  CanonicalPackageSpec,
  CanonicalSheetSpec,
  ColumnEntitySheetSpec,
  PairedItemInstrumentSpec,
  RowRecordSheetSpec,
} from "../canonical-package/spec";
import { SheetView, WorkbookView, columnLetters, columnNumber, columnRange } from "../canonical-package/sheet-view";
import type { AbsenceState, ClassifiedValue, SourceValueStatus } from "../canonical-package/values";
import { classifySourceValue, isPopulated, normalizeToken, normalizeWhitespace } from "../canonical-package/values";
import { derivedRecordId } from "./ids";
import type {
  CanonicalCommitPlan,
  CommitPlanBuild,
  PlanAttributeDefinition,
  PlanBandRule,
  PlanBandScheme,
  PlanCultureDimension,
  PlanIssue,
  PlanJourneyModel,
  PlanJourneyStage,
  PlanJourneyStageEvidenceLink,
  PlanMembershipEpisode,
  PlanMetricDefinition,
  PlanMetricItemLink,
  PlanOrganizationalUnit,
  PlanPainPoint,
  PlanPainPointCultureDimension,
  PlanPainPointJourneyStage,
  PlanPainPointOrganizationalUnit,
  PlanPainPointPerformanceDimension,
  PlanParticipant,
  PlanParticipantAttributeValue,
  PlanPerformanceDimension,
  PlanPerformanceObservation,
  PlanPerson,
  PlanPersonIdentifier,
  PlanResponseOption,
  PlanResponseScale,
  PlanRetentionPeriod,
  PlanSourceLineage,
  PlanStudyDomain,
  PlanSurveyInstrument,
  PlanSurveyItem,
  PlanSurveyResponse,
  PlanSurveySession,
  PlanVisualAnnotation,
} from "./plan";
import { PLAN_FAMILIES } from "./plan";
import { commitPlanFingerprint } from "./fingerprint";
import type {
  CohortProjectionSpec,
  CuratedEntityProjectionSpec,
  InstrumentProjectionSpec,
  PackageProjectionSpec,
} from "./projection-spec";

/**
 * The deterministic source-to-canonical projector.
 *
 * WHAT IT IS. A pure function from parsed workbooks plus versioned
 * configuration to one `CanonicalCommitPlan`. It reads no clock, no random
 * number and no database, so the same bytes always produce the same plan —
 * which is what makes the plan fingerprint, and therefore the whole
 * idempotency story, mean anything.
 *
 * THE FOUR RULES IT EXISTS TO KEEP.
 *
 *   1. ABSENCE IS NOT ZERO. Every source cell is classified before it is read,
 *      and only an `answered` cell may carry a value. `missing`, `unknown`,
 *      `not_applicable`, `source_unavailable` and `not_participated` reach the
 *      database as themselves. An answered "0" reaches it as 0.
 *   2. NON-PARTICIPATION IS NOT AN ANSWER. A person the source says did not
 *      take part gets a session with status `not_participated` and NO response
 *      rows at all. Zero responses is the record; a row of nulls would not be.
 *   3. A DERIVED LABEL IS NOT A SECOND ANSWER. The spreadsheet's own label
 *      beside a value is stored on the SAME response row, in
 *      `source_derived_label`. Importing it as its own response would double
 *      every count and present a rounded band as if a person had chosen it.
 *   4. A COLOUR HAS NO GLOBAL MEANING. Fills become `visual_annotation` rows
 *      with `review_status = 'pending'` and an interpretation that states the
 *      colour is uninterpreted. The band scheme's ranges come from documented
 *      configuration, never from the colours next to them.
 *
 * WHAT IT REFUSES. Anything it would have to guess: a declared numeric column
 * whose answer is not a number, a scale whose options collide once normalised,
 * a metric whose documented evidence column cannot be identified uniquely, a
 * generated key that collides with another. Each is a blocker with a sheet and
 * a coordinate, and a blocker means no plan is produced at all.
 */

type SheetBinding = { role: string; sheet: SheetView; spec: CanonicalSheetSpec };

export type ProjectionInput = {
  tenantId: string;
  studyId: string;
  /** Unit 2's package key: mapping version, roles and file hashes sorted by role. */
  packageIdempotencyKey: string;
  spec: CanonicalPackageSpec;
  projection: PackageProjectionSpec;
  /** Semantic role -> the parsed workbook that resolved to it. */
  workbooks: Map<string, WorkbookView>;
};

/** Uncommitted, uninterpreted evidence: what a fill is until a human rules on it. */
const UNINTERPRETED =
  "Evidencia visual sin interpretar: el color se conserva como prueba de que alguien marcó la celda " +
  "y no recibe significado hasta que una persona lo confirme.";

const LABEL_LIMIT = 200;
const PROMPT_LIMIT = 8000;
const ITEM_LABEL_LIMIT = 500;
const RAW_ATTRIBUTE_LIMIT = 8192;
const RAW_RESPONSE_LIMIT = 32768;
const PAIN_TEXT_LIMIT = 16000;

class Issues {
  readonly list: PlanIssue[] = [];

  add(
    severity: PlanIssue["severity"],
    code: string,
    message: string,
    where: Partial<Omit<PlanIssue, "severity" | "code" | "message">> = {},
  ): void {
    this.list.push({
      code,
      severity,
      assetRole: where.assetRole ?? null,
      sheet: where.sheet ?? null,
      coordinate: where.coordinate ?? null,
      message,
      expected: where.expected ?? null,
      actual: where.actual ?? null,
    });
  }

  get blockers(): number {
    return this.list.filter((issue) => issue.severity === "blocker").length;
  }
}

/** UTF-8 length, because every database bound in this schema is in bytes. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function clampLabel(raw: string, limit: number, fallback: string): string {
  const normalized = normalizeWhitespace(raw);
  if (normalized === "") return fallback;
  return normalized.length <= limit ? normalized : normalized.slice(0, limit);
}

/**
 * The raw source text, or null when it exceeds what the column may hold.
 *
 * Truncating would produce a provenance value that is not what the source
 * says, which is worse than admitting the cell was too large to echo: the
 * lineage row still names the exact coordinate, so the source is one click
 * away.
 */
function boundedRaw(raw: string, limit: number): string | null {
  return byteLength(raw) <= limit ? raw : null;
}

const ISO_DATE = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2})?$/;

function isoDatePart(raw: string): string | null {
  return ISO_DATE.exec(raw.trim())?.[1] ?? null;
}

/** A stable, schema-legal key fragment. Never derived from client content. */
function orderedKey(prefix: string, index: number): string {
  return `${prefix}_${String(index + 1).padStart(2, "0")}`;
}

const KEY_SHAPE = /^[a-z][a-z0-9_]{0,79}$/;

export function buildCanonicalCommitPlan(input: ProjectionInput): CommitPlanBuild {
  const issues = new Issues();
  const { spec, projection, packageIdempotencyKey } = input;

  if (projection.specId !== spec.id || projection.mappingVersion !== spec.mappingVersion) {
    issues.add(
      "blocker",
      "PROJECTION_SPEC_MISMATCH",
      `La configuración de proyección (${projection.specId} v${projection.mappingVersion}) no ` +
        `corresponde a la especificación del paquete (${spec.id} v${spec.mappingVersion}).`,
      { expected: `${spec.id} v${spec.mappingVersion}`, actual: `${projection.specId} v${projection.mappingVersion}` },
    );
    return { ok: false, plan: null, issues: issues.list };
  }

  // ---- bind every declared sheet to the workbook that carries it -----------
  const sheets = new Map<string, SheetBinding>();
  for (const roleSpec of spec.roles) {
    const view = input.workbooks.get(roleSpec.role);
    if (!view) {
      issues.add("blocker", "PROJECTION_ROLE_MISSING", `Falta el archivo del papel '${roleSpec.role}'.`, {
        assetRole: roleSpec.role,
      });
      continue;
    }
    for (const sheetSpec of roleSpec.sheets) {
      const sheet = view.sheet(sheetSpec.sourceName);
      if (!sheet) {
        issues.add(
          "blocker",
          "PROJECTION_SHEET_MISSING",
          `El archivo del papel '${roleSpec.role}' no tiene la hoja '${sheetSpec.sourceName}'.`,
          { assetRole: roleSpec.role, sheet: sheetSpec.sourceName },
        );
        continue;
      }
      sheets.set(sheetSpec.key, { role: roleSpec.role, sheet, spec: sheetSpec });
    }
  }
  if (issues.blockers > 0) return { ok: false, plan: null, issues: issues.list };

  const rowSheet = (key: string): (SheetBinding & { spec: RowRecordSheetSpec }) | null => {
    const binding = sheets.get(key);
    if (!binding || binding.spec.kind !== "row_records") return null;
    return binding as SheetBinding & { spec: RowRecordSheetSpec };
  };
  const entitySheet = (key: string): (SheetBinding & { spec: ColumnEntitySheetSpec }) | null => {
    const binding = sheets.get(key);
    if (!binding || binding.spec.kind !== "column_entities") return null;
    return binding as SheetBinding & { spec: ColumnEntitySheetSpec };
  };

  // The identity scope. The package key alone is NOT enough: it is derived from
  // the mapping version, the roles and the file hashes, so importing the same
  // two files into a second study would derive identical primary keys and
  // collide on the first insert. Tenant and study make each import's rows its
  // own; a record that genuinely IS shared — a person — is still matched by its
  // natural key when the commit runs, which is what makes reuse work.
  const scopeKey = `${packageIdempotencyKey}|${input.tenantId}|${input.studyId}`;
  const id = (table: string, natural: string): string => derivedRecordId(scopeKey, table, natural);

  const lineage: PlanSourceLineage[] = [];
  const trace = (
    binding: SheetBinding,
    cellOrRange: string,
    row: number | null,
    column: string | null,
    targetTable: string,
    targetRecordId: string,
    targetField: string,
    transformationKey: string,
    rawValue: string | null,
  ): void => {
    lineage.push({
      sourceAssetRole: binding.role,
      sheetName: binding.sheet.name,
      cellOrRange,
      sourceRow: row,
      sourceColumn: column,
      targetTable,
      targetRecordId,
      targetField,
      transformationKey,
      sourceRawValue: rawValue,
    });
  };

  // -------------------------------------------------------------------------
  // Visual evidence, recorded per sheet and per distinct fill
  // -------------------------------------------------------------------------
  const annotations: PlanVisualAnnotation[] = [];
  const annotationByFill = new Map<string, string>();

  /**
   * One annotation per distinct explicit fill inside a region.
   *
   * The coordinate is the FIRST cell carrying that fill, which is unique per
   * colour and gives a reviewer somewhere to open. The interpretation states
   * that the colour means nothing yet — the row exists so a human can decide,
   * not so the importer can.
   */
  const annotateFills = (
    binding: SheetBinding,
    role: PlanVisualAnnotation["role"],
    region: { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number },
    regionLabel: string,
  ): void => {
    const first = new Map<string, { address: string; styleIndex: number | null; cells: number }>();
    for (const cell of binding.sheet.cells) {
      if (cell.row < region.firstRow || cell.row > region.lastRow) continue;
      if (cell.column < region.firstColumn || cell.column > region.lastColumn) continue;
      if (!cell.fillRgb) continue;
      const seen = first.get(cell.fillRgb);
      if (seen) seen.cells += 1;
      else first.set(cell.fillRgb, { address: cell.address, styleIndex: cell.styleIndex, cells: 1 });
    }
    for (const [rgb, evidence] of [...first.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const natural = `${role}|${binding.sheet.name}|${evidence.address}`;
      const annotationId = id("visual_annotation", natural);
      annotations.push({
        id: annotationId,
        sourceAssetRole: binding.role,
        sheetName: binding.sheet.name,
        cellOrRange: evidence.address,
        fillRgb: rgb,
        fontRgb: null,
        sourceStyleId: evidence.styleIndex,
        role,
        interpretation:
          `Relleno ${rgb} en ${regionLabel} de la hoja '${binding.sheet.name}' (${evidence.cells} celda(s)). ` +
          UNINTERPRETED,
        confidence: "observed",
        reviewStatus: "pending",
      });
      annotationByFill.set(`${binding.sheet.name}|${role}|${rgb}`, annotationId);
      trace(
        binding,
        evidence.address,
        null,
        null,
        "visual_annotation",
        annotationId,
        "fill_rgb",
        "visual_fill",
        rgb,
      );
    }
  };

  const fillAnnotationFor = (
    sheetName: string,
    role: PlanVisualAnnotation["role"],
    rgb: string | null,
  ): string | null => (rgb ? annotationByFill.get(`${sheetName}|${role}|${rgb}`) ?? null : null);

  // -------------------------------------------------------------------------
  // Identity: one person, one participation per cohort
  // -------------------------------------------------------------------------
  const persons: PlanPerson[] = [];
  const personIdentifiers: PlanPersonIdentifier[] = [];
  const participants: PlanParticipant[] = [];
  const membershipEpisodes: PlanMembershipEpisode[] = [];
  const personKeyByToken = new Map<string, string>();
  const participantIdByCohortToken = new Map<string, string>();

  const catalogue = rowSheet(projection.catalogue.sheetKey);
  if (!catalogue) {
    issues.add("blocker", "PROJECTION_CATALOGUE_MISSING", "El catálogo de identidad no está disponible.");
    return { ok: false, plan: null, issues: issues.list };
  }

  const catalogueIdIndex = columnNumber(projection.catalogue.idColumn);
  const catalogueNameIndex = columnNumber(projection.catalogue.nameColumn);
  for (let row = catalogue.spec.firstDataRow; row <= catalogue.sheet.maxRow; row++) {
    const rawId = catalogue.sheet.textAtRc(row, catalogueIdIndex);
    if (!isPopulated(rawId)) continue;
    const token = normalizeToken(rawId);
    if (personKeyByToken.has(token)) {
      issues.add(
        "blocker",
        "PROJECTION_DUPLICATE_IDENTITY",
        `El catálogo '${catalogue.sheet.name}' repite un identificador en la fila ${row}.`,
        { assetRole: catalogue.role, sheet: catalogue.sheet.name, coordinate: `${projection.catalogue.idColumn}${row}` },
      );
      continue;
    }
    const rawName = catalogue.sheet.textAtRc(row, catalogueNameIndex);
    const natural = `${projection.identityNamespace}|${token}`;
    const personId = id("person_private", natural);
    const identifierId = id("person_external_identifier", natural);
    persons.push({
      key: token,
      id: personId,
      displayName: normalizeWhitespace(rawName) || normalizeWhitespace(rawId),
      normalizedName: normalizeToken(rawName) || token,
      identityNamespace: projection.identityNamespace,
      identityNormalizedValue: token,
    });
    personIdentifiers.push({
      id: identifierId,
      personKey: token,
      namespace: projection.identityNamespace,
      originalValue: normalizeWhitespace(rawId),
      normalizedValue: token,
      isPrimary: true,
    });
    personKeyByToken.set(token, token);
    trace(
      catalogue,
      `${projection.catalogue.nameColumn}${row}`,
      row,
      projection.catalogue.nameColumn,
      "person_private",
      personId,
      "display_name_private",
      "catalogue_name",
      boundedRaw(rawName, RAW_ATTRIBUTE_LIMIT),
    );
    trace(
      catalogue,
      `${projection.catalogue.idColumn}${row}`,
      row,
      projection.catalogue.idColumn,
      "person_external_identifier",
      identifierId,
      "normalized_value",
      "catalogue_identifier",
      boundedRaw(rawId, RAW_ATTRIBUTE_LIMIT),
    );
  }

  // -------------------------------------------------------------------------
  // Cohorts: participation, membership episodes and typed attributes
  // -------------------------------------------------------------------------
  const attributeDefinitions: PlanAttributeDefinition[] = [];
  const participantAttributeValues: PlanParticipantAttributeValue[] = [];
  const attributeIdByKey = new Map<string, string>();
  /** cohortKey -> participation status per identity token, from the source flag. */
  const declaredParticipation = new Map<string, Map<string, SourceValueStatus>>();

  const projectCohort = (cohort: CohortProjectionSpec): void => {
    const binding = rowSheet(cohort.sheetKey);
    if (!binding) {
      issues.add("blocker", "PROJECTION_COHORT_SHEET_MISSING", `Falta la hoja de la cohorte '${cohort.cohortKey}'.`);
      return;
    }
    const idIndex = columnNumber(cohort.idColumn);
    const flagTokens = new Map<string, AbsenceState>(
      (cohort.participation?.absentTokens ?? []).map(({ token, status }): [string, AbsenceState] => [
        normalizeToken(token),
        status,
      ]),
    );
    const respondedTokens = new Set((cohort.participation?.respondedTokens ?? []).map(normalizeToken));
    const cohortParticipation = new Map<string, SourceValueStatus>();
    declaredParticipation.set(cohort.cohortKey, cohortParticipation);

    // Attribute DEFINITIONS come from the header row, so the label is what the
    // source calls the column rather than something this file invented.
    for (const [order, attribute] of cohort.attributes.entries()) {
      const key = `${cohort.sheetKey}_${attribute.column.toLowerCase()}`;
      if (!KEY_SHAPE.test(key)) {
        issues.add("blocker", "PROJECTION_ATTRIBUTE_KEY_INVALID", `La clave de atributo '${key}' no es válida.`, {
          assetRole: binding.role,
          sheet: binding.sheet.name,
          coordinate: attribute.column,
        });
        continue;
      }
      if (attributeIdByKey.has(key)) {
        issues.add("blocker", "PROJECTION_ATTRIBUTE_KEY_COLLISION", `La clave de atributo '${key}' está repetida.`, {
          assetRole: binding.role,
          sheet: binding.sheet.name,
          coordinate: attribute.column,
        });
        continue;
      }
      const headerCell = `${attribute.column}${binding.spec.headerRow}`;
      const header = binding.sheet.textAt(headerCell);
      const definitionId = id("attribute_definition", key);
      attributeDefinitions.push({
        id: definitionId,
        key,
        label: clampLabel(header, LABEL_LIMIT, key),
        dataType: attribute.dataType,
        sensitivity: attribute.sensitivity,
        filterable: attribute.filterable,
        displayOrder: order,
      });
      attributeIdByKey.set(key, definitionId);
      trace(
        binding,
        headerCell,
        binding.spec.headerRow,
        attribute.column,
        "attribute_definition",
        definitionId,
        "label",
        "attribute_header",
        boundedRaw(header, RAW_ATTRIBUTE_LIMIT),
      );
    }

    for (let row = binding.spec.firstDataRow; row <= binding.sheet.maxRow; row++) {
      const rawId = binding.sheet.textAtRc(row, idIndex);
      if (!isPopulated(rawId)) continue;
      const token = normalizeToken(rawId);
      if (!personKeyByToken.has(token)) {
        issues.add(
          "blocker",
          "PROJECTION_IDENTITY_NOT_CATALOGUED",
          `La hoja '${binding.sheet.name}' fila ${row} tiene un identificador que no está en el catálogo.`,
          { assetRole: binding.role, sheet: binding.sheet.name, coordinate: `${cohort.idColumn}${row}` },
        );
        continue;
      }
      const cohortToken = `${cohort.cohortKey}|${token}`;
      if (participantIdByCohortToken.has(cohortToken)) {
        issues.add(
          "blocker",
          "PROJECTION_DUPLICATE_PARTICIPATION",
          `La hoja '${binding.sheet.name}' repite el identificador de la fila ${row} en la misma cohorte.`,
          { assetRole: binding.role, sheet: binding.sheet.name, coordinate: `${cohort.idColumn}${row}` },
        );
        continue;
      }

      let surveyParticipation: PlanParticipant["surveyParticipationStatus"] = "unknown";
      if (cohort.participation) {
        const cell = `${cohort.participation.column}${row}`;
        const raw = binding.sheet.textAt(cell);
        const classified = classifySourceValue(raw, flagTokens);
        if (classified.status === "not_participated") {
          surveyParticipation = "not_participated";
          cohortParticipation.set(token, "not_participated");
        } else if (respondedTokens.has(normalizeToken(raw))) {
          surveyParticipation = "responded";
          cohortParticipation.set(token, "answered");
        } else {
          cohortParticipation.set(token, classified.status === "answered" ? "answered" : classified.status);
        }
      }

      const participantId = id("study_participant", cohortToken);
      participants.push({
        id: participantId,
        personKey: token,
        cohortKey: cohort.cohortKey,
        participationStatus: "included",
        surveyParticipationStatus: surveyParticipation,
        sourceStatus: "answered",
      });
      participantIdByCohortToken.set(cohortToken, participantId);
      trace(
        binding,
        `${cohort.idColumn}${row}`,
        row,
        cohort.idColumn,
        "study_participant",
        participantId,
        "cohort_key",
        "cohort_membership",
        boundedRaw(rawId, RAW_ATTRIBUTE_LIMIT),
      );
      if (cohort.participation) {
        trace(
          binding,
          `${cohort.participation.column}${row}`,
          row,
          cohort.participation.column,
          "study_participant",
          participantId,
          "survey_participation_status",
          "participation_flag",
          boundedRaw(binding.sheet.textAt(`${cohort.participation.column}${row}`), RAW_ATTRIBUTE_LIMIT),
        );
      }

      if (cohort.membership) {
        const startCell = `${cohort.membership.startColumn}${row}`;
        const startRaw = binding.sheet.textAt(startCell);
        const startClassified = classifySourceValue(startRaw);
        const startDate = startClassified.status === "answered" ? isoDatePart(startRaw) : null;
        let endDate: string | null = null;
        if (cohort.membership.endColumn && startDate) {
          const endCell = `${cohort.membership.endColumn}${row}`;
          const endRaw = binding.sheet.textAt(endCell);
          const endClassified = classifySourceValue(endRaw);
          endDate = endClassified.status === "answered" ? isoDatePart(endRaw) : null;
          if (endDate !== null && endDate <= startDate) {
            issues.add(
              "blocker",
              "PROJECTION_EPISODE_ORDER",
              `La hoja '${binding.sheet.name}' fila ${row} tiene una fecha de fin que no es posterior a la de ` +
                "inicio. El episodio de membresía no se puede afirmar con esas fechas.",
              { assetRole: binding.role, sheet: binding.sheet.name, coordinate: endCell },
            );
          }
        }
        const episodeId = id("membership_episode", cohortToken);
        const status: PlanMembershipEpisode["status"] =
          startDate !== null
            ? "answered"
            : startClassified.status === "answered"
              ? "unknown"
              : (startClassified.status as PlanMembershipEpisode["status"]);
        membershipEpisodes.push({
          id: episodeId,
          participantId,
          startsOn: startDate,
          endsOn: startDate === null ? null : endDate,
          status,
          endReason: null,
        });
        trace(
          binding,
          startCell,
          row,
          cohort.membership.startColumn,
          "membership_episode",
          episodeId,
          "starts_on",
          "episode_start",
          boundedRaw(startRaw, RAW_ATTRIBUTE_LIMIT),
        );
        if (cohort.membership.endColumn) {
          trace(
            binding,
            `${cohort.membership.endColumn}${row}`,
            row,
            cohort.membership.endColumn,
            "membership_episode",
            episodeId,
            "ends_on",
            "episode_end",
            boundedRaw(binding.sheet.textAt(`${cohort.membership.endColumn}${row}`), RAW_ATTRIBUTE_LIMIT),
          );
        }
      }

      for (const attribute of cohort.attributes) {
        const key = `${cohort.sheetKey}_${attribute.column.toLowerCase()}`;
        const definitionId = attributeIdByKey.get(key);
        if (!definitionId) continue;
        const cell = `${attribute.column}${row}`;
        const raw = binding.sheet.textAt(cell);
        const classified = classifySourceValue(raw);
        const valueId = id("participant_attribute_value", `${cohortToken}|${key}`);
        const value = typedAttributeValue(classified, attribute.dataType);
        if (value === null) {
          issues.add(
            "blocker",
            "PROJECTION_ATTRIBUTE_TYPE_MISMATCH",
            `La hoja '${binding.sheet.name}' celda ${cell} tiene un valor que no corresponde al tipo ` +
              `'${attribute.dataType}' declarado para esa columna. El proyector no adivina el tipo.`,
            { assetRole: binding.role, sheet: binding.sheet.name, coordinate: cell, expected: attribute.dataType },
          );
          continue;
        }
        participantAttributeValues.push({
          id: valueId,
          participantId,
          attributeDefinitionId: definitionId,
          status: classified.status,
          valueText: value.valueText,
          valueNumeric: value.valueNumeric,
          valueDate: value.valueDate,
          valueBoolean: value.valueBoolean,
          sourceRawValue: boundedRaw(raw, RAW_ATTRIBUTE_LIMIT),
        });
        trace(
          binding,
          cell,
          row,
          attribute.column,
          "participant_attribute_value",
          valueId,
          classified.status === "answered" ? value.field : "status",
          classified.status === "answered" ? `attribute_${attribute.dataType}` : "attribute_absence",
          null,
        );
      }
    }
  };

  for (const cohort of projection.cohorts) projectCohort(cohort);

  // -------------------------------------------------------------------------
  // Scales and their options
  // -------------------------------------------------------------------------
  const responseScales: PlanResponseScale[] = [];
  const responseOptions: PlanResponseOption[] = [];
  const scaleIdByKey = new Map<string, string>();
  /** scaleKey -> normalised raw value -> option id. Used to link an answer. */
  const optionByScale = new Map<string, Map<string, string>>();

  for (const scale of projection.scales) {
    const binding = rowSheet(scale.sheetKey);
    if (!binding) continue;
    const scaleId = id("response_scale", scale.key);
    const headerCell = `${scale.rawColumn}${binding.spec.headerRow}`;
    responseScales.push({
      id: scaleId,
      key: scale.key,
      label: clampLabel(binding.sheet.textAt(headerCell), LABEL_LIMIT, scale.key),
      valueType: scale.valueType,
    });
    scaleIdByKey.set(scale.key, scaleId);
    trace(
      binding,
      headerCell,
      binding.spec.headerRow,
      scale.rawColumn,
      "response_scale",
      scaleId,
      "label",
      "scale_header",
      boundedRaw(binding.sheet.textAt(headerCell), RAW_ATTRIBUTE_LIMIT),
    );

    const lookup = new Map<string, string>();
    optionByScale.set(scale.key, lookup);
    const rawIndex = columnNumber(scale.rawColumn);
    const labelIndex = scale.derivedLabelColumn ? columnNumber(scale.derivedLabelColumn) : 0;
    let order = 0;
    for (let row = binding.spec.firstDataRow; row <= binding.sheet.maxRow; row++) {
      const raw = binding.sheet.textAtRc(row, rawIndex);
      if (!isPopulated(raw)) continue;
      const normalized = normalizeToken(raw);
      if (lookup.has(normalized)) {
        issues.add(
          "blocker",
          "PROJECTION_SCALE_OPTION_COLLISION",
          `La escala '${scale.key}' tiene dos opciones que se normalizan igual (fila ${row}). Una respuesta ` +
            "no podría asignarse a una sola de ellas.",
          { assetRole: binding.role, sheet: binding.sheet.name, coordinate: `${scale.rawColumn}${row}` },
        );
        continue;
      }
      const classified = classifySourceValue(raw);
      const optionId = id("response_option", `${scale.key}|${normalized}`);
      const derivedLabel =
        labelIndex > 0 ? normalizeWhitespace(binding.sheet.textAtRc(row, labelIndex)) : "";
      responseOptions.push({
        id: optionId,
        responseScaleId: scaleId,
        rawValue: normalizeWhitespace(raw),
        numericValue: classified.status === "answered" ? classified.numeric : null,
        derivedLabel: derivedLabel === "" ? null : derivedLabel.slice(0, 200),
        responseStatus:
          classified.status === "not_participated"
            ? "unknown"
            : (classified.status as PlanResponseOption["responseStatus"]),
        displayOrder: order,
      });
      lookup.set(normalized, optionId);
      order += 1;
      trace(
        binding,
        `${scale.rawColumn}${row}`,
        row,
        scale.rawColumn,
        "response_option",
        optionId,
        "raw_value",
        "scale_option",
        boundedRaw(raw, RAW_ATTRIBUTE_LIMIT),
      );
      if (scale.derivedLabelColumn && derivedLabel !== "") {
        trace(
          binding,
          `${scale.derivedLabelColumn}${row}`,
          row,
          scale.derivedLabelColumn,
          "response_option",
          optionId,
          "derived_label",
          "scale_option_label",
          boundedRaw(binding.sheet.textAtRc(row, labelIndex), RAW_ATTRIBUTE_LIMIT),
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Instruments, items, sessions and responses
  // -------------------------------------------------------------------------
  const surveyInstruments: PlanSurveyInstrument[] = [];
  const studyDomains: PlanStudyDomain[] = [];
  const surveyItems: PlanSurveyItem[] = [];
  const surveySessions: PlanSurveySession[] = [];
  const surveyResponses: PlanSurveyResponse[] = [];
  const metricDefinitions: PlanMetricDefinition[] = [];
  const metricItemLinks: PlanMetricItemLink[] = [];

  const pairedFor = (sheetKey: string): PairedItemInstrumentSpec | null =>
    spec.pairedInstruments.find((paired) => paired.sheetKey === sheetKey) ?? null;

  const projectInstrument = (instrument: InstrumentProjectionSpec): void => {
    const binding = rowSheet(instrument.sheetKey);
    if (!binding) {
      issues.add(
        "blocker",
        "PROJECTION_INSTRUMENT_SHEET_MISSING",
        `Falta la hoja del instrumento '${instrument.key}'.`,
      );
      return;
    }
    const instrumentId = id("survey_instrument", instrument.key);
    surveyInstruments.push({
      id: instrumentId,
      key: instrument.key,
      label: clampLabel(binding.sheet.name, LABEL_LIMIT, instrument.key),
      audience: instrument.audience,
      version: 1,
      instrumentType: instrument.instrumentType,
    });

    // ---- items -------------------------------------------------------------
    type ProjectedItem = {
      id: string;
      valueColumn: string;
      derivedLabelColumn: string | null;
      domainId: string | null;
    };
    const items: ProjectedItem[] = [];
    const paired = instrument.pairedDomains ? pairedFor(instrument.sheetKey) : null;
    if (instrument.pairedDomains && !paired) {
      issues.add(
        "blocker",
        "PROJECTION_PAIRED_SPEC_MISSING",
        `El instrumento '${instrument.key}' declara dominios pareados pero la especificación del paquete no ` +
          "describe esa hoja.",
        { assetRole: binding.role, sheet: binding.sheet.name },
      );
      return;
    }

    let itemOrder = 0;
    const addItem = (
      valueColumn: string,
      derivedLabelColumn: string | null,
      domainId: string | null,
      headerRow: number,
    ): void => {
      const key = `${instrument.key}_${valueColumn.toLowerCase()}`;
      if (!KEY_SHAPE.test(key)) {
        issues.add("blocker", "PROJECTION_ITEM_KEY_INVALID", `La clave de ítem '${key}' no es válida.`, {
          assetRole: binding.role,
          sheet: binding.sheet.name,
          coordinate: valueColumn,
        });
        return;
      }
      const headerCell = `${valueColumn}${headerRow}`;
      const header = binding.sheet.textAt(headerCell);
      const itemId = id("survey_item", `${instrument.key}|${valueColumn}`);
      surveyItems.push({
        id: itemId,
        surveyInstrumentId: instrumentId,
        studyDomainId: domainId,
        responseScaleId: instrument.responseScaleKey
          ? scaleIdByKey.get(instrument.responseScaleKey) ?? null
          : null,
        key,
        prompt: clampLabel(header, PROMPT_LIMIT, key),
        label: clampLabel(header, ITEM_LABEL_LIMIT, key),
        itemOrder,
      });
      itemOrder += 1;
      items.push({ id: itemId, valueColumn, derivedLabelColumn, domainId });
      trace(
        binding,
        headerCell,
        headerRow,
        valueColumn,
        "survey_item",
        itemId,
        "label",
        "item_header",
        boundedRaw(header, RAW_RESPONSE_LIMIT),
      );
    };

    if (paired) {
      for (const [domainOrder, domain] of paired.domains.entries()) {
        const domainId = id("study_domain", `${instrument.key}|${domain.key}`);
        const mergedRange = `${domain.firstValueColumn}${paired.domainRow}:${domain.lastLabelColumn}${paired.domainRow}`;
        const hasMerge = binding.sheet.mergedRanges.includes(mergedRange);
        let annotationId: string | null = null;
        if (hasMerge) {
          // The merged band IS the evidence that these columns form one domain.
          // It is recorded as a structural group, not as a satisfaction band.
          annotationId = id("visual_annotation", `structural_group|${binding.sheet.name}|${mergedRange}`);
          annotations.push({
            id: annotationId,
            sourceAssetRole: binding.role,
            sheetName: binding.sheet.name,
            cellOrRange: mergedRange,
            fillRgb: null,
            fontRgb: null,
            sourceStyleId: binding.sheet.cellAt(`${domain.firstValueColumn}${paired.domainRow}`)?.styleIndex ?? null,
            role: "structural_group",
            interpretation:
              `Rango combinado ${mergedRange} que agrupa las columnas del dominio en la hoja ` +
              `'${binding.sheet.name}'. Es evidencia estructural del agrupamiento, no una banda de resultado.`,
            confidence: "observed",
            reviewStatus: "pending",
          });
          trace(
            binding,
            mergedRange,
            paired.domainRow,
            null,
            "visual_annotation",
            annotationId,
            "cell_or_range",
            "domain_merge",
            null,
          );
        }
        studyDomains.push({
          id: domainId,
          surveyInstrumentId: instrumentId,
          key: domain.key,
          label: clampLabel(domain.label, LABEL_LIMIT, domain.key),
          displayOrder: domainOrder,
          visualAnnotationId: annotationId,
        });
        const columns = columnRange(domain.firstValueColumn, domain.lastLabelColumn);
        // Two columns per item: the answer, then the label the sheet derived
        // from it. Stepping by two is what keeps the label from becoming an item.
        for (let offset = 0; offset < columns.length; offset += 2) {
          const valueColumn = columns[offset];
          if (!valueColumn) break;
          if (!isPopulated(binding.sheet.textAt(`${valueColumn}${paired.itemHeaderRow}`))) continue;
          addItem(valueColumn, columns[offset + 1] ?? null, domainId, paired.itemHeaderRow);
        }
      }
    } else {
      for (const item of instrument.items) {
        addItem(item.valueColumn, item.derivedLabelColumn, null, binding.spec.headerRow);
      }
    }

    // ---- sessions and responses -------------------------------------------
    const idIndex = columnNumber(instrument.identityColumn);
    const responded = new Set<string>();
    for (let row = binding.spec.firstDataRow; row <= binding.sheet.maxRow; row++) {
      const rawId = binding.sheet.textAtRc(row, idIndex);
      if (!isPopulated(rawId)) continue;
      const token = normalizeToken(rawId);
      const cohortKey = instrument.expectedCohorts.find((candidate) =>
        participantIdByCohortToken.has(`${candidate}|${token}`),
      );
      if (!cohortKey) {
        issues.add(
          "blocker",
          "PROJECTION_RESPONDENT_NOT_IN_COHORT",
          `La hoja '${binding.sheet.name}' fila ${row} responde por una identidad que no participa en ` +
            `${instrument.expectedCohorts.join(" ni ")}.`,
          { assetRole: binding.role, sheet: binding.sheet.name, coordinate: `${instrument.identityColumn}${row}` },
        );
        continue;
      }
      const participantId = participantIdByCohortToken.get(`${cohortKey}|${token}`) as string;
      responded.add(token);

      const sessionNatural = `${instrument.key}|${cohortKey}|${token}|1`;
      const sessionId = id("survey_session", sessionNatural);
      let submittedAt: string | null = null;
      if (instrument.submittedAtColumn) {
        const cell = `${instrument.submittedAtColumn}${row}`;
        const raw = binding.sheet.textAt(cell);
        const classified = classifySourceValue(raw);
        const iso = classified.status === "answered" ? isoDatePart(raw) : null;
        if (iso !== null) {
          submittedAt = raw.trim().includes("T") ? `${raw.trim()}Z` : `${iso}T00:00:00Z`;
          trace(
            binding,
            cell,
            row,
            instrument.submittedAtColumn,
            "survey_session",
            sessionId,
            "submitted_at",
            "session_timestamp",
            boundedRaw(raw, RAW_ATTRIBUTE_LIMIT),
          );
        }
      }
      surveySessions.push({
        id: sessionId,
        surveyInstrumentId: instrumentId,
        participantId,
        sourceAssetRole: binding.role,
        sourceRowNumber: row,
        occurrenceKey: "1",
        submittedAt,
        status: "answered",
      });
      trace(
        binding,
        `${instrument.identityColumn}${row}`,
        row,
        instrument.identityColumn,
        "survey_session",
        sessionId,
        "participant_id",
        "session_identity",
        null,
      );

      for (const item of items) {
        const cell = `${item.valueColumn}${row}`;
        const raw = binding.sheet.textAt(cell);
        const classified = classifySourceValue(raw);
        const responseId = id("survey_response", `${sessionNatural}|${item.valueColumn}`);
        const optionLookup = instrument.responseScaleKey
          ? optionByScale.get(instrument.responseScaleKey) ?? null
          : null;
        const optionId =
          classified.status === "answered" && optionLookup
            ? optionLookup.get(normalizeToken(raw)) ?? null
            : null;
        let derivedLabel: string | null = null;
        if (item.derivedLabelColumn) {
          const labelRaw = binding.sheet.textAt(`${item.derivedLabelColumn}${row}`);
          const label = normalizeWhitespace(labelRaw);
          if (label !== "") {
            derivedLabel = label.slice(0, 500);
            trace(
              binding,
              `${item.derivedLabelColumn}${row}`,
              row,
              item.derivedLabelColumn,
              "survey_response",
              responseId,
              "source_derived_label",
              "response_derived_label",
              null,
            );
          }
        }
        const answered = classified.status === "answered";
        surveyResponses.push({
          id: responseId,
          surveySessionId: sessionId,
          surveyItemId: item.id,
          responseOptionId: optionId,
          status: classified.status,
          valueNumeric: answered && optionId === null && classified.numeric !== null ? classified.numeric : null,
          valueText: answered && optionId === null && classified.numeric === null ? raw : null,
          valueDate: null,
          valueBoolean: null,
          sourceRawValue: boundedRaw(raw, RAW_RESPONSE_LIMIT),
          sourceDerivedLabel: derivedLabel,
        });
        trace(
          binding,
          cell,
          row,
          item.valueColumn,
          "survey_response",
          responseId,
          answered ? (optionId ? "response_option_id" : classified.numeric !== null ? "value_numeric" : "value_text") : "status",
          answered
            ? optionId
              ? "response_option"
              : classified.numeric !== null
                ? "response_numeric"
                : "response_text"
            : "response_absence",
          null,
        );
      }
    }

    // ---- explicit non-participation ----------------------------------------
    // A person the source says did not take part gets a session that SAYS SO
    // and no responses at all. A row of nulls would look like an answer sheet
    // somebody left blank, which is a different fact.
    if (instrument.nonParticipationCohort) {
      const flags = declaredParticipation.get(instrument.nonParticipationCohort);
      const cohortBinding = rowSheet(
        projection.cohorts.find((cohort) => cohort.cohortKey === instrument.nonParticipationCohort)?.sheetKey ?? "",
      );
      const cohortSpec = projection.cohorts.find(
        (cohort) => cohort.cohortKey === instrument.nonParticipationCohort,
      );
      for (const [token, status] of flags ?? []) {
        if (status !== "not_participated") continue;
        if (responded.has(token)) {
          issues.add(
            "warning",
            "PROJECTION_NON_PARTICIPANT_ANSWERED",
            `Una identidad marcada como no participante en la cohorte ` +
              `'${instrument.nonParticipationCohort}' sí tiene respuestas en '${binding.sheet.name}'. ` +
              "Se conserva la sesión respondida y no se crea una de no participación.",
            { assetRole: binding.role, sheet: binding.sheet.name },
          );
          continue;
        }
        const participantId = participantIdByCohortToken.get(`${instrument.nonParticipationCohort}|${token}`);
        if (!participantId) continue;
        const sessionNatural = `${instrument.key}|${instrument.nonParticipationCohort}|${token}|1`;
        const sessionId = id("survey_session", sessionNatural);
        surveySessions.push({
          id: sessionId,
          surveyInstrumentId: instrumentId,
          participantId,
          sourceAssetRole: cohortBinding?.role ?? binding.role,
          sourceRowNumber: null,
          occurrenceKey: "1",
          submittedAt: null,
          status: "not_participated",
        });
        if (cohortBinding && cohortSpec?.participation) {
          trace(
            cohortBinding,
            cohortSpec.participation.column,
            null,
            cohortSpec.participation.column,
            "survey_session",
            sessionId,
            "status",
            "session_non_participation",
            null,
          );
        }
      }
    }

    // ---- metrics whose evidence this instrument carries ---------------------
    const addMetric = (
      key: string,
      family: PlanMetricDefinition["family"],
      unit: PlanMetricDefinition["unit"],
      precision: number,
      bandSchemeKey: string | null,
      label: string,
      linkItemId: string | null,
    ): void => {
      if (!KEY_SHAPE.test(key)) {
        issues.add("blocker", "PROJECTION_METRIC_KEY_INVALID", `La clave de métrica '${key}' no es válida.`);
        return;
      }
      const metricId = id("metric_definition", key);
      metricDefinitions.push({
        id: metricId,
        key,
        label: clampLabel(label, LABEL_LIMIT, key),
        family,
        unit,
        precision,
        calculationVersion: projection.calculationVersion,
        bandSchemeId: bandSchemeKey ? id("band_scheme", bandSchemeKey) : null,
        // Nothing is publishable on import. Publication is an editorial act.
        isPublishable: false,
      });
      if (linkItemId) {
        metricItemLinks.push({
          id: id("metric_item_link", `${key}|answer|${linkItemId}`),
          metricDefinitionId: metricId,
          surveyItemId: linkItemId,
          studyDomainId: null,
          performanceDimensionId: null,
          role: "answer",
          displayOrder: 0,
        });
      }
    };

    for (const perItem of instrument.perItemMetrics) {
      for (const item of items) {
        const stored = surveyItems.find((candidate) => candidate.id === item.id);
        addMetric(
          `${perItem.keyPrefix}_${item.valueColumn.toLowerCase()}`,
          perItem.family,
          perItem.unit,
          perItem.precision,
          perItem.bandSchemeKey,
          stored?.label ?? item.valueColumn,
          item.id,
        );
      }
    }

    for (const columnMetric of instrument.columnMetrics) {
      const item = items.find((candidate) => candidate.valueColumn === columnMetric.valueColumn);
      if (!item) {
        issues.add(
          "blocker",
          "PROJECTION_METRIC_COLUMN_MISSING",
          `La métrica '${columnMetric.key}' declara la columna ${columnMetric.valueColumn} de ` +
            `'${binding.sheet.name}', que no produjo ningún ítem.`,
          { assetRole: binding.role, sheet: binding.sheet.name, coordinate: columnMetric.valueColumn },
        );
        continue;
      }
      const stored = surveyItems.find((candidate) => candidate.id === item.id);
      addMetric(
        columnMetric.key,
        columnMetric.family,
        columnMetric.unit,
        columnMetric.precision,
        columnMetric.bandSchemeKey,
        stored?.label ?? columnMetric.key,
        item.id,
      );
    }

    // A metric whose evidence column the mapping does NOT name is identified
    // from the documented option set, or refused. It is never assumed.
    for (const identified of instrument.identifiedMetrics) {
      const documented = new Set(identified.documentedOptions.map(normalizeToken));
      const matches = items.filter((item) => {
        const distinct = new Set<string>();
        for (let row = binding.spec.firstDataRow; row <= binding.sheet.maxRow; row++) {
          if (!isPopulated(binding.sheet.textAtRc(row, columnNumber(instrument.identityColumn)))) continue;
          const raw = binding.sheet.textAt(`${item.valueColumn}${row}`);
          const classified = classifySourceValue(raw);
          if (classified.status !== "answered") continue;
          distinct.add(normalizeToken(raw));
        }
        if (distinct.size === 0) return false;
        const covered = [...distinct].filter((value) => documented.has(value)).length;
        return covered === distinct.size && covered >= identified.minimumCoverage;
      });
      if (matches.length !== 1) {
        issues.add(
          "blocker",
          "PROJECTION_METRIC_EVIDENCE_AMBIGUOUS",
          `La métrica '${identified.key}' necesita exactamente una columna de '${binding.sheet.name}' cuyas ` +
            `respuestas pertenezcan al conjunto documentado; se encontraron ${matches.length}. ` +
            "El proyector no elige por parecido.",
          { assetRole: binding.role, sheet: binding.sheet.name, expected: 1, actual: matches.length },
        );
        continue;
      }
      const stored = surveyItems.find((candidate) => candidate.id === matches[0].id);
      addMetric(
        identified.key,
        identified.family,
        identified.unit,
        identified.precision,
        identified.bandSchemeKey,
        stored?.label ?? identified.key,
        matches[0].id,
      );
    }
  };

  for (const instrument of projection.instruments) projectInstrument(instrument);

  // A participant with at least one answered session responded; one the source
  // never flagged and who answered nothing stays `unknown` rather than becoming
  // a refusal the source never recorded.
  const answeredParticipants = new Set(
    surveySessions.filter((session) => session.status === "answered").map((session) => session.participantId),
  );
  for (const participant of participants) {
    if (participant.surveyParticipationStatus === "unknown" && answeredParticipants.has(participant.id)) {
      participant.surveyParticipationStatus = "responded";
    }
  }

  // -------------------------------------------------------------------------
  // Band schemes, taken from documented ranges and never from a colour
  // -------------------------------------------------------------------------
  const bandSchemes: PlanBandScheme[] = [];
  const bandRules: PlanBandRule[] = [];
  for (const scheme of projection.bandSchemes) {
    const schemeId = id("band_scheme", scheme.key);
    bandSchemes.push({
      id: schemeId,
      key: scheme.key,
      label: scheme.label,
      unit: scheme.unit,
      description: scheme.description,
    });
    for (const [order, rule] of scheme.rules.entries()) {
      bandRules.push({
        id: id("band_rule", `${scheme.key}|${order}`),
        bandSchemeId: schemeId,
        lowerBound: rule.lowerBound,
        upperBound: rule.upperBound,
        lowerInclusive: rule.lowerInclusive,
        upperInclusive: rule.upperInclusive,
        label: rule.label,
        semanticColor: rule.semanticColor,
        displayOrder: order,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Monthly performance
  // -------------------------------------------------------------------------
  const performanceDimensions: PlanPerformanceDimension[] = [];
  const performanceObservations: PlanPerformanceObservation[] = [];
  const performanceDimensionIdByKey = new Map<string, string>();

  for (const performance of projection.performance) {
    const binding = rowSheet(performance.sheetKey);
    const periods = spec.performance.find((entry) => entry.sheetKey === performance.sheetKey);
    if (!binding || !periods) {
      issues.add(
        "blocker",
        "PROJECTION_PERFORMANCE_SOURCE_MISSING",
        `No hay origen para el desempeño mensual declarado en '${performance.sheetKey}'.`,
      );
      continue;
    }
    const dimensionId = id("performance_dimension", performance.dimensionKey);
    performanceDimensions.push({
      id: dimensionId,
      key: performance.dimensionKey,
      label: performance.dimensionLabel,
      displayOrder: 0,
    });
    performanceDimensionIdByKey.set(performance.dimensionKey, dimensionId);

    const firstColumn = columnNumber(periods.periods[0]?.column ?? "A");
    const lastColumn = columnNumber(periods.periods[periods.periods.length - 1]?.column ?? "A");
    annotateFills(
      binding,
      "metric_band",
      {
        firstRow: binding.spec.firstDataRow,
        lastRow: binding.sheet.maxRow,
        firstColumn,
        lastColumn,
      },
      `el bloque mensual ${columnLetters(firstColumn)}:${columnLetters(lastColumn)}`,
    );

    const idIndex = columnNumber(binding.spec.identityColumn);
    for (let row = binding.spec.firstDataRow; row <= binding.sheet.maxRow; row++) {
      const rawId = binding.sheet.textAtRc(row, idIndex);
      if (!isPopulated(rawId)) continue;
      const participantId = participantIdByCohortToken.get(
        `${performance.cohortKey}|${normalizeToken(rawId)}`,
      );
      if (!participantId) continue;
      for (const period of periods.periods) {
        const cell = `${period.column}${row}`;
        const raw = binding.sheet.textAt(cell);
        const classified = classifySourceValue(raw);
        // An answered cell that is not a number is not a score. It is reported
        // and stored as `unknown`, never coerced into one.
        const numeric = classified.status === "answered" ? classified.numeric : null;
        const status: SourceValueStatus =
          classified.status === "answered" && numeric === null ? "unknown" : classified.status;
        const observationId = id(
          "performance_observation",
          `${performance.cohortKey}|${normalizeToken(rawId)}|${performance.dimensionKey}|${period.periodStart}`,
        );
        performanceObservations.push({
          id: observationId,
          participantId,
          performanceDimensionId: dimensionId,
          periodStart: period.periodStart,
          periodLabel: period.label,
          status: status === "answered" ? "answered" : status,
          value: status === "answered" ? numeric : null,
          sourceBandLabel: null,
          visualAnnotationId: fillAnnotationFor(
            binding.sheet.name,
            "metric_band",
            binding.sheet.cellAt(cell)?.fillRgb ?? null,
          ),
        });
        trace(
          binding,
          cell,
          row,
          period.column,
          "performance_observation",
          observationId,
          status === "answered" ? "value" : "status",
          status === "answered" ? "performance_month" : "performance_absence",
          null,
        );
      }
    }

    addPerformanceMetric(
      metricDefinitions,
      metricItemLinks,
      id,
      projection.calculationVersion,
      performance,
      dimensionId,
    );
  }

  // -------------------------------------------------------------------------
  // Retention: the source counts, with their states, and nothing recomputed
  // -------------------------------------------------------------------------
  const retentionPeriods: PlanRetentionPeriod[] = [];
  for (const retention of projection.retention) {
    const binding = rowSheet(retention.sheetKey);
    if (!binding) continue;
    const labelIndex = columnNumber(retention.labelColumn);
    let order = 0;
    for (let row = binding.spec.firstDataRow; row <= binding.sheet.maxRow; row++) {
      const rawLabel = binding.sheet.textAtRc(row, labelIndex);
      if (!isPopulated(rawLabel)) continue;
      const read = (column: string): { classified: ClassifiedValue; cell: string } => {
        const cell = `${column}${row}`;
        return { classified: classifySourceValue(binding.sheet.textAt(cell)), cell };
      };
      const starting = read(retention.startingColumn);
      const added = read(retention.newColumn);
      const ending = read(retention.endingColumn);
      const lost = read(retention.lostColumn);
      const asCount = (value: ClassifiedValue): number | null =>
        value.status === "answered" && value.numeric !== null && Number.isInteger(value.numeric)
          ? value.numeric
          : null;
      const startingCount = asCount(starting.classified);
      const newCount = asCount(added.classified);
      const endingCount = asCount(ending.classified);
      const lostCount = asCount(lost.classified);
      const statusOf = (value: ClassifiedValue, count: number | null): SourceValueStatus =>
        count === null ? (value.status === "answered" ? "unknown" : value.status) : "answered";
      const periodId = id("retention_period", `${retention.seriesKey}|${order}`);
      const identityVerified =
        startingCount !== null &&
        newCount !== null &&
        endingCount !== null &&
        lostCount !== null &&
        endingCount === startingCount - lostCount + newCount;
      retentionPeriods.push({
        id: periodId,
        seriesKey: retention.seriesKey,
        periodOrder: order,
        periodLabel: clampLabel(rawLabel, 100, `periodo_${order + 1}`),
        periodStartsOn: null,
        periodEndsOn: null,
        startingStatus: statusOf(starting.classified, startingCount),
        startingCount,
        newStatus: statusOf(added.classified, newCount),
        newCount,
        endingStatus: statusOf(ending.classified, endingCount),
        endingCount,
        lostStatus: statusOf(lost.classified, lostCount),
        lostCount,
        identityVerified,
      });
      for (const [column, field] of [
        [retention.startingColumn, "starting_count"],
        [retention.newColumn, "new_count"],
        [retention.endingColumn, "ending_count"],
        [retention.lostColumn, "lost_count"],
      ] as const) {
        trace(
          binding,
          `${column}${row}`,
          row,
          column,
          "retention_period",
          periodId,
          field,
          "retention_count",
          boundedRaw(binding.sheet.textAt(`${column}${row}`), RAW_ATTRIBUTE_LIMIT),
        );
      }
      order += 1;
    }

    // Both rates are catalogue formulas over these counts. They are declared as
    // metric definitions so the study says which rules apply; no rate is stored
    // here, because a stored rate cannot be re-derived from exact counts.
    for (const [key, family, label] of [
      [retention.retentionMetricKey, "retention", "Retención"],
      [retention.churnMetricKey, "churn", "Deserción"],
    ] as const) {
      metricDefinitions.push({
        id: id("metric_definition", key),
        key,
        label,
        family,
        unit: "percent",
        precision: 2,
        calculationVersion: projection.calculationVersion,
        bandSchemeId: null,
        isPublishable: false,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Curated entities and the findings attached to them
  // -------------------------------------------------------------------------
  const journeyModels: PlanJourneyModel[] = [];
  const journeyStages: PlanJourneyStage[] = [];
  const journeyStageEvidenceLinks: PlanJourneyStageEvidenceLink[] = [];
  const organizationalUnits: PlanOrganizationalUnit[] = [];
  const cultureDimensions: PlanCultureDimension[] = [];
  const painPoints: PlanPainPoint[] = [];
  const painPointJourneyStages: PlanPainPointJourneyStage[] = [];
  const painPointOrganizationalUnits: PlanPainPointOrganizationalUnit[] = [];
  const painPointPerformanceDimensions: PlanPainPointPerformanceDimension[] = [];
  const painPointCultureDimensions: PlanPainPointCultureDimension[] = [];
  const stageIdByIndex = new Map<string, string[]>();

  const projectCurated = (curated: CuratedEntityProjectionSpec): void => {
    const binding = entitySheet(curated.sheetKey);
    if (!binding) {
      issues.add(
        "blocker",
        "PROJECTION_CURATED_SHEET_MISSING",
        `Falta la hoja curada '${curated.sheetKey}'.`,
      );
      return;
    }
    const sheetSpec = binding.spec;
    const columns = columnRange(sheetSpec.entityColumns.from, sheetSpec.entityColumns.to);
    annotateFills(
      binding,
      "curated_annotation",
      {
        firstRow: sheetSpec.entityRow,
        lastRow: sheetSpec.contentRow,
        firstColumn: columnNumber(sheetSpec.entityColumns.from),
        lastColumn: columnNumber(sheetSpec.entityColumns.to),
      },
      `las filas ${sheetSpec.entityRow} y ${sheetSpec.contentRow}`,
    );

    let modelId: string | null = null;
    if (curated.target.kind === "journey") {
      modelId = id("journey_model", curated.target.modelKey);
      journeyModels.push({
        id: modelId,
        key: curated.target.modelKey,
        label: curated.target.modelLabel,
        audience: curated.target.audience,
        description: "",
        displayOrder: journeyModels.length,
      });
      stageIdByIndex.set(curated.sheetKey, []);
    }

    let order = 0;
    for (const column of columns) {
      const entityCell = `${column}${sheetSpec.entityRow}`;
      const entityRaw = binding.sheet.textAt(entityCell);
      if (!isPopulated(entityRaw)) continue;
      const entityKey = orderedKey(curated.keyPrefix, order);
      const label = clampLabel(entityRaw, LABEL_LIMIT, entityKey);
      const annotationId = fillAnnotationFor(
        binding.sheet.name,
        "curated_annotation",
        binding.sheet.cellAt(entityCell)?.fillRgb ?? null,
      );

      let entityId: string;
      let entityTable: string;
      if (curated.target.kind === "journey" && modelId) {
        entityId = id("journey_stage", `${curated.target.modelKey}|${entityKey}`);
        entityTable = "journey_stage";
        journeyStages.push({
          id: entityId,
          journeyModelId: modelId,
          key: entityKey,
          label,
          stageOrder: order,
          description: "",
          visualAnnotationId: annotationId,
        });
        stageIdByIndex.get(curated.sheetKey)?.push(entityId);
      } else if (curated.target.kind === "organizational_unit") {
        entityId = id("organizational_unit", entityKey);
        entityTable = "organizational_unit";
        organizationalUnits.push({
          id: entityId,
          key: entityKey,
          label,
          displayOrder: order,
          visualAnnotationId: annotationId,
        });
      } else if (curated.target.kind === "performance_dimension") {
        entityId = id("performance_dimension", entityKey);
        entityTable = "performance_dimension";
        if (performanceDimensionIdByKey.has(entityKey)) {
          issues.add(
            "blocker",
            "PROJECTION_DIMENSION_KEY_COLLISION",
            `La dimensión de desempeño '${entityKey}' ya existe con otro origen.`,
            { assetRole: binding.role, sheet: binding.sheet.name, coordinate: entityCell },
          );
          continue;
        }
        performanceDimensions.push({
          id: entityId,
          key: entityKey,
          label,
          displayOrder: performanceDimensions.length,
        });
        performanceDimensionIdByKey.set(entityKey, entityId);
      } else if (curated.target.kind === "culture_dimension") {
        entityId = id("culture_dimension", `${curated.target.audience}|${entityKey}`);
        entityTable = "culture_dimension";
        cultureDimensions.push({
          id: entityId,
          key: entityKey,
          label,
          audience: curated.target.audience,
          displayOrder: order,
          visualAnnotationId: annotationId,
        });
      } else {
        continue;
      }

      trace(
        binding,
        entityCell,
        sheetSpec.entityRow,
        column,
        entityTable,
        entityId,
        "label",
        "curated_entity_label",
        boundedRaw(entityRaw, RAW_ATTRIBUTE_LIMIT),
      );

      // An entity with no curated text produces NO finding. Inventing an empty
      // one would put a pain point in front of a consultant that nobody wrote.
      const contentCell = `${column}${sheetSpec.contentRow}`;
      const contentRaw = binding.sheet.textAt(contentCell);
      if (isPopulated(contentRaw)) {
        const painId = id("pain_point", `${curated.sheetKey}|${column}`);
        const rawText = contentRaw.slice(0, PAIN_TEXT_LIMIT);
        painPoints.push({
          id: painId,
          rawText,
          normalizedText: normalizeWhitespace(contentRaw).slice(0, PAIN_TEXT_LIMIT),
          reviewStatus: "pending",
          sourceVisualAnnotationId: fillAnnotationFor(
            binding.sheet.name,
            "curated_annotation",
            binding.sheet.cellAt(contentCell)?.fillRgb ?? null,
          ),
        });
        const relationId = id("pain_point_relation", `${curated.sheetKey}|${column}`);
        if (curated.target.kind === "journey") {
          painPointJourneyStages.push({ id: relationId, painPointId: painId, journeyStageId: entityId, displayOrder: order });
        } else if (curated.target.kind === "organizational_unit") {
          painPointOrganizationalUnits.push({ id: relationId, painPointId: painId, organizationalUnitId: entityId, displayOrder: order });
        } else if (curated.target.kind === "performance_dimension") {
          painPointPerformanceDimensions.push({ id: relationId, painPointId: painId, performanceDimensionId: entityId, displayOrder: order });
        } else {
          painPointCultureDimensions.push({ id: relationId, painPointId: painId, cultureDimensionId: entityId, displayOrder: order });
        }
        trace(
          binding,
          contentCell,
          sheetSpec.contentRow,
          column,
          "pain_point",
          painId,
          "raw_text",
          "pain_point_text",
          null,
        );
      }
      order += 1;
    }
  };

  for (const curated of projection.curatedEntities) projectCurated(curated);

  for (const evidence of projection.journeyEvidence) {
    const stageId = stageIdByIndex.get(evidence.journeySheetKey)?.[evidence.stageIndex];
    if (!stageId) {
      issues.add(
        "blocker",
        "PROJECTION_JOURNEY_EVIDENCE_STAGE_MISSING",
        `La evidencia declarada apunta a la etapa ${evidence.stageIndex} de '${evidence.journeySheetKey}', ` +
          "que no existe.",
      );
      continue;
    }
    const metricDefinitionId = evidence.metricKey ? id("metric_definition", evidence.metricKey) : null;
    const performanceDimensionId = evidence.performanceDimensionKey
      ? performanceDimensionIdByKey.get(evidence.performanceDimensionKey) ?? null
      : null;
    if ((metricDefinitionId === null) === (performanceDimensionId === null)) {
      issues.add(
        "blocker",
        "PROJECTION_JOURNEY_EVIDENCE_AMBIGUOUS",
        "Un vínculo de evidencia del journey debe apuntar a exactamente una fuente.",
      );
      continue;
    }
    journeyStageEvidenceLinks.push({
      id: id("journey_stage_evidence_link", `${stageId}|${evidence.role}|${evidence.metricKey ?? evidence.performanceDimensionKey}`),
      journeyStageId: stageId,
      metricDefinitionId,
      surveyItemId: null,
      performanceDimensionId,
      role: evidence.role,
      displayOrder: 0,
    });
  }

  // -------------------------------------------------------------------------
  // Assemble, verify the plan against itself, and fingerprint it
  // -------------------------------------------------------------------------
  const plan: CanonicalCommitPlan = {
    specId: spec.id,
    mappingVersion: spec.mappingVersion,
    tenantId: input.tenantId,
    studyId: input.studyId,
    packageIdempotencyKey,
    planFingerprint: "",
    expectedCounts: {} as CanonicalCommitPlan["expectedCounts"],
    persons,
    personIdentifiers,
    participants,
    membershipEpisodes,
    attributeDefinitions,
    participantAttributeValues,
    responseScales,
    responseOptions,
    surveyInstruments,
    studyDomains,
    surveyItems,
    surveySessions,
    surveyResponses,
    visualAnnotations: annotations,
    performanceDimensions,
    performanceObservations,
    bandSchemes,
    bandRules,
    retentionPeriods,
    metricDefinitions,
    metricItemLinks,
    journeyModels,
    journeyStages,
    journeyStageEvidenceLinks,
    organizationalUnits,
    cultureDimensions,
    painPoints,
    painPointJourneyStages,
    painPointOrganizationalUnits,
    painPointPerformanceDimensions,
    painPointCultureDimensions,
    sourceLineage: lineage,
  };

  verifyPlanIntegrity(plan, issues);

  const counts = {} as CanonicalCommitPlan["expectedCounts"];
  for (const family of PLAN_FAMILIES) counts[family] = plan[family].length;
  plan.expectedCounts = counts;
  plan.planFingerprint = commitPlanFingerprint(plan);

  if (issues.blockers > 0) return { ok: false, plan: null, issues: issues.list };
  return { ok: true, plan, issues: issues.list };
}

type TypedAttribute = {
  field: string;
  valueText: string | null;
  valueNumeric: number | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
};

const EMPTY_TYPED: TypedAttribute = {
  field: "status",
  valueText: null,
  valueNumeric: null,
  valueDate: null,
  valueBoolean: null,
};

/**
 * The typed value for one attribute cell, or null when the source contradicts
 * the declared type.
 *
 * Returning null is a REFUSAL, not an absence: the caller turns it into a
 * blocker with the coordinate. Silently downgrading a number to text would
 * make a study's own schema depend on which rows happened to be filled in.
 */
function typedAttributeValue(
  classified: ClassifiedValue,
  dataType: PlanAttributeDefinition["dataType"],
): TypedAttribute | null {
  if (classified.status !== "answered") return EMPTY_TYPED;
  const raw = classified.raw;
  if (dataType === "number") {
    return classified.numeric === null
      ? null
      : { field: "value_numeric", valueText: null, valueNumeric: classified.numeric, valueDate: null, valueBoolean: null };
  }
  if (dataType === "date") {
    const iso = isoDatePart(raw);
    return iso === null
      ? null
      : { field: "value_date", valueText: null, valueNumeric: null, valueDate: iso, valueBoolean: null };
  }
  if (dataType === "boolean") {
    const token = normalizeToken(raw);
    if (token === "true" || token === "si" || token === "verdadero") {
      return { field: "value_boolean", valueText: null, valueNumeric: null, valueDate: null, valueBoolean: true };
    }
    if (token === "false" || token === "no" || token === "falso") {
      return { field: "value_boolean", valueText: null, valueNumeric: null, valueDate: null, valueBoolean: false };
    }
    return null;
  }
  return { field: "value_text", valueText: raw, valueNumeric: null, valueDate: null, valueBoolean: null };
}

function addPerformanceMetric(
  metricDefinitions: PlanMetricDefinition[],
  metricItemLinks: PlanMetricItemLink[],
  id: (table: string, natural: string) => string,
  calculationVersion: string,
  performance: { metricKey: string; dimensionLabel: string; metricPrecision: number; bandSchemeKey: string },
  dimensionId: string,
): void {
  const metricId = id("metric_definition", performance.metricKey);
  metricDefinitions.push({
    id: metricId,
    key: performance.metricKey,
    label: performance.dimensionLabel,
    family: "mean",
    unit: "score",
    precision: performance.metricPrecision,
    calculationVersion,
    bandSchemeId: id("band_scheme", performance.bandSchemeKey),
    isPublishable: false,
  });
  metricItemLinks.push({
    id: id("metric_item_link", `${performance.metricKey}|dimension|${dimensionId}`),
    metricDefinitionId: metricId,
    surveyItemId: null,
    studyDomainId: null,
    performanceDimensionId: dimensionId,
    role: "dimension",
    displayOrder: 0,
  });
}

/**
 * The plan must be internally consistent BEFORE it is offered to the database.
 *
 * Every check here has a database constraint behind it. Catching a violation
 * in the projector turns an opaque `DATABASE_CONSTRAINT` — whose message would
 * quote respondent data and therefore cannot be shown — into a named issue
 * with a sheet and a coordinate.
 */
function verifyPlanIntegrity(plan: CanonicalCommitPlan, issues: Issues): void {
  const duplicate = (label: string, ids: string[]): void => {
    const seen = new Set<string>();
    for (const value of ids) {
      if (seen.has(value)) {
        issues.add(
          "blocker",
          "PROJECTION_DUPLICATE_RECORD_ID",
          `El plan genera dos veces el mismo identificador en '${label}'. Un identificador derivado ` +
            "duplicado significaría dos filas con la misma clave.",
          { actual: label },
        );
        return;
      }
      seen.add(value);
    }
  };

  for (const family of PLAN_FAMILIES) {
    if (family === "sourceLineage") continue;
    const rows = plan[family] as Array<{ id: string }>;
    duplicate(family, rows.map((row) => row.id));
  }

  const uniqueKey = (label: string, keys: string[]): void => {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) {
        issues.add(
          "blocker",
          "PROJECTION_DUPLICATE_NATURAL_KEY",
          `El plan repite la clave natural de '${label}'. La base de datos rechazaría la segunda fila y ` +
            "el paquete entero se revertiría.",
          { actual: label },
        );
        return;
      }
      seen.add(key);
    }
  };

  uniqueKey("attribute_definition.key", plan.attributeDefinitions.map((row) => row.key));
  uniqueKey("response_scale.key", plan.responseScales.map((row) => row.key));
  uniqueKey("survey_instrument.key", plan.surveyInstruments.map((row) => row.key));
  uniqueKey("metric_definition.key", plan.metricDefinitions.map((row) => row.key));
  uniqueKey("band_scheme.key", plan.bandSchemes.map((row) => row.key));
  uniqueKey("performance_dimension.key", plan.performanceDimensions.map((row) => row.key));
  uniqueKey("organizational_unit.key", plan.organizationalUnits.map((row) => row.key));
  uniqueKey("journey_model.key", plan.journeyModels.map((row) => row.key));
  uniqueKey(
    "culture_dimension.audience+key",
    plan.cultureDimensions.map((row) => `${row.audience}|${row.key}`),
  );
  uniqueKey(
    "study_participant.study+person+cohort",
    plan.participants.map((row) => `${row.personKey}|${row.cohortKey}`),
  );
  uniqueKey(
    "survey_session.instrument+participant+occurrence",
    plan.surveySessions.map((row) => `${row.surveyInstrumentId}|${row.participantId}|${row.occurrenceKey}`),
  );
  uniqueKey(
    "survey_response.session+item",
    plan.surveyResponses.map((row) => `${row.surveySessionId}|${row.surveyItemId}`),
  );
  uniqueKey(
    "participant_attribute_value.participant+definition",
    plan.participantAttributeValues.map((row) => `${row.participantId}|${row.attributeDefinitionId}`),
  );
  uniqueKey(
    "performance_observation.participant+dimension+period",
    plan.performanceObservations.map(
      (row) => `${row.participantId}|${row.performanceDimensionId}|${row.periodStart}`,
    ),
  );
  uniqueKey(
    "visual_annotation.asset+sheet+range+role",
    plan.visualAnnotations.map((row) => `${row.sourceAssetRole}|${row.sheetName}|${row.cellOrRange}|${row.role}`),
  );
  uniqueKey(
    "source_lineage.unique",
    plan.sourceLineage.map(
      (row) =>
        `${row.sourceAssetRole}|${row.sheetName}|${row.cellOrRange}|${row.targetTable}|` +
        `${row.targetRecordId}|${row.targetField}`,
    ),
  );

  // A response must carry EXACTLY one value when it is answered, and none at
  // all when it is not. This is the constraint that stops an absence from
  // arriving as a zero.
  for (const response of plan.surveyResponses) {
    const filled = [
      response.responseOptionId,
      response.valueNumeric,
      response.valueText,
      response.valueDate,
      response.valueBoolean,
    ].filter((value) => value !== null).length;
    const expected = response.status === "answered" ? 1 : 0;
    if (filled !== expected) {
      issues.add(
        "blocker",
        "PROJECTION_RESPONSE_SHAPE",
        `Una respuesta con estado '${response.status}' lleva ${filled} valor(es); la base de datos exige ` +
          `${expected}.`,
        { actual: response.status },
      );
      break;
    }
  }

  for (const value of plan.participantAttributeValues) {
    const filled = [value.valueText, value.valueNumeric, value.valueDate, value.valueBoolean].filter(
      (candidate) => candidate !== null,
    ).length;
    const expected = value.status === "answered" ? 1 : 0;
    if (filled !== expected) {
      issues.add(
        "blocker",
        "PROJECTION_ATTRIBUTE_SHAPE",
        `Un atributo con estado '${value.status}' lleva ${filled} valor(es); la base de datos exige ${expected}.`,
        { actual: value.status },
      );
      break;
    }
  }

  // A session that did not happen must carry no responses at all.
  const nonParticipating = new Set(
    plan.surveySessions.filter((session) => session.status === "not_participated").map((session) => session.id),
  );
  const leaked = plan.surveyResponses.filter((response) => nonParticipating.has(response.surveySessionId));
  if (leaked.length > 0) {
    issues.add(
      "blocker",
      "PROJECTION_NON_PARTICIPATION_HAS_ANSWERS",
      `${leaked.length} respuesta(s) cuelgan de una sesión marcada como no participación. La no ` +
        "participación nunca es una respuesta.",
      { actual: leaked.length },
    );
  }
}
