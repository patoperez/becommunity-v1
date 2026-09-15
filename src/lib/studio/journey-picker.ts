/**
 * Choosing the result behind a moment of the recorrido (P8.2, contract C1).
 *
 * WHAT DOES NOT CHANGE. The stored value is still `journey_definition` exactly
 * as `journeyDefinitionSchema` defines it — `{ stages: [{ id, label, metric,
 * description? }] }` — with the same canonical `metric` key, validated by the
 * same schema in the same Server Action and computed by the same
 * `computeStageMetric`. Nothing here is a calculation and nothing here is an
 * authorization boundary.
 *
 * WHAT CHANGES. Nobody types `sat_servicio` from memory any more. The metric is
 * chosen from the results this study genuinely produced, each shown by what it
 * measures and what it says today, so the consequence of the choice is visible
 * at the moment of choosing rather than after publishing.
 *
 * TWO RULES THAT MATTER MORE THAN THE INTERFACE:
 *
 *  1. A STAGE ID NEVER MOVES. It is generated once, from the first label, and
 *     then kept for the life of the stage. Regenerating it on every rename
 *     would silently orphan every qualitative observation confirmed against
 *     that stage, because `qual_observation.confirmed_stage_key` stores it.
 *
 *  2. A STORED METRIC THE DATA NO LONGER OFFERS IS PRESERVED, VISIBLY. It is
 *     kept selected and marked as historical rather than dropped, because
 *     dropping it would quietly repoint a published moment at a different
 *     number — or at none.
 */

import { computeStageMetric, metricKeys, buildTable, type LongRow } from "@/lib/calc/engine";
import { formatPercent, formatScore } from "@/lib/calc/format";
import type { JourneyStage } from "@/lib/calc/journey";
import { resultLanguage } from "@/lib/language/results";

/** The scale a result lives on, said in words rather than as a unit token. */
const UNIT_NOTE: Record<"nps" | "percent" | "score", string> = {
  nps: "va de -100 a 100",
  percent: "es un porcentaje",
  score: "es un promedio de las calificaciones del propio instrumento",
};

export type JourneyMetricOption = {
  /** The canonical metric key. Stored, never typed, never displayed alone. */
  key: string;
  /** What this result is called on screen. */
  name: string;
  /** The question it answers. */
  question: string;
  unitNote: string;
  /** How many answers this study currently carries for it. */
  people: number;
  /** What it says today, already formatted — or null when it has no data. */
  today: string | null;
  /**
   * False when the study's current data no longer produces this result and it
   * is only present because a stage still points at it.
   */
  available: boolean;
};

/**
 * Every result this study can put on a moment, in a stable order.
 *
 * Derived from the study's own rows, so a consultant is never offered a metric
 * from another client or another wave.
 */
export function journeyMetricOptions(rows: LongRow[]): JourneyMetricOption[] {
  if (rows.length === 0) return [];
  const keys = metricKeys(buildTable(rows)).slice().sort((a, b) => a.localeCompare(b, "es-MX"));
  return keys.map((key) => describeMetric(key, rows, true));
}

/**
 * The vocabulary key `resultLanguage` expects, chosen by the SAME branching
 * `computeStageMetric` uses. Reading a stage as an average when the engine
 * treats it as recommendation would describe a number the product does not
 * compute.
 */
function languageKeyFor(metricKey: string): string {
  if (metricKey.startsWith("nps")) return "nps";
  if (metricKey.startsWith("sat") || metricKey.startsWith("csat")) return `csat:${metricKey}`;
  return `average:${metricKey}`;
}

function describeMetric(key: string, rows: LongRow[], available: boolean): JourneyMetricOption {
  const language = resultLanguage(languageKeyFor(key), key);
  if (!available || rows.length === 0) {
    return {
      key,
      name: language.name,
      question: language.question,
      unitNote: UNIT_NOTE.score,
      people: 0,
      today: null,
      available,
    };
  }
  const metric = computeStageMetric(rows, key);
  return {
    key,
    name: language.name,
    question: language.question,
    unitNote: UNIT_NOTE[metric.unit],
    people: metric.n,
    today: metric.value == null
      ? null
      : metric.unit === "percent"
        ? `${formatPercent(metric.value)} %`
        : formatScore(metric.value),
    available,
  };
}

/**
 * The options a single stage may show: everything the study offers, plus the
 * stage's own stored metric when the data no longer produces it.
 */
export function optionsForStage(
  options: JourneyMetricOption[],
  storedMetric: string,
): JourneyMetricOption[] {
  const key = storedMetric.trim();
  if (!key || options.some((option) => option.key === key)) return options;
  return [...options, describeMetric(key, [], false)];
}

/** Every stage whose stored metric the study's data no longer produces. */
export function historicalStageMetrics(
  stages: JourneyStage[],
  options: JourneyMetricOption[],
): { stageId: string; label: string; metric: string }[] {
  const offered = new Set(options.map((option) => option.key));
  return stages
    .filter((stage) => stage.metric.trim() !== "" && !offered.has(stage.metric))
    .map((stage) => ({ stageId: stage.id, label: stage.label, metric: stage.metric }));
}

/**
 * The consequence of the current choice, stated before it is saved.
 *
 * "No data" is said as plainly as a value, because a moment with no number is a
 * data-collection problem the consultant has to solve before publishing — the
 * one thing the information architecture asks this screen to make obvious.
 */
