export const DEFAULT_MINIMUM_SAMPLE_SIZE = 5;
export const DEFAULT_CAUTION_SAMPLE_SIZE = 30;

export type SampleVisibility = "no-data" | "suppressed" | "caution" | "standard";

export type SampleSizePolicy = {
  minimum: number;
  cautionBelow: number;
};

export const DEFAULT_SAMPLE_SIZE_POLICY: SampleSizePolicy = {
  minimum: DEFAULT_MINIMUM_SAMPLE_SIZE,
  cautionBelow: DEFAULT_CAUTION_SAMPLE_SIZE,
};

function assertThreshold(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

/**
 * Classifies whether an aggregate may be displayed. This is a presentation and
 * disclosure-control contract; it never changes the metric's formula.
 */
export function sampleVisibility(
  sampleSize: number,
  policy: SampleSizePolicy = DEFAULT_SAMPLE_SIZE_POLICY,
): SampleVisibility {
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 0) {
    throw new RangeError("sampleSize must be a non-negative safe integer");
  }
  assertThreshold("minimum", policy.minimum);
  assertThreshold("cautionBelow", policy.cautionBelow);
  if (policy.cautionBelow < policy.minimum) {
    throw new RangeError("cautionBelow cannot be lower than minimum");
  }

  if (sampleSize === 0) return "no-data";
  if (sampleSize < policy.minimum) return "suppressed";
  if (sampleSize < policy.cautionBelow) return "caution";
  return "standard";
}
