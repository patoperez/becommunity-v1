/**
 * THE PURE RESOLVER — definition + registry + results → render model.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT READS. IT NEVER COMPUTES.
 *
 * Every number this file puts into a render model was already computed,
 * rounded exactly once and formatted by the canonical layer. Search this file
 * for an arithmetic operator applied to a study quantity and you will not find
 * one: the only arithmetic present is over ARRAY POSITIONS and ORDERING, which
 * decide where a block goes, never what it says.
 *
 * That is not a stylistic preference. `docs/CANONICAL_RESULTS_MODEL.md` §6
 * requires every value to be rounded exactly once, at the precision its unit
 * declares. A second rounding — even at the same precision, even "harmless" —
 * is a value that can move, and a value that moves is a wrong number in front
 * of a client.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUR REFUSALS THAT ARE THE POINT OF THE LAYER.
 *
 *   1. A handle the registry does not know is `unknown_handle`. Never a blank
 *      card, never a silently dropped block.
 *   2. A chart variant the semantic does not support is
 *      `incompatible_chart_variant` — a ratio that may exceed 100 must not be
 *      accepted onto a 0..100 gauge.
 *   3. A filter connection to a dimension the result does not support is
 *      `unsupported_filter_dimension`; one an authority forbids is
 *      `forbidden_filter_cross`. Esfera × CRI is the standing example, and the
 *      approved dashboard's own risk panel offers it — a reference-dashboard
 *      deviation the canonical contract refuses.
 *   4. A route claiming a touchpoint its source group does not contain is
 *      `route_touchpoint_outside_group`. Five visible routes may repartition
 *      four source groups; they may not invent membership.
 *
 * AND ONE NON-REFUSAL. A missing value is not an error. `unavailable`,
 * `unresolved` and `configuration_required` are STATES the contract publishes,
 * and they arrive in the render model intact so a surface can say which one it
 * is. Turning a settled "a human supplies this" into a failure would report a
 * working design as a permanent defect.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  CanonicalStudyResults,
  MetricResult,
  ResultBand,
  ResultValue,
} from "../results/contract";
import {
  chartVariantIsCompatible,
  type ChartVariant,
  type MethodologyDisclosureLevel,
  type PresentationAvailability,
} from "./capabilities";
import type {
  DisplayFormat,
  PresentationBlock,
  PresentationDocument,
  SampleDisplayPolicy,
} from "./document";
import { DEFAULT_SAMPLE_POLICY } from "./document";
import {
  PresentationError,
  failure,
  issue,
  success,
  type PresentationIssue,
  type PresentationOutcome,
} from "./errors";
import { handleFacet, type PresentationHandle } from "./handles";
import type { RegistryEntry, ResponseContext } from "./catalog";
import type { CanonicalAddress, CanonicalPresentationRegistry } from "./registry";
import type {
  PresentationRenderModel,
  RenderAbsence,
  RenderBand,
  RenderBlock,
  RenderCategory,
  RenderMeasure,
  RenderMethodology,
  RenderPage,
  RenderPayload,
  RenderRoute,
  RenderRoutePoint,
  RenderSampleDisplay,
  RenderSeriesPoint,
  RenderValue,
} from "./render-model";

/**
 * Display names for the three recommendation bands.
 *
 * PRESENTATION VOCABULARY, not data. The canonical `NpsDistribution` carries
 * three counts under three field names and no labels, because naming them is a
 * display decision. They are declared here, once, rather than authored per
 * document — an author who could rename "Detractores" could rename it to
 * something the number does not mean.
 */
const NPS_BAND_LABELS = ["Promotores", "Pasivos", "Detractores"] as const;

/** Every valid chart variant, so an authored string can be checked before use. */
const CHART_VARIANTS: readonly string[] = [
  "kpi_value",
  "kpi_with_base",
  "gauge",
  "donut",
  "pie",
  "stacked_bar",
  "bar_vertical",
  "bar_horizontal",
  "line",
  "area",
  "table",
  "word_cloud",
  "term_ranking",
  "callout",
  "narrative",
  "journey_route_map",
  "touchpoint_matrix",
  "filter_control",
];

export type ResolveInput = {
  document: PresentationDocument;
  registry: CanonicalPresentationRegistry;
  results: CanonicalStudyResults;
};

/* -------------------------------------------------------------------------- */
/* reading, never computing                                                    */
/* -------------------------------------------------------------------------- */

function bandOf(band: ResultBand | null): RenderBand | null {
  // `schemeKey` is deliberately dropped: it names the study's band-scheme
  // configuration and is not client copy.
  return band === null ? null : { semanticColor: band.semanticColor, label: band.label };
}

