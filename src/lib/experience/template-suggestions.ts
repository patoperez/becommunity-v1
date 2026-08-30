/**
 * TEMPLATE DATA — what a freshly adapted filter panel OPENS WITH, and nothing
 * more.
 *
 * WHY THIS IS A SEPARATE FILE. `docs/EXPERIENCE_COMPOSER.md` §1 and the
 * project's standing rules are explicit: the product must not hardcode any one
 * client's behaviour, and a particular client's configuration becomes reusable
 * template DATA rather than a branch in the code. The composer's gate enforces
 * that by refusing to let a client's name appear in any generic module —
 * `adapter.ts`, `registry.ts`, `validate.ts` and the rest. This file is the
 * other side of that rule: the place where a recommendation IS allowed to be
 * specific, because everything here is data that a person may change and that
 * restricts nothing.
 *
 * WHAT A SUGGESTION CAN AND CANNOT DO.
 *
 *   It CAN decide which characteristics a newly adapted panel starts with, and
 *   the order they appear in.
 *
 *   It CANNOT decide what is filterable. Every filter-eligible characteristic
 *   in the study's registry is declared as a filter and offerable in the
 *   builder whether or not it is named here, and a person can add, remove and
 *   reorder any of them. Nothing downstream reads this file.
 *
 * MATCHED ON LABELS, NEVER ON KEYS. A suggestion that named canonical metric
 * or column keys would be the hardcoded client behaviour the product forbids,
 * and it would silently stop matching the moment a study imported the same
 * idea under a different column name. These are fragments of the words a
 * consultant would read on screen, folded for accents and case.
 *
 * A STUDY THAT MATCHES NONE OF THEM IS NOT A STUDY WITHOUT FILTERS. The
 * adapter falls back to the characteristics the study does have, in registry
 * order, which is why a school study or a hospital study gets a working panel
 * from a list written with a business network in mind.
 */

/**
 * Journey-oriented reading: who the person is and where they are in their
 * membership. Recommended for the panel that governs the whole experience.
 */
export const JOURNEY_FILTER_SUGGESTIONS = [
  "antigüedad",
  "esfera",
  "estado de membresía",
  "generación",
  "giro",
  "tiempo en bni",
  "tipo de empresa",
  "desempeño",
  "semáforo",
  "cultura",
] as const;

/**
 * Findings-oriented reading: risk, renewal and return. Recommended for a panel
 * scoped to the page where findings are read.
 *
 * AGE RANGE IS DELIBERATELY ABSENT FROM BOTH LISTS. It remains available like
 * every other characteristic and can be added by hand in one click; it is not
 * a default, and it is not restored as one.
 */
export const FINDINGS_FILTER_SUGGESTIONS = [
  "no renovación",
  "riesgo",
  "probabilidad de renovación",
  "roi",
  "tiempo en bni",
  "desempeño",
  "semáforo",
  "generación",
] as const;
