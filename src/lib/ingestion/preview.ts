import type { AdaptResult, ImportPreviewRow, ParsedFile } from "./canonical";
import { adaptMappedSurvey } from "./adapters/mapped-survey";
import { sourceSignature } from "./mapping";

export type ImportPreview = {
  signature: string;
  sourceRows: number;
  sample: ImportPreviewRow[];
  result: AdaptResult;
};

/** Build a non-persistent preview. No database client is accepted by design. */
export async function previewMappedImport(
  file: ParsedFile,
  mapping: unknown,
  sampleSize = 5,
): Promise<ImportPreview> {
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 1 || sampleSize > 25) {
    throw new RangeError("sampleSize must be an integer from 1 to 25");
  }
  const signature = await sourceSignature(file.headers);
  const result = adaptMappedSurvey(file, mapping);
  const sample = result.ok
    ? result.respondents.slice(0, sampleSize).map((respondent) => ({
        sourceRow: respondent.sourceRow ?? 2,
        privateFields: Object.keys(respondent.privateMetadata),
        segments: respondent.segments,
        quant: respondent.quant,
        qual: respondent.qual.map(({ source, theme, quote }) => ({ source, theme, quote })),
      }))
    : [];
  return { signature, sourceRows: file.rows.length, sample, result };
}
