import type {
  AdaptResult,
  CanonicalRespondent,
  IngestError,
  ParsedFile,
} from "../canonical";
import { qualSchema, quantSchema, segmentsSchema } from "../canonical";
import {
  importMappingSchema,
  normalizeHeader,
  validateUniqueHeaders,
  type ColumnTarget,
  type ImportMapping,
} from "../mapping";

const NUMERIC = /^-?\d+(\.\d+)?$/;

function normalizedValue(value: string): string {
  return value.trim().toLocaleLowerCase("es-MX");
}

function configError(message: string): AdaptResult {
  return { ok: false, errors: [{ row: null, column: null, message }] };
}

function requiredError(row: number, column: string): IngestError {
  return { row, column, message: `La columna '${column}' es obligatoria en esta fila.` };
}

function mappedValue(
  raw: string,
  target: Extract<ColumnTarget, { kind: "quantitative" }>,
  tables: Map<string, Map<string, number>>,
): number | string {
  if (target.recodingTableId) {
    const table = tables.get(target.recodingTableId);
    if (!table) return `No existe la tabla de recodificación '${target.recodingTableId}'.`;
    const value = table.get(normalizedValue(raw));
    return value ?? `El valor '${raw}' no existe en la tabla de recodificación '${target.recodingTableId}'.`;
  }
  return NUMERIC.test(raw) ? Number(raw) : `Se esperaba un número pero se recibió '${raw}'.`;
}

/**
 * Maps arbitrary survey headers to the canonical model. No source prefix is
 * required: the operator-provided mapping is the contract.
 */
export function adaptMappedSurvey(file: ParsedFile, rawMapping: unknown): AdaptResult {
  const parsedMapping = importMappingSchema.safeParse(rawMapping);
  if (!parsedMapping.success) {
    return configError(`Configuración de mapeo inválida: ${parsedMapping.error.issues[0]?.message}`);
  }
  const mapping: ImportMapping = parsedMapping.data;
  if (file.headers.length === 0 || file.headers.some((header) => normalizeHeader(header) === "")) {
    return configError("El archivo debe tener encabezados no vacíos.");
  }
  const duplicateHeaders = validateUniqueHeaders(file.headers);
  if (duplicateHeaders.length > 0) {
    return configError(`Encabezados duplicados: ${duplicateHeaders.join(", ")}.`);
  }
  if (file.rows.length === 0) return configError("El archivo no contiene filas de datos.");

  const actualHeaders = new Map(file.headers.map((header) => [normalizeHeader(header), header]));
  const mappedSources = new Set<string>();
  const resolved = [] as { sourceColumn: string; target: ColumnTarget }[];
  const configErrors: string[] = [];

  for (const column of mapping.columns) {
    const normalized = normalizeHeader(column.sourceColumn);
    if (mappedSources.has(normalized)) {
      configErrors.push(`La columna '${column.sourceColumn}' está mapeada más de una vez.`);
      continue;
    }
    mappedSources.add(normalized);
    const actual = actualHeaders.get(normalized);
    if (!actual) {
      configErrors.push(`El archivo no contiene la columna mapeada '${column.sourceColumn}'.`);
      continue;
    }
    resolved.push({ sourceColumn: actual, target: column.target });
  }
  if (!resolved.some((column) => column.target.kind !== "ignore")) {
    configErrors.push("El mapeo debe incluir al menos una columna que no esté ignorada.");
  }

  const tables = new Map<string, Map<string, number>>();
  for (const table of mapping.recodingTables) {
    if (tables.has(table.id)) {
      configErrors.push(`La tabla de recodificación '${table.id}' está repetida.`);
      continue;
    }
    const values = new Map<string, number>();
    for (const [label, value] of Object.entries(table.values)) {
      const normalized = normalizedValue(label);
      if (values.has(normalized)) {
        configErrors.push(`La tabla '${table.id}' contiene etiquetas equivalentes repetidas: '${label}'.`);
      }
      values.set(normalized, value);
    }
    tables.set(table.id, values);
  }
  for (const column of resolved) {
    if (
      column.target.kind === "quantitative" &&
      column.target.recodingTableId &&
      !tables.has(column.target.recodingTableId)
    ) {
      configErrors.push(`No existe la tabla de recodificación '${column.target.recodingTableId}'.`);
    }
  }
  if (configErrors.length > 0) {
    return { ok: false, errors: configErrors.map((message) => ({ row: null, column: null, message })) };
  }

  const errors: IngestError[] = [];
  const respondents: CanonicalRespondent[] = [];

  file.rows.forEach((row, index) => {
    const lineNo = index + 2;
    const respondent: CanonicalRespondent = {
      id: crypto.randomUUID(),
      sourceRow: lineNo,
      segments: {},
      quant: [],
      qual: [],
    };

    for (const column of resolved) {
      const raw = String(row[column.sourceColumn] ?? "").trim();
      const target = column.target;
      if (target.kind === "ignore") continue;
      if (raw === "") {
        if (target.required) errors.push(requiredError(lineNo, column.sourceColumn));
        continue;
      }

      if (target.kind === "segment") {
        respondent.segments[target.key] = raw;
      } else if (target.kind === "qualitative") {
        respondent.qual.push({
          source: target.source ?? "encuesta",
          category: null,
          theme: target.theme,
          quote: raw,
        });
      } else {
        const value = mappedValue(raw, target, tables);
        if (typeof value === "string") {
          errors.push({ row: lineNo, column: column.sourceColumn, message: value });
          continue;
        }
        if (target.min !== undefined && value < target.min) {
          errors.push({ row: lineNo, column: column.sourceColumn, message: `El valor ${value} es menor que el mínimo ${target.min}.` });
          continue;
        }
        if (target.max !== undefined && value > target.max) {
          errors.push({ row: lineNo, column: column.sourceColumn, message: `El valor ${value} supera el máximo ${target.max}.` });
          continue;
        }
        respondent.quant.push({ metric_key: target.metricKey, value });
      }
    }

    if (
      Object.keys(respondent.segments).length > 0 ||
      respondent.quant.length > 0 ||
      respondent.qual.length > 0
    ) {
      respondents.push(respondent);
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  if (respondents.length === 0) return configError("El archivo no contiene respuestas utilizables con este mapeo.");

  let quantCount = 0;
  let qualCount = 0;
  for (const respondent of respondents) {
    if (!segmentsSchema.safeParse(respondent.segments).success) {
      return configError("El adaptador produjo segmentos inválidos.");
    }
    for (const quant of respondent.quant) {
      if (!quantSchema.safeParse(quant).success) return configError(`El adaptador produjo la métrica inválida '${quant.metric_key}'.`);
      quantCount++;
    }
    for (const qual of respondent.qual) {
      if (!qualSchema.safeParse(qual).success) return configError(`El adaptador produjo la observación inválida '${qual.theme}'.`);
      qualCount++;
    }
  }

  return {
    ok: true,
    respondents,
    summary: { respondents: respondents.length, quant: quantCount, qual: qualCount },
  };
}