function valueOf(value: ResultValue): RenderValue {
  // Every field is copied verbatim. `formatted` in particular is the canonical
  // formatter's own output; reformatting it here would be a second rounding.
  return {
    value: value.value,
    unit: value.unit,
    decimals: value.decimals,
    formatted: value.formatted,
    band: bandOf(value.band),
  };
}

function contextOf(base: { eligible: number; responded: number; valid: number }): ResponseContext {
  return { eligible: base.eligible, responded: base.responded, valid: base.valid };
}

/** Split a metric into "the number" and "why there isn't one". Exactly one is non-null. */
function readMetric(result: MetricResult): { value: RenderValue | null; absence: RenderAbsence | null } {
  if (result.status === "available") return { value: valueOf(result.value), absence: null };
  if (result.status === "unavailable") {
    return { value: null, absence: { state: "unavailable", reason: result.reason, detail: result.detail } };
  }
  return { value: null, absence: { state: "unresolved", reason: result.reason, detail: result.detail } };
}

/**
 * Apply the block's sample-display policy.
 *
 * The canonical layer suppresses NOTHING; this is the layer that owns the
 * display decision, and it acts only when a person authored one. `show_all`
 * — the default — returns the value untouched, which is why the default can
 * never quietly withhold anything.
 */
function policyWithholds(policy: SampleDisplayPolicy, base: ResponseContext | null): boolean {
  return policy.mode === "hide_below" && base !== null && base.valid < policy.threshold;
}

function withheldAbsence(policy: SampleDisplayPolicy): RenderAbsence {
  if (policy.mode !== "hide_below") {
    throw new PresentationError("malformed_document", "sólo una política de ocultamiento retiene un valor.");
  }
  // The threshold, the author and the rationale stay HERE. A reader is told
  // that a person decided not to publish this, and — only if somebody wrote one
  // for them — the sentence on the block. Nothing else.
  return { state: "withheld_by_policy" };
}

/** The public outcome of the policy: a decision already made, plus any approved sentence. */
function sampleDisplayFor(
  policy: SampleDisplayPolicy,
  base: ResponseContext | null,
): RenderSampleDisplay {
  if (policyWithholds(policy, base)) {
    return {
      state: "withheld_by_policy",
      note: policy.mode === "hide_below" ? policy.publicNote : null,
    };
  }
  const note = sampleNoteFor(policy, base);
  return note === null ? { state: "shown" } : { state: "shown_with_note", note };
}

/**
 * Spell a finished number the way the block asked for it — by PADDING ONLY.
 *
 * The canonical formatter renders an integer bare, so the renewal index is
 * `"33"`; the approved dashboard renders `"33.0"`. Appending a zero cannot move
 * a value, so that is the only operation allowed here: no rounding, no
 * shortening, no arithmetic of any kind. A request that would require
 * shortening, or that asks for more precision than the value declares, is
 * refused rather than quietly satisfied.
 */
function applyDisplayFormat(
  value: RenderValue,
  format: DisplayFormat,
): { value: RenderValue } | { error: string } {
  if (format.kind === "canonical") return { value };
  const wanted = format.decimals;
  if (wanted > value.decimals) {
    return {
      error:
        `pide ${wanted} decimales y la cifra sólo declara ${value.decimals}: rellenar más allá de la ` +
        "precisión declarada afirmaría una exactitud que la medición no tiene.",
    };
  }
  const text = value.formatted;
  // Pad a PLAIN DECIMAL NUMERAL and nothing else. `formatNumber` returns an
  // em-dash for a null value and could in principle grow a separator or an
  // exponent; appending zeros to any of those would produce a string that is not
  // a number, which is a worse outcome than declining to restyle it.
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
    return { error: `«${text}» no es un numeral decimal simple, así que no se rellena.` };
  }
  const dot = text.indexOf(".");
  const present = dot < 0 ? 0 : text.length - dot - 1;
  if (present > wanted) {
    return {
      error:
        `la cifra ya se escribe con ${present} decimales y se piden ${wanted}: acortarla sería ` +
        "redondear, y aquí sólo se rellena.",
    };
  }
  if (present === wanted) return { value };
  const zeros = "0".repeat(wanted - present);
  const formatted = dot < 0 && wanted > 0 ? `${text}.${zeros}` : `${text}${zeros}`;
  return { value: { ...value, formatted } };
}

/**
 * The caption an `annotate_below` policy asks for, when the base is under its
 * threshold.
 *
 * `annotate_below` was authored, validated, stored and shipped, and until now
 * the resolver ignored it — which pushed the threshold comparison into the
 * browser, where it would have been a calculation this layer forbids. The
 * comparison happens here, on the server, and what crosses the boundary is the
 * finished sentence.
 */