export function stageConsequence(option: JourneyMetricOption | null): string {
  if (!option) return "Elige qué resultado mide este momento.";
  if (!option.available) {
    return `“${option.name}” se guardó antes y los datos actuales ya no lo producen. Se conserva tal cual: este momento aparecerá sin número hasta que elijas otro resultado.`;
  }
  if (option.today == null || option.people === 0) {
    return `Este momento mostrará “${option.name}”, que hoy no tiene respuestas en este estudio. Aparecerá sin número.`;
  }
  return `Este momento mostrará “${option.name}”. Hoy dice ${option.today} sobre ${option.people} ${
    option.people === 1 ? "respuesta" : "respuestas"
  }; ${option.unitNote}.`;
}

// ---------------------------------------------------------------------------
// Stage identifiers — generated once, then never moved
// ---------------------------------------------------------------------------

/**
 * `journeyDefinitionSchema` accepts `^[a-z][a-z0-9_-]*$` up to 64 characters.
 * A label that cannot become one falls back to a positional id rather than
 * refusing the stage: the operator named a moment, and the identifier is a
 * detail they were never asked about.
 */
export function stageIdFromLabel(label: string, taken: Iterable<string>, position: number): string {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56)
    .replace(/_+$/g, "");
  const base = /^[a-z]/.test(slug) ? slug : `momento_${position}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `momento_${position}_${Date.now().toString(36).slice(-4)}`;
}

/** What the Server Action's `stage_*` field groups must carry, in order. */
export type StageDraft = { id: string; label: string; metric: string; description: string };

export function toStageDrafts(stages: JourneyStage[]): StageDraft[] {
  return stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    metric: stage.metric,
    description: stage.description ?? "",
  }));
}

/** Whether the draft set could be saved at all, and why not when it could not. */
export function stageDraftRefusal(drafts: StageDraft[]): string | null {
  for (const draft of drafts) {
    if (draft.label.trim() === "") return "Cada momento necesita un nombre.";
    if (draft.metric.trim() === "") {
      return `Elige qué resultado mide “${draft.label.trim()}”.`;
    }
  }
  const ids = drafts.map((draft) => draft.id);
  if (new Set(ids).size !== ids.length) {
    return "Dos momentos quedaron con el mismo identificador interno. Quita uno y vuelve a añadirlo.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// The editor's list identity — deliberately not the stored identifier
// ---------------------------------------------------------------------------

/**
 * A stage as the editor holds it while somebody is still writing it.
 *
 * `uid` exists for exactly one reason: React needs a key for the row, and every
 * other value on the row is something the operator changes mid-keystroke. The
 * editor used to key the row on the stored `id`, which a stage that has never
 * been saved still derives from its own name — so the key changed on every
 * character typed, React replaced the whole row, and the browser discarded the
 * focused `<input>` along with the caret. Naming a moment cost one click per
 * letter.
 *
 * `uid` is assigned once, when the row appears, and never reflects anything
 * typed into it. It is client-side identity only: never submitted, never
 * stored, never sent anywhere. The stored `id` keeps its own rules below.
 */
export type StageEditorDraft = StageDraft & { uid: string; isNew: boolean };

/** Only what a person can type. `id`, `uid` and `isNew` are not editable. */
export type StageDraftPatch = Partial<Pick<StageDraft, "label" | "metric" | "description">>;

/**
 * The rows a saved journey starts as.
 *
 * The uid is positional and therefore deterministic: the server's HTML and the
 * client's first render must agree, so nothing random may appear here.
 */
export function toStageEditorDrafts(stages: JourneyStage[]): StageEditorDraft[] {
  return toStageDrafts(stages).map((draft, index) => ({
    ...draft,
    uid: `saved:${index}`,
    isNew: false,
  }));
}

/**
 * A new, empty moment appended to the list.
 *
 * `sequence` is a counter the editor never reuses, so removing a row and adding
 * another cannot resurrect a uid that React has already seen.
 */
export function addStageDraft(drafts: StageEditorDraft[], sequence: number): StageEditorDraft[] {
  const taken = drafts.map((draft) => draft.id);
  return [
    ...drafts,
    {
      uid: `added:${sequence}`,
      id: stageIdFromLabel("", taken, drafts.length + 1),
      label: "",
      metric: "",
      description: "",
      isNew: true,
    },
  ];
}

/**
 * One row edited, addressed by its stable uid rather than by position.
 *
 * A stage that has already been saved keeps the identifier it was saved with,
 * whatever its name becomes: `qual_observation.confirmed_stage_key` points at
 * that identifier, so moving it would detach every comment already filed
 * against that moment.
 */
export function editStageDraft(
  drafts: StageEditorDraft[],
  uid: string,
  patch: StageDraftPatch,
): StageEditorDraft[] {
  return drafts.map((draft, index) => {
    if (draft.uid !== uid) return draft;
    // The three typed fields are applied by name, never spread: a patch can
    // not reach `id`, `uid` or `isNew` whatever it happens to carry.
    const next: StageEditorDraft = {
      ...draft,
      label: patch.label ?? draft.label,
      metric: patch.metric ?? draft.metric,
      description: patch.description ?? draft.description,
    };
    if (next.isNew && patch.label !== undefined) {
      const taken = drafts.filter((other) => other.uid !== uid).map((other) => other.id);
      next.id = stageIdFromLabel(next.label, taken, index + 1);
    }
    return next;
  });
}

/** One row removed, and only that one. */
export function removeStageDraft(drafts: StageEditorDraft[], uid: string): StageEditorDraft[] {
  return drafts.filter((draft) => draft.uid !== uid);
}
