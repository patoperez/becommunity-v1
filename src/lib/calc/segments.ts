/**
 * One category, one name (P9).
 *
 * THE DEFECT. A study's characteristics are free text carried in
 * `respondent.segments`, and the same category reaches the database written two
 * ways when it is collected twice. The Cuicuilco study holds
 * "Legal y Contable" for the members who stayed and "Legal y contable" for the
 * members who left — one letter of case, from two questionnaires. Nothing
 * merges them, so a filter offers both, a chart draws two bars where the
 * chapter has one line of business, and a count of 4 is shown as 3 and 1.
 *
 * TWO RULES, AND THE DIFFERENCE BETWEEN THEM MATTERS.
 *
 *   THE FOLD is lexical and always on. Values that differ only by letter case
 *   or by surrounding/repeated whitespace are the same value. This needs no
 *   configuration and no judgement: nobody writing a questionnaire means
 *   "Legal y Contable" and "Legal y contable" as two answers. Accents,
 *   punctuation and wording are deliberately NOT folded — merging different
 *   WORDS is never lexical, and is not something code should decide.
 *
 *   AN ALIAS is editorial and configured per study. Two questionnaires can word
 *   the same closed answer differently — Cuicuilco's active members chose
 *   "No he recuperado nada" and its former members "No recuperé nada" for the
 *   same zero-return band. Only a person who has read both instruments can say
 *   they are one answer, so that statement lives in data
 *   (`segment_dimension.config.aliases`) and is never inferred here.
 *
 * THE RAW VALUE IS NEVER REWRITTEN. Canonicalisation happens on the way OUT of
 * the database, so `respondent.segments` keeps exactly what was imported and
 * the reconciliation against the source workbooks stays exact. Change the
 * configuration and the next read simply groups differently.
 */

/** A study's configured aliases: segment key -> folded alias -> canonical label. */
export type SegmentAliases = Record<string, Record<string, string>>;

/**
 * The lexical fold. Two values with the same fold are the same category.
 *
 * `toLowerCase` without a locale is deliberate: it is deterministic on every
 * runtime, which a locale-aware fold is not, and these labels are compared
 * against each other rather than sorted for a reader.
 */
export function foldSegmentValue(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Build the alias lookup from stored `segment_dimension.config` rows. */
export function parseSegmentAliases(
  dimensions: readonly { key: unknown; config: unknown }[],
): SegmentAliases {
  const aliases: SegmentAliases = {};
  for (const dimension of dimensions) {
    const key = typeof dimension.key === "string" ? dimension.key.trim() : "";
    if (!key) continue;
    const config = dimension.config;
    if (config === null || typeof config !== "object" || Array.isArray(config)) continue;
    const raw = (config as Record<string, unknown>).aliases;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;

    const forKey: Record<string, string> = {};
    for (const [canonical, variants] of Object.entries(raw as Record<string, unknown>)) {
      const label = canonical.trim();
      if (!label || !Array.isArray(variants)) continue;
      // The canonical label is its own alias, so a study can name a group with
      // a wording no respondent used.
      forKey[foldSegmentValue(label)] = label;
      for (const variant of variants) {
        if (typeof variant !== "string") continue;
        const folded = foldSegmentValue(variant);
        if (folded) forKey[folded] = label;
      }
    }
    if (Object.keys(forKey).length > 0) aliases[key] = forKey;
  }
  return aliases;
}

/**
 * Decide the display label for every raw value a study actually carries.
 *
 * Returns `segment key -> raw value -> label`. A key with nothing to merge maps
 * every value to itself, so a caller can apply the result unconditionally.
 */
export function canonicalSegmentLabels(
  respondents: readonly { segments: Record<string, unknown> | null }[],
  aliases: SegmentAliases = {},
): Map<string, Map<string, string>> {
  // key -> group -> raw value -> how many respondents carry it
  const groups = new Map<string, Map<string, Map<string, number>>>();

  for (const respondent of respondents) {
    for (const [key, value] of Object.entries(respondent.segments ?? {})) {
      if (value == null) continue;
      const raw = String(value);
      if (raw.trim() === "") continue;
      const folded = foldSegmentValue(raw);
      // An alias collapses several folds into one group; without one the fold
      // IS the group.
      const group = aliases[key]?.[folded] ?? folded;
      const byGroup = groups.get(key) ?? new Map<string, Map<string, number>>();
      const counts = byGroup.get(group) ?? new Map<string, number>();
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
      byGroup.set(group, counts);
      groups.set(key, byGroup);
    }
  }

  const labels = new Map<string, Map<string, string>>();
  for (const [key, byGroup] of groups) {
    const forKey = new Map<string, string>();
    const configured = aliases[key];
    for (const [group, counts] of byGroup) {
      // A configured group is named by its configuration. An unconfigured one
      // is named by the surface form most respondents actually used, with the
      // lexicographically smallest winning a tie so the label never depends on
      // the order the rows came back in.
      const label = configured && Object.values(configured).includes(group)
        ? group
        : [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))[0][0];
      for (const raw of counts.keys()) forKey.set(raw, label);
    }
    labels.set(key, forKey);
  }
  return labels;
}

/** Apply a label map to one respondent's segments. */
export function canonicalizeSegments(
  segments: Record<string, unknown> | null,
  labels: Map<string, Map<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(segments ?? {})) {
    if (value == null) continue;
    const raw = String(value);
    out[key] = labels.get(key)?.get(raw) ?? raw;
  }
  return out;
}

/**
 * The collisions a study still carries after the fold and its aliases: values a
 * person might read as one category and the product still counts as two.
 *
 * Reported to internal surfaces only. This is a QUESTION for a consultant, not
 * an answer: it looks past the fold at accents and punctuation, which the fold
 * deliberately leaves alone, so it can point at a pair without merging it.
 */
export function residualCollisions(
  respondents: readonly { segments: Record<string, unknown> | null }[],
  aliases: SegmentAliases = {},
): { key: string; values: string[] }[] {
  const labels = canonicalSegmentLabels(respondents, aliases);
  const found: { key: string; values: string[] }[] = [];
  for (const [key, forKey] of labels) {
    const byLoose = new Map<string, Set<string>>();
    for (const label of new Set(forKey.values())) {
      const loose = label
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      const set = byLoose.get(loose) ?? new Set<string>();
      set.add(label);
      byLoose.set(loose, set);
    }
    for (const set of byLoose.values()) {
      if (set.size > 1) found.push({ key, values: [...set].sort() });
    }
  }
  return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