function sampleNoteFor(policy: SampleDisplayPolicy, base: ResponseContext | null): string | null {
  if (policy.mode !== "annotate_below") return null;
  if (base === null || base.valid >= policy.threshold) return null;
  return policy.note;
}

function applySamplePolicy(
  policy: SampleDisplayPolicy,
  base: ResponseContext | null,
  value: RenderValue | null,
  absence: RenderAbsence | null,
): { value: RenderValue | null; absence: RenderAbsence | null } {
  if (value === null) return { value, absence };
  if (!policyWithholds(policy, base)) return { value, absence };
  return { value: null, absence: withheldAbsence(policy) };
}

/* -------------------------------------------------------------------------- */
/* payloads                                                                    */
/* -------------------------------------------------------------------------- */

function payloadFor(
  address: CanonicalAddress,
  results: CanonicalStudyResults,
  entry: RegistryEntry,
  policy: SampleDisplayPolicy,
): RenderPayload | null {
  switch (address.at) {
    case "recommendation.score": {
      const scope = results.recommendation.scopes[address.scopeIndex];
      if (!scope) return null;
      const read = readMetric(scope.score);
      const guarded = applySamplePolicy(policy, contextOf(scope.score.base), read.value, read.absence);
      return { shape: "value", value: guarded.value, absence: guarded.absence };
    }
    case "recommendation.distribution": {
      const scope = results.recommendation.scopes[address.scopeIndex];
      if (!scope) return null;
      const counts = [
        scope.distribution.promoters,
        scope.distribution.passives,
        scope.distribution.detractors,
      ];
      const shares = [
        scope.distributionShare.promoters,
        scope.distributionShare.passives,
        scope.distributionShare.detractors,
      ];
      // A withheld headline whose own composition is still published is not
      // withheld: promoters, passives and detractors with their shares are the
      // pieces the score was made of. The parts go with the whole.
      if (policyWithholds(policy, contextOf(scope.score.base))) {
        return { shape: "categories", categories: [], absence: withheldAbsence(policy) };
      }
      const categories: RenderCategory[] = NPS_BAND_LABELS.map((label, index) => ({
        label,
        note: null,
        count: counts[index],
        share: shares[index],
        band: null,
      }));
      return { shape: "categories", categories, absence: null };
    }
    case "renewal.index": {
      const read = readMetric(results.renewal.index);
      const guarded = applySamplePolicy(policy, contextOf(results.renewal.base), read.value, read.absence);
      return { shape: "value", value: guarded.value, absence: guarded.absence };
    }
    case "renewal.distribution": {
      const distribution = results.renewal.distribution;
      if (distribution === null) {
        // A refusal forbids the distribution as much as the index. Publishing
        // five zeroes beside a non-empty base would state that nobody chose
        // anything, which is false.
        // The index's OWN state, whichever of the three it is. Reporting an
        // unresolved indicator as `unavailable` would turn "the authorities
        // disagree" into "there was nothing to calculate", which is a different
        // fact and the one the contract went to some trouble to keep apart.
        const indexRead = readMetric(results.renewal.index);
        const reason: RenderAbsence =
          indexRead.absence ??
          ({
            state: "unavailable",
            reason: "not_collected",
            detail: "La distribución no se reporta para esta selección.",
          } as RenderAbsence);
        return { shape: "categories", categories: [], absence: reason };
      }
      if (policyWithholds(policy, contextOf(results.renewal.base))) {
        return { shape: "categories", categories: [], absence: withheldAbsence(policy) };
      }
      const categories: RenderCategory[] = distribution.map((rung) => ({
        label: rung.response,
        note: rung.level,
        count: rung.count,
        share: rung.share,
        band: null,
      }));
      return { shape: "categories", categories, absence: null };
    }
    case "retention.series": {
      const points: RenderSeriesPoint[] = results.retention.periods.map((period) => {
        const retention = readMetric(period.retention);
        const attrition = readMetric(period.attrition);
        const base = contextOf(period.retention.base);
        const guardedRetention = applySamplePolicy(policy, base, retention.value, retention.absence);
        const guardedAttrition = applySamplePolicy(
          policy,
          contextOf(period.attrition.base),
          attrition.value,
          attrition.absence,
        );
        const measures: RenderMeasure[] = [
          { label: "Retención", value: guardedRetention.value, absence: guardedRetention.absence },
          { label: "Deserción", value: guardedAttrition.value, absence: guardedAttrition.absence },
        ];
        return { label: period.label, order: period.order, base, measures };
      });
      return { shape: "series", points };
    }
    case "retention.period": {
      const period = results.retention.periods[address.periodIndex];
      if (!period) return null;
      const metric = address.measure === "retention" ? period.retention : period.attrition;
      const read = readMetric(metric);
      const guarded = applySamplePolicy(policy, contextOf(metric.base), read.value, read.absence);
      return { shape: "value", value: guarded.value, absence: guarded.absence };
    }
    case "population.total":
    case "population.measured": {
      // A population count is a count the source stated. It carries no
      // `ResultValue`, so the contract's own `count` unit applies and the
      // number is rendered as the integer it already is.
      const count = address.at === "population.total" ? results.population.total : results.population.measured;
      return {
        shape: "value",
        value: { value: count, unit: "count", decimals: 0, formatted: String(count), band: null },
        absence: null,
      };
    }
    case "population.cohorts": {
      return {
        shape: "cohorts",
        cohorts: results.population.cohorts.map((cohort) => ({
          label: cohort.label,
          total: cohort.total,
          measured: cohort.measured,
          responded: cohort.responded,
          notParticipated: cohort.notParticipated,
          participationUnknown: cohort.participationUnknown,
        })),
      };
    }
    case "population.instruments": {
      return {
        shape: "instrument_bases",
        instruments: results.population.instruments.map((instrument) => ({
          label: instrument.label,
          base: contextOf(instrument.base),
        })),
      };
    }
    case "journey.group": {
      const group = results.journey.groups[address.groupIndex];
      if (!group) return null;
      return { shape: "journey_group", label: group.label, touchpointCount: group.touchpointKeys.length };
    }
    case "journey.touchpoint": {
      const touchpoint = results.journey.touchpoints[address.touchpointIndex];
      if (!touchpoint) return null;
      if (address.measure === "structure") {
        // The same three numbers a caller could bind one at a time, so the same
        // policy applies: otherwise an authored `hide_below` would depend on
        // which handle the author happened to choose.
        const satisfaction = applySamplePolicy(
          policy,
          contextOf(touchpoint.satisfaction.base),
          readMetric(touchpoint.satisfaction).value,
          null,
        );
        const tdp = applySamplePolicy(policy, contextOf(touchpoint.tdp.base), readMetric(touchpoint.tdp).value, null);
        const share = applySamplePolicy(
          policy,
          contextOf(touchpoint.unawareShareOfResponses.base),
          readMetric(touchpoint.unawareShareOfResponses).value,
          null,
        );
        return {
          shape: "touchpoint",
          label: touchpoint.label,
          satisfaction: satisfaction.value,
          processUnawareness: tdp.value,
          unawarenessShare: share.value,
        };
      }
      const metric =
        address.measure === "satisfaction"
          ? touchpoint.satisfaction
          : address.measure === "tdp"
            ? touchpoint.tdp
            : touchpoint.unawareShareOfResponses;
      const read = readMetric(metric);
      const guarded = applySamplePolicy(policy, contextOf(metric.base), read.value, read.absence);
      return { shape: "value", value: guarded.value, absence: guarded.absence };
    }
    case "qualitative.group": {
      const group = results.qualitative.groups[address.groupIndex];
      if (!group) return null;
      if (policyWithholds(policy, contextOf(group.base))) {
        return { shape: "terms", total: 0, terms: [], excluded: [] };
      }
      return {
        shape: "terms",
        total: group.total,
        terms: group.terms.map((term) => ({ label: term.label, count: term.count, share: term.share })),
        excluded: group.excluded.map((entry) => ({ label: entry.label, count: entry.count })),
      };
    }
    case "performance.dimension": {
      const dimension = results.performance.dimensions[address.dimensionIndex];
      if (!dimension) return null;
      const points: RenderSeriesPoint[] = dimension.periods.map((period, index) => {
        const read = readMetric(period.mean);
        const base = contextOf(period.mean.base);
        // The structural twin of `retention.series` above, and it must obey the
        // same policy. Having the base in hand and not consulting it is exactly
        // how one series ends up suppressed and its neighbour does not.
        const guarded = applySamplePolicy(policy, base, read.value, read.absence);
        return {
          label: period.label,
          order: index,
          base,
          measures: [{ label: dimension.label, value: guarded.value, absence: guarded.absence }],
        };
      });
      return { shape: "series", points };
    }
    case "filter.dimension": {
      const dimension = results.filters.dimensions[address.dimensionIndex];
      if (!dimension) return null;
      return {
        shape: "filter_controls",
        dimensions: [
          {
            handle: entry.handle,
            label: dimension.label,
            options: dimension.values.map((value) => ({
              value: value.value,
              participants: value.participants,
            })),
          },
        ],
      };
    }
    case "configuration.requirement": {
      const requirement = results.configurationRequired[address.requirementIndex];
      if (!requirement) return null;
      return {
        shape: "editorial",
        body: null,
        absence: {
          state: "configuration_required",
          suppliedBy: requirement.suppliedBy,
          detail: requirement.detail,
        },
      };
    }
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* methodology                                                                 */
/* -------------------------------------------------------------------------- */

function explanationFor(address: CanonicalAddress, results: CanonicalStudyResults): string | null {
  // ONLY `provenance.explanation` — the contract's client-safe prose. The
  // internal provenance beside it (metric key, source families, authority
  // statements) is never reachable from here.
  switch (address.at) {
    case "recommendation.score":
    case "recommendation.distribution":
      return results.recommendation.scopes[address.scopeIndex]?.score.provenance.explanation ?? null;
    case "renewal.index":
    case "renewal.distribution":
      return results.renewal.index.provenance.explanation;
    case "retention.period": {
      // The MEASURE decides, not the section. Retention and attrition are two
      // results of one period with two explanations, and handing the retention
      // prose to an attrition figure is a caption that describes the wrong
      // number — which is worse than no caption at all.
      const period = results.retention.periods[address.periodIndex];
      if (!period) return null;
      const metric = address.measure === "retention" ? period.retention : period.attrition;
      return metric.provenance.explanation;
    }
    case "population.total":
    case "population.measured":
    case "population.cohorts":
    case "population.instruments":
      return results.population.provenance.explanation;
    case "journey.group":
      return results.journey.groups[address.groupIndex]?.provenance.explanation ?? null;
    case "journey.touchpoint": {
      // Likewise here, and it matters more: a touchpoint owns THREE results with
      // three explanations, and TDP is the one a reader is most likely to
      // misread. Captioning a 133.3% unawareness ratio with the satisfaction
      // prose would explain the wrong quantity beside the most surprising
      // number on the page.
      const touchpoint = results.journey.touchpoints[address.touchpointIndex];
      if (!touchpoint) return null;
      switch (address.measure) {
        case "tdp":
          return touchpoint.tdp.provenance.explanation;
        case "unawareShare":
          return touchpoint.unawareShareOfResponses.provenance.explanation;
        default:
          return touchpoint.satisfaction.provenance.explanation;
      }
    }
    case "qualitative.group":
      return results.qualitative.groups[address.groupIndex]?.provenance.explanation ?? null;
    default:
      return null;
  }
}

function methodologyFor(
  level: MethodologyDisclosureLevel,
  address: CanonicalAddress | null,
  results: CanonicalStudyResults,
  base: ResponseContext | null,
): RenderMethodology {
  const wantsProse = level === "plain_language" || level === "plain_language_with_base";
  const wantsBase = level === "base_only" || level === "plain_language_with_base";
  return {
    level,
    explanation: wantsProse && address ? explanationFor(address, results) : null,
    base: wantsBase ? base : null,
  };
}

/* -------------------------------------------------------------------------- */
/* the resolver                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a whole presentation.
 *
 * Pure: same three inputs produce a byte-identical model. No clock, no
 * randomness, no environment, no transport. Ordering is total — pages and
 * blocks are sorted by their authored order and ties broken by id — so two runs
 * cannot disagree about sequence.
 */
export function resolvePresentation(input: ResolveInput): PresentationOutcome<PresentationRenderModel> {
  const { document, registry, results } = input;
  const errors: PresentationIssue[] = [];

  // ── BINDING INTEGRITY ──────────────────────────────────────────────────────
  //
  // Unit 6A compared only the contract VERSIONS, which is a test two different
  // studies pass together. Every `CanonicalAddress` is an array position, so a
  // registry built from study A and handed study B's results resolves every
  // handle cleanly and answers with the wrong numbers — a failure with no
  // symptom. Each mismatch below therefore gets its own code, so a gate can
  // prove WHICH one refused.
  if (registry.contractVersion !== results.contractVersion) {
    return failure([
      issue(
        "registry_contract_mismatch",
        "$",
        `el registro describe el contrato ${registry.contractVersion} y los resultados declaran ` +
          `${results.contractVersion}. No se resuelve contra un contrato distinto del que lo generó.`,
      ),
    ]);
  }
  if (
    registry.source.tenantId !== results.study.tenantId ||
    registry.source.studyId !== results.study.studyId
  ) {
    return failure([
      issue(
        "registry_study_mismatch",
        "$",
        "el registro se construyó a partir de OTRO estudio. Como cada dirección canónica es una " +
          "posición de arreglo, resolver así no fallaría: respondería con las cifras equivocadas.",
      ),
    ]);
  }
  if (
    registry.source.planFingerprint !== results.study.planFingerprint ||
    registry.source.packageIdempotencyKey !== results.study.packageIdempotencyKey ||
    registry.source.mappingVersion !== results.study.mappingVersion ||
    registry.source.specId !== results.study.specId
  ) {
    return failure([
      issue(
        "registry_plan_mismatch",
        "$",
        "mismo estudio, otro plan proyectado: las posiciones pueden haberse movido, así que las " +
          "direcciones del registro ya no describen estos resultados.",
      ),
    ]);
  }
  if (document.registryVersion !== registry.registryVersion) {
    return failure([
      issue(
        "registry_version_mismatch",
        "$.registryVersion",
        `el documento se redactó contra la versión ${document.registryVersion} del registro de ` +
          `presentación y ésta es la ${registry.registryVersion}.`,
      ),
    ]);
  }
  if (document.binding !== null && document.binding !== registry.binding) {
    return failure([
      issue(
        "binding_fingerprint_mismatch",
        "$.binding",
        "el documento se enlazó a un registro cuyo mapa de handles no es éste: se renombró una " +
          "etiqueta, se reordenó un grupo o se insertó una entrada antes. Un enlace guardado se " +
          "niega en lugar de apuntar en silencio a otro resultado.",
      ),
    ]);
  }

  const byHandle = new Map<PresentationHandle, RegistryEntry>();
  for (const entry of registry.entries) byHandle.set(entry.handle, entry);

  /** Every filter panel in the document, by id, with the dimensions it offers. */
  const panels = new Map<string, PresentationHandle[]>();
  for (const page of document.pages) {
    for (const block of page.blocks) {
      if (block.kind === "filter_panel") panels.set(block.id, block.dimensions);
    }
  }

  const pages: RenderPage[] = [];

  const orderedPages = document.pages
    .slice()
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1));

  for (const [pageIndex, page] of orderedPages.entries()) {
    const orderedBlocks = page.blocks
      .slice()
      .sort((a, b) =>
        a.placement.order !== b.placement.order
          ? a.placement.order - b.placement.order
          : a.id < b.id
            ? -1
            : 1,
      );

    const renderedBlocks: RenderBlock[] = [];

    for (const [blockIndex, block] of orderedBlocks.entries()) {
      const path = `$.pages[${pageIndex}].blocks[${blockIndex}]`;
      const policy = block.samplePolicy ?? document.samplePolicy ?? DEFAULT_SAMPLE_POLICY;
      const level = block.methodologyDisclosure ?? document.methodologyDisclosure;

      const rendered = resolveBlock({
        block,
        path,
        policy,
        level,
        byHandle,
        panels,
        registry,
        results,
        errors,
      });
      if (rendered) renderedBlocks.push(rendered);
    }

    pages.push({ id: page.id, title: page.title, order: page.order, blocks: renderedBlocks });
  }

  if (errors.length > 0) return failure(errors);

  return success({
    schemaVersion: document.schemaVersion,
    contractVersion: results.contractVersion,
    registryVersion: registry.registryVersion,
    title: document.title,
    locale: document.locale,
    pages,
  });
}

type BlockContext = {
  block: PresentationBlock;
  path: string;
  policy: SampleDisplayPolicy;
  level: MethodologyDisclosureLevel;
  byHandle: Map<PresentationHandle, RegistryEntry>;
  panels: Map<string, PresentationHandle[]>;
  registry: CanonicalPresentationRegistry;
  results: CanonicalStudyResults;
  errors: PresentationIssue[];
};

/**
 * Check every filter panel connected to this block against the bound entry.
 *
 * A connection is honoured only when the RESULT supports the dimension. An
 * authority-forbidden cross is refused by its own code, separately from a
 * merely unsupported one, so a gate can prove that Esfera × CRI fails as a
 * forbidden cross and not as a typo.
 */
function checkConnections(context: BlockContext, entry: RegistryEntry | null): void {
  const { block, path, panels, errors } = context;
  if (entry === null) return;
  for (const panelId of block.connectedFilterPanelIds) {
    const dimensions = panels.get(panelId);
    if (!dimensions) continue; // structural validation already reported it
    for (const dimension of dimensions) {
      if (entry.forbiddenFilters.includes(dimension)) {
        errors.push(
          issue(
            "forbidden_filter_cross",
            path,
            `una autoridad prohíbe cruzar «${dimension}» con este resultado; la conexión con el panel ` +
              `«${panelId}» se rechaza en lugar de descartarse en silencio.`,
          ),
        );
        continue;
      }
      if (!entry.supportedFilters.includes(dimension)) {
        errors.push(
          issue(
            "unsupported_filter_dimension",
            path,
            `este resultado no declara soporte para «${dimension}», ofrecido por el panel «${panelId}».`,
          ),
        );
      }
    }
  }
}

function resolveBlock(context: BlockContext): RenderBlock | null {
  const { block, path, policy, level, byHandle, registry, results, errors } = context;

  // The base this block rests on, known before its payload is built, so an
  // `annotate_below` policy can be decided here once rather than per shape.
  const boundEntry = block.kind === "result" ? (byHandle.get(block.binding) ?? null) : null;
  const shell = {
    id: block.id,
    copy: block.copy,
    placement: block.placement,
    visible: block.visible,
    sampleDisplay: sampleDisplayFor(policy, boundEntry?.responseContext ?? null),
    connectedFilterPanelIds: block.connectedFilterPanelIds.slice(),
  };

  if (block.kind === "filter_panel") {
    const dimensions = [];
    for (const handle of block.dimensions) {
      const entry = byHandle.get(handle);
      if (!entry) {
        errors.push(issue("unknown_handle", path, `el panel ofrece «${handle}», que el registro no conoce.`));
        continue;
      }
      if (handleFacet(handle) !== "dimension") {
        errors.push(
          issue("handle_facet_mismatch", path, `«${handle}» no es una dimensión de filtro.`),
        );
        continue;
      }
      const address = registry.addresses.get(handle);
      if (!address) continue;
      const payload = payloadFor(address, results, entry, policy);
      if (payload && payload.shape === "filter_controls") dimensions.push(...payload.dimensions);
    }
    return {
      ...shell,
      semantic: "filter_dimension",
      chartVariant: "filter_control",
      availability: "available",
      provenance: "source_reported",
      payload: { shape: "filter_controls", dimensions },
      methodology: methodologyFor(level, null, results, null),
    };
  }

  if (block.kind === "editorial") {
    let availability: PresentationAvailability = "available";
    let payload: RenderPayload = { shape: "editorial", body: block.content?.body ?? null, absence: null };
    if (block.slot !== null) {
      const entry = byHandle.get(block.slot);
      if (!entry) {
        errors.push(issue("unknown_handle", path, `la ranura editorial «${block.slot}» no existe en el registro.`));
        return null;
      }
      if (handleFacet(block.slot) !== "editorial") {
        errors.push(issue("handle_facet_mismatch", path, `«${block.slot}» no es una ranura editorial.`));
        return null;
      }
      if (block.content === null) {
        // The contract says a human supplies this and nobody has yet. That is a
        // STATE, reported honestly — never invented, never quietly dropped.
        const address = registry.addresses.get(block.slot);
        const resolved = address ? payloadFor(address, results, entry, policy) : null;
        payload = resolved ?? { shape: "editorial", body: null, absence: null };
        availability = "configuration_required";
      }
    }
    return {
      ...shell,
      semantic: "editorial_slot",
      chartVariant: block.kind === "editorial" ? "narrative" : null,
      availability,
      provenance: "editorial",
      payload,
      methodology: methodologyFor(level, null, results, null),
    };
  }

  if (block.kind === "journey_routes") {
    const routes: RenderRoute[] = [];
    const claimed = new Map<string, string>();

    const orderedRoutes = block.routes
      .slice()
      .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1));

    for (const route of orderedRoutes) {
      const groupEntry = byHandle.get(route.sourceGroup);
      if (!groupEntry) {
        errors.push(
          issue("unknown_handle", path, `la ruta «${route.id}» nombra el grupo «${route.sourceGroup}», desconocido.`),
        );
        continue;
      }
      if (handleFacet(route.sourceGroup) !== "journey-group") {
        errors.push(
          issue("handle_facet_mismatch", path, `«${route.sourceGroup}» no es un grupo de recorrido.`),
        );
        continue;
      }
      checkConnections(context, groupEntry);

      const points: RenderRoutePoint[] = [];
      route.touchpoints.forEach((handle, index) => {
        const entry = byHandle.get(handle);
        if (!entry) {
          errors.push(issue("unknown_handle", path, `la ruta «${route.id}» nombra «${handle}», desconocido.`));
          return;
        }
        if (handleFacet(handle) !== "journey-touchpoint") {
          errors.push(issue("handle_facet_mismatch", path, `«${handle}» no es un punto de contacto.`));
          return;
        }
        if (!groupEntry.members.includes(handle)) {
          errors.push(
            issue(
              "route_touchpoint_outside_group",
              path,
              `la ruta «${route.id}» reclama «${handle}», que la fuente no colocó en «${groupEntry.label}». ` +
                "Cinco rutas visibles pueden repartir cuatro grupos; no pueden inventar pertenencia.",
            ),
          );
          return;
        }
        const previous = claimed.get(handle);
        if (previous !== undefined) {
          errors.push(
            issue(
              "route_touchpoint_duplicated",
              path,
              `«${handle}» ya lo reclama la ruta «${previous}»; un punto de contacto se muestra una sola vez.`,
            ),
          );
          return;
        }
        claimed.set(handle, route.id);

        const address = registry.addresses.get(handle);
        const touchpoint =
          address && address.at === "journey.touchpoint"
            ? results.journey.touchpoints[address.touchpointIndex]
            : undefined;
        if (!touchpoint) return;
        const satisfaction = readMetric(touchpoint.satisfaction);
        const tdp = readMetric(touchpoint.tdp);
        const base = contextOf(touchpoint.satisfaction.base);
        const guarded = applySamplePolicy(policy, base, satisfaction.value, satisfaction.absence);
        const guardedTdp = applySamplePolicy(policy, contextOf(touchpoint.tdp.base), tdp.value, tdp.absence);
        points.push({
          handle,
          label: touchpoint.label,
          order: index,
          satisfaction: guarded.value,
          // TDP arrives exactly as the canonical layer produced it. It is a
          // ratio over the valid base, it may exceed 100, and nothing here
          // clamps, caps or rescales it.
          processUnawareness: guardedTdp.value,
          base,
          absence: guarded.absence,
        });
      });

      routes.push({
        id: route.id,
        title: route.title,
        order: route.order,
        sourceGroupLabel: groupEntry.label,
        points,
      });
    }

    const variant = block.chartVariant;
    if (!CHART_VARIANTS.includes(variant)) {
      errors.push(issue("incompatible_chart_variant", path, `«${variant}» no es una variante conocida.`));
    } else if (!chartVariantIsCompatible("journey_group", variant as ChartVariant)) {
      errors.push(
        issue("incompatible_chart_variant", path, `«${variant}» no puede dibujar un recorrido por grupos.`),
      );
    }

    return {
      ...shell,
      semantic: "journey_group",
      chartVariant: CHART_VARIANTS.includes(variant) ? (variant as ChartVariant) : null,
      availability: "available",
      provenance: "measured_aggregate",
      payload: { shape: "routes", routes },
      methodology: methodologyFor(level, null, results, null),
    };
  }

  /* ---- a plain result block ---- */

  const entry = byHandle.get(block.binding);
  if (!entry) {
    errors.push(
      issue("unknown_handle", path, `el bloque enlaza «${block.binding}», que el registro no conoce.`),
    );
    return null;
  }
  if (handleFacet(block.binding) === "dimension") {
    errors.push(
      issue("handle_facet_mismatch", path, "una dimensión de filtro no se dibuja como un resultado."),
    );
    return null;
  }

  const variant = block.chartVariant;
  if (!CHART_VARIANTS.includes(variant)) {
    errors.push(issue("incompatible_chart_variant", path, `«${variant}» no es una variante conocida.`));
    return null;
  }
  if (!chartVariantIsCompatible(entry.semantic, variant as ChartVariant)) {
    errors.push(
      issue(
        "incompatible_chart_variant",
        path,
        `«${variant}» no puede dibujar «${entry.semantic}»; las variantes compatibles son ` +
          `${entry.compatibleVariants.join(", ")}.`,
      ),
    );
    return null;
  }

  checkConnections(context, entry);

  const address = registry.addresses.get(block.binding);
  if (!address) {
    errors.push(issue("unknown_handle", path, `«${block.binding}» no tiene enlace canónico.`));
    return null;
  }
  const payload = payloadFor(address, results, entry, policy);
  if (payload === null) {
    errors.push(
      issue("unknown_handle", path, `«${block.binding}» ya no resuelve contra este documento de resultados.`),
    );
    return null;
  }

  // Spell the number the way the block asked. Padding only — the helper refuses
  // anything that would need rounding, and refusing is the whole point.
  let formatted = payload;
  if (payload.shape === "value" && payload.value !== null) {
    const spelled = applyDisplayFormat(payload.value, block.displayFormat);
    if ("error" in spelled) {
      errors.push(issue("incompatible_display_format", path, spelled.error));
      return null;
    }
    formatted = { ...payload, value: spelled.value };
  }

  return {
    ...shell,
    payload: formatted,
    semantic: entry.semantic,
    chartVariant: variant as ChartVariant,
    availability: entry.availability,
    provenance: entry.provenance,
    methodology: methodologyFor(level, address, results, entry.responseContext),
  };
}
