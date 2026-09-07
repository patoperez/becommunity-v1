/**
 * THE APPROVED BNI CUICUILCO DASHBOARD, EXPRESSED AS CONFIGURATION.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, AND WHAT IT IS DELIBERATELY NOT.
 *
 * The CEO-approved emergency dashboard
 * (`becommunity-bni-cuicuilco-demo` at `a7248fdbccd139da80ed7c09daa70f006a62b9cf`)
 * is the product oracle: it settles what the software must eventually be able to
 * GENERATE. This file is the proof that the presentation layer can express that
 * structure — every section, every visualization choice, every filter panel and
 * the five visible journey routes — using nothing but opaque handles and
 * presentation configuration.
 *
 * IT IS NOT A CLIENT PAGE. There is no route, no component and no branch on a
 * study id anywhere in `src/lib/presentation/`. This is a document of the same
 * kind a future Studio composer will produce, written by hand instead of by an
 * editor.
 *
 * IT CARRIES NO NUMBER. Not the 30.8 recommendation score, not the CRI of 33,
 * not the 74.1% retention of the latest period, not the 133.3% unawareness of
 * `Salida`. Every one of those arrives at resolution time from the canonical
 * results document. Search this file for a digit and you will find grid track
 * counts and ordinal positions, which is all a layout is entitled to know.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE IT DEPARTS FROM THE ORACLE, AND WHY.
 *
 * ONE departure, and it is required. The approved dashboard's "Filtros de riesgo
 * de abandono" panel offers **Esfera**, and the methodology forbids crossing
 * Esfera with the CRI (§5.2, «OJO: La esfera no se debe cruzar en este KPI»).
 * `CLAUDE.md` records the resolution: the approved dashboard offering it is a
 * REFERENCE-DASHBOARD DEVIATION, and the canonical contract wins. The panel here
 * is therefore built from the dimensions the renewal result itself declares it
 * supports — a list from which the registry has already removed the forbidden
 * cross — so the deviation is corrected by construction rather than by a
 * hand-maintained exclusion somebody could forget to update.
 *
 * The journey panel additionally omits Esfera because the approved dashboard's
 * own journey panel omits it. That one is a presentation choice, not a
 * prohibition, and it is written down as such.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FOUR SOURCE GROUPS AND THE FIVE VISIBLE ROUTES.
 *
 * The workbook's satisfaction sheet carries exactly four merged bands over 55
 * touchpoints (29 / 6 / 10 / 10), and that partition is the SOURCE's, carried by
 * the canonical contract as four `JourneyGroupResult`s.
 *
 * The approved dashboard shows FIVE routes, splitting the first category into
 * «Operación» and «Interacción» because, in its own words, that category
 * «reúne dos cosas que se viven de maneras muy distintas». That split is a
 * PRESENTATION DECISION and it lives here, in a document, as two routes that
 * both name the same source group and partition its touchpoints between them.
 * The resolver enforces the honesty of the arrangement: a route may not claim a
 * touchpoint the source did not place in its group, and no touchpoint may be
 * claimed twice.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  DEFAULT_SAMPLE_POLICY,
  type PresentationBlock,
  type PresentationDocument,
  type ResponsiveBehavior,
  type SampleDisplayPolicy,
} from "../document";
import { PRESENTATION_DOCUMENT_KIND, PRESENTATION_DOCUMENT_SCHEMA_VERSION } from "../document";
import { PresentationError } from "../errors";
import { presentationHandle, type PresentationHandle } from "../handles";
import type { CanonicalPresentationRegistry } from "../registry";
import type { MethodologyDisclosureLevel } from "../capabilities";

/* -------------------------------------------------------------------------- */
/* handles the blueprint expects                                               */
/* -------------------------------------------------------------------------- */

/**
 * The handles this blueprint binds, named once.
 *
 * Each is derived the same way the registry derives it — from the closed
 * vocabulary and from labels the study specification already declares — so the
 * two cannot drift silently. `requireHandle` fails loudly rather than quietly
 * producing a document with a dangling binding, because a blueprint that
 * "mostly" resolves is worse than one that refuses.
 */
const H = {
  populationTotal: presentationHandle("population", "total"),
  instrumentBases: presentationHandle("population", "instrument", "bases"),
  retentionSeries: presentationHandle("series", "retention", "and", "attrition"),
  npsCombined: presentationHandle("value", "nps", "activos-y-desertores"),
  npsActive: presentationHandle("value", "nps", "miembros-activos"),
  npsDeserter: presentationHandle("value", "nps", "desertores"),
  npsComposition: presentationHandle("distribution", "nps", "activos-y-desertores"),
  renewalIndex: presentationHandle("value", "renewal", "index"),
  renewalDistribution: presentationHandle("distribution", "renewal", "intention"),
  qualitativeActive: presentationHandle("qualitative", "miembros-activos"),
  qualitativeDeserter: presentationHandle("qualitative", "desertores"),
  journeyPainCloud: presentationHandle("editorial", "curated-journey-pain-cloud"),
  esferaDimension: presentationHandle("dimension", "esfera"),
} as const;

/** The four source groups, by the label the canonical projection gives them. */
const GROUP_HANDLES = {
  interactionsAndOperation: presentationHandle("journey-group", "interacciones-y-operacion"),
  accountability: presentationHandle("journey-group", "rendicion-de-cuentas"),
  cultureLeadership: presentationHandle("journey-group", "cultura-edl"),
  cultureMembers: presentationHandle("journey-group", "cultura-miembros"),
} as const;

/** A touchpoint handle, by its group ordinal and its position inside that group. */
function touchpoint(groupOrdinal: number, withinGroup: number): PresentationHandle {
  return presentationHandle("journey-touchpoint", `g${groupOrdinal}-t${withinGroup}`);
}

/**
 * THE SPLIT, written as two ordered lists of positions in the FIRST source group.
 *
 * The numbers are positions in the source's own column order — the order the
 * workbook's header row states — and nothing else. Together they are 1..29 with
 * no repeat and no gap, which is what makes the two routes a partition of the
 * group rather than a re-selection of it.
 *
 * The dashboard's «Operación» does not run in source order: it gathers the
 * chapter's operating moments in the sequence a member lives them, so PEM (11)
 * follows Onboarding (4) and the platform touchpoints (7-10) come after the
 * meetings. That reordering is exactly the kind of decision a presentation layer
 * is allowed to make and a results contract is not.
 */
const OPERATION_POSITIONS = [1, 2, 3, 4, 11, 5, 6, 12, 13, 14, 7, 10, 8, 9, 25, 26, 27, 28, 29] as const;

/** «Interacción»: the chapter's teams and roles, in the source's own order. */
const INTERACTION_POSITIONS = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24] as const;

/* -------------------------------------------------------------------------- */
/* small builders                                                              */
/* -------------------------------------------------------------------------- */

type Span = { desktop: number; tablet: number; mobile: number };

type BlockSeed = {
  id: string;
  order: number;
  span: Span;
  responsive?: ResponsiveBehavior;
  title?: string | null;
  description?: string | null;
  annotation?: string | null;
  connect?: string[];
  disclosure?: MethodologyDisclosureLevel | null;
  policy?: SampleDisplayPolicy | null;
};

function shell(seed: BlockSeed) {
  return {
    id: seed.id,
    copy: {
      title: seed.title ?? null,
      description: seed.description ?? null,
      annotation: seed.annotation ?? null,
    },
    placement: {
      order: seed.order,
      span: seed.span,
      responsive: seed.responsive ?? ("reflow" as ResponsiveBehavior),
    },
    visible: true,
    connectedFilterPanelIds: seed.connect ?? [],
    samplePolicy: seed.policy ?? null,
    methodologyDisclosure: seed.disclosure ?? null,
  };
}

function result(seed: BlockSeed, binding: PresentationHandle, chartVariant: string): PresentationBlock {
  return { ...shell(seed), kind: "result", binding, chartVariant };
}

function editorial(seed: BlockSeed, body: string | null, slot: PresentationHandle | null = null): PresentationBlock {
  return { ...shell(seed), kind: "editorial", slot, content: body === null ? null : { body } };
}

function panel(seed: BlockSeed, dimensions: PresentationHandle[]): PresentationBlock {
  return { ...shell(seed), kind: "filter_panel", dimensions };
}

/* -------------------------------------------------------------------------- */
/* the blueprint                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build the approved dashboard's structure as a presentation document.
 *
 * The registry is an INPUT because the filter panels are derived from what each
 * result declares it supports, rather than from a hand-written list that could
 * drift away from the contract. Everything else — pages, blocks, order, spans,
 * routes, copy — is fixed, so the same registry always produces byte-identical
 * bytes.
 */
export function buildApprovedCuicuilcoBlueprint(
  registry: CanonicalPresentationRegistry,
): PresentationDocument {
  const byHandle = new Map(registry.entries.map((entry) => [entry.handle, entry]));

  const requireHandle = (handle: PresentationHandle, what: string): PresentationHandle => {
    if (!byHandle.has(handle)) {
      throw new PresentationError(
        "unknown_handle",
        `el plano aprobado espera ${what} en «${handle}», y el registro no lo tiene. ` +
          "El plano se niega a producir un documento con un enlace colgante.",
      );
    }
    return handle;
  };

  /**
   * The dimensions a result accepts, minus the cohort control.
   *
   * The approved dashboard drives the active/deserter split with scope tabs
   * rather than with a filter, and offering the same choice twice in one section
   * is how two controls end up disagreeing.
   */
  const dimensionsFor = (handle: PresentationHandle, omit: PresentationHandle[] = []): PresentationHandle[] => {
    const entry = byHandle.get(handle);
    if (!entry) {
      throw new PresentationError("unknown_handle", `no hay entrada para «${handle}» al construir un panel.`);
    }
    const cohort = presentationHandle("dimension", "cohorte");
    const excluded = new Set<string>([cohort, ...omit]);
    return entry.supportedFilters.filter((dimension) => !excluded.has(dimension));
  };

  for (const [handle, what] of [
    [H.populationTotal, "la población del estudio"],
    [H.instrumentBases, "las bases por instrumento"],
    [H.retentionSeries, "la serie de retención"],
    [H.npsCombined, "la recomendación combinada"],
    [H.npsActive, "la recomendación de activos"],
    [H.npsDeserter, "la recomendación de desertores"],
    [H.npsComposition, "la composición de la recomendación"],
    [H.renewalIndex, "el índice de renovación"],
    [H.renewalDistribution, "la distribución de renovación"],
    [H.qualitativeActive, "la nube de miembros activos"],
    [H.qualitativeDeserter, "la nube de desertores"],
    [H.journeyPainCloud, "la ranura editorial de puntos de dolor"],
    [GROUP_HANDLES.interactionsAndOperation, "el grupo de interacciones y operación"],
    [GROUP_HANDLES.accountability, "el grupo de rendición de cuentas"],
    [GROUP_HANDLES.cultureLeadership, "el grupo de cultura (EDL)"],
    [GROUP_HANDLES.cultureMembers, "el grupo de cultura (miembros)"],
  ] as [PresentationHandle, string][]) {
    requireHandle(handle, what);
  }

  const groupOrdinal = (handle: PresentationHandle): number => {
    const index = registry.entries
      .filter((entry) => entry.semantic === "journey_group" && entry.handle.startsWith("journey-group:"))
      .findIndex((entry) => entry.handle === handle);
    if (index < 0) {
      throw new PresentationError("unknown_handle", `«${handle}» no es un grupo de recorrido del registro.`);
    }
    // The registry mints a touchpoint handle from the group's position in the
    // contract's own group array, so the ordinal is read back from the group's
    // first member rather than guessed from the sorted catalogue order.
    const entry = byHandle.get(handle);
    const firstMember = entry?.members[0];
    if (!firstMember) {
      throw new PresentationError("unknown_handle", `el grupo «${handle}» no declara puntos de contacto.`);
    }
    const match = /^journey-touchpoint:g(\d+)-t\d+$/.exec(firstMember);
    if (!match) {
      throw new PresentationError("unknown_handle", `el miembro «${firstMember}» no tiene forma de punto de contacto.`);
    }
    return Number(match[1]);
  };

  // Only the FIRST category needs an ordinal, because it is the only one this
  // blueprint repartitions by position. The other three are taken whole, in the
  // source's own order, straight from the group's own member list — so asking
  // for their ordinals would be computing something nothing reads.
  const gInteractions = groupOrdinal(GROUP_HANDLES.interactionsAndOperation);

  const wholeGroup = (handle: PresentationHandle): PresentationHandle[] => {
    const entry = byHandle.get(handle);
    return entry ? entry.members.slice() : [];
  };

  const npsPanelId = "panel-recomendacion";
  const journeyPanelId = "panel-recorrido";
  const riskPanelId = "panel-riesgo";

  const blocks: PresentationBlock[] = [
    /* ---- study cover ---- */
    editorial(
      {
        id: "portada",
        order: 0,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "La voz de las y los Nets de Cuicuilco",
        description:
          "Panorama del estudio. Cada bloque declara la base sobre la que descansa, y ninguna cifra " +
          "se calcula en el navegador.",
      },
      "Este estudio reúne los instrumentos aplicados al capítulo durante el periodo declarado. " +
        "Los resultados de cada instrumento utilizan las respuestas disponibles para ese análisis.",
    ),
    result(
      {
        id: "portada-poblacion",
        order: 1,
        span: { desktop: 4, tablet: 6, mobile: 12 },
        title: "Personas del capítulo",
        disclosure: "base_only",
      },
      H.populationTotal,
      "kpi_value",
    ),
    result(
      {
        id: "portada-bases",
        order: 2,
        span: { desktop: 8, tablet: 6, mobile: 12 },
        title: "Base por instrumento",
        responsive: "scroll_x",
      },
      H.instrumentBases,
      "table",
    ),

    /* ---- retention and attrition. No filter panel, exactly as approved. ---- */
    result(
      {
        id: "retencion-serie",
        order: 10,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Retención y deserción",
        description:
          "Permite observar qué proporción de la comunidad permaneció y cómo evolucionaron las salidas " +
          "durante cada periodo. Cada periodo se lee por separado.",
        disclosure: "plain_language_with_base",
        responsive: "scroll_x",
      },
      H.retentionSeries,
      "bar_vertical",
    ),
    editorial(
      {
        id: "retencion-metodo",
        order: 11,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Cómo interpretar este resultado",
      },
      "Cada periodo se lee por sí mismo y no arrastra a los anteriores. No existe un umbral universal " +
        "de retención buena, así que ninguna tarjeta emite un veredicto.",
    ),

    /* ---- recommendation ---- */
    panel(
      {
        id: npsPanelId,
        order: 20,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Filtros de recomendación",
      },
      dimensionsFor(H.npsCombined),
    ),
    result(
      {
        id: "recomendacion-puntaje",
        order: 21,
        span: { desktop: 5, tablet: 12, mobile: 12 },
        title: "¿Qué tanto recomendarían esta experiencia?",
        annotation:
          "Puede ser positivo o negativo. Un valor más alto representa una relación más favorable " +
          "con el capítulo.",
        connect: [npsPanelId],
        disclosure: "plain_language_with_base",
      },
      H.npsCombined,
      "kpi_with_base",
    ),
    result(
      {
        id: "recomendacion-composicion",
        order: 22,
        span: { desktop: 7, tablet: 12, mobile: 12 },
        title: "Composición de las respuestas",
        description:
          "Cómo se reparten las respuestas de esta selección. Esta barra describe la composición del " +
          "grupo, en su propia escala.",
        connect: [npsPanelId],
      },
      H.npsComposition,
      "stacked_bar",
    ),
    // The comparison cells are deliberately NOT connected to the panel. The
    // approved dashboard always shows the three unfiltered scope figures beside
    // the filtered headline, and a connection here would silently change what
    // "comparación entre poblaciones" means.
    result(
      {
        id: "recomendacion-comparacion-activos",
        order: 23,
        span: { desktop: 6, tablet: 6, mobile: 12 },
        title: "Miembros activos",
      },
      H.npsActive,
      "kpi_value",
    ),
    result(
      {
        id: "recomendacion-comparacion-desertores",
        order: 24,
        span: { desktop: 6, tablet: 6, mobile: 12 },
        title: "Desertores",
      },
      H.npsDeserter,
      "kpi_value",
    ),
    editorial(
      {
        id: "recomendacion-metodo",
        order: 25,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Cómo interpretar este resultado",
      },
      "Dos grupos pueden llegar al mismo resultado con composiciones muy distintas. Las tres " +
        "poblaciones comparten una escala, así que las distancias entre ellas son comparables.",
    ),

    /* ---- the journey: four source groups, five visible routes ---- */
    panel(
      {
        id: journeyPanelId,
        order: 30,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Filtros del recorrido",
      },
      dimensionsFor(GROUP_HANDLES.interactionsAndOperation, [H.esferaDimension]),
    ),
    {
      ...shell({
        id: "recorrido-rutas",
        order: 31,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Satisfacción punto por punto",
        description:
          "El instrumento evalúa cuatro categorías. La primera reúne dos cosas que se viven de maneras " +
          "muy distintas —la operación del capítulo y el trato con sus equipos—, así que aquí se presenta " +
          "como dos recorridos. Son cuatro categorías presentadas en cinco recorridos.",
        connect: [journeyPanelId],
        disclosure: "plain_language_with_base",
        responsive: "scroll_x",
      }),
      kind: "journey_routes",
      chartVariant: "journey_route_map",
      routes: [
        {
          id: "operacion",
          title: "Operación",
          order: 0,
          sourceGroup: GROUP_HANDLES.interactionsAndOperation,
          touchpoints: OPERATION_POSITIONS.map((position) => touchpoint(gInteractions, position)),
        },
        {
          id: "interaccion",
          title: "Interacción",
          order: 1,
          sourceGroup: GROUP_HANDLES.interactionsAndOperation,
          touchpoints: INTERACTION_POSITIONS.map((position) => touchpoint(gInteractions, position)),
        },
        {
          id: "rendicion-de-cuentas",
          title: "Rendición de cuentas",
          order: 2,
          sourceGroup: GROUP_HANDLES.accountability,
          touchpoints: wholeGroup(GROUP_HANDLES.accountability),
        },
        {
          id: "cultura-equipo-de-liderazgo",
          title: "Cultura · Equipo de Liderazgo",
          order: 3,
          sourceGroup: GROUP_HANDLES.cultureLeadership,
          touchpoints: wholeGroup(GROUP_HANDLES.cultureLeadership),
        },
        {
          id: "cultura-miembros",
          title: "Cultura · Miembros",
          order: 4,
          sourceGroup: GROUP_HANDLES.cultureMembers,
          touchpoints: wholeGroup(GROUP_HANDLES.cultureMembers),
        },
      ],
    } as PresentationBlock,
    editorial(
      {
        id: "recorrido-metodo",
        order: 32,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Cómo interpretar este resultado",
      },
      "La satisfacción y el desconocimiento son cosas distintas: un punto puede funcionar bien para " +
        "quien llega a él y, aun así, no haberle llegado a mucha gente. El desconocimiento no es una " +
        "calificación baja.",
    ),

    /* ---- renewal risk ---- */
    // The dimensions come from what the renewal result declares it supports, so
    // the forbidden Esfera cross is absent by construction rather than by a
    // list somebody has to remember to prune.
    panel(
      {
        id: riskPanelId,
        order: 40,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Filtros de riesgo de abandono",
      },
      dimensionsFor(H.renewalIndex),
    ),
    result(
      {
        id: "riesgo-indice",
        order: 41,
        span: { desktop: 5, tablet: 12, mobile: 12 },
        title: "Índice de riesgo de abandono",
        annotation: "El puntaje es directamente el riesgo, no su contrario.",
        connect: [riskPanelId],
        disclosure: "plain_language_with_base",
      },
      H.renewalIndex,
      "gauge",
    ),
    result(
      {
        id: "riesgo-distribucion",
        order: 42,
        span: { desktop: 7, tablet: 12, mobile: 12 },
        title: "Distribución de la intención de renovar",
        connect: [riskPanelId],
        responsive: "scroll_x",
      },
      H.renewalDistribution,
      "bar_horizontal",
    ),
    // NOT connected, and the copy says so. The approved dashboard reports these
    // reasons over the whole active base rather than over the panel's selection;
    // sharing every dimension with that panel is not a connection.
    result(
      {
        id: "riesgo-razones",
        order: 43,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Razones declaradas de riesgo",
        description: "Se reportan sobre toda la base activa, no sobre la selección de filtros.",
      },
      H.qualitativeActive,
      "term_ranking",
    ),
    editorial(
      {
        id: "riesgo-metodo",
        order: 44,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Cómo interpretar este resultado",
      },
      "El índice resume el nivel agregado de riesgo percibido: cuanta menor intención de continuar, " +
        "mayor riesgo.",
    ),

    /* ---- declared themes ---- */
    result(
      {
        id: "temas-activos",
        order: 50,
        span: { desktop: 6, tablet: 6, mobile: 12 },
        title: "Miembros activos",
        description: "Categorías curadas de la pregunta abierta del índice de renovación.",
      },
      H.qualitativeActive,
      "word_cloud",
    ),
    result(
      {
        id: "temas-desertores",
        order: 51,
        span: { desktop: 6, tablet: 6, mobile: 12 },
        title: "Desertores",
        description: "Categorías curadas de la encuesta de salida.",
      },
      H.qualitativeDeserter,
      "word_cloud",
    ),
    // CONFIGURATION REQUIRED, and it stays that way. The approved dashboard
    // publishes a populated pain-point cloud, but the canonical contract
    // classifies that content as `editorial_review`: it depends on a phrase
    // segmentation and a touchpoint-to-stage alias table that the approved
    // dashboard resolves with a hand-written table in its own build script,
    // which is an implementation and not an authority. The slot is declared,
    // left empty, and reported as awaiting a human — never inferred.
    editorial(
      {
        id: "temas-recorrido",
        order: 52,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Puntos de dolor del recorrido",
        description: "Contenido editorial curado, no un indicador calculado en servidor.",
      },
      null,
      H.journeyPainCloud,
    ),
    editorial(
      {
        id: "temas-metodo",
        order: 53,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Cómo interpretar este resultado",
      },
      "Los términos son categorías del estudio, no frases escritas por participantes: este tablero no " +
        "muestra ningún comentario textual.",
    ),

    /* ---- executive closing ---- */
    editorial(
      {
        id: "cierre",
        order: 60,
        span: { desktop: 12, tablet: 12, mobile: 12 },
        title: "Qué muestran los resultados",
        description:
          "Una síntesis de lo medido, sin interpretaciones que los datos no sostengan. Cada bloque " +
          "declara la base sobre la que descansa.",
      },
      "Las conclusiones ejecutivas se redactan por revisión editorial sobre los resultados anteriores.",
    ),
  ];

  return {
    schemaVersion: PRESENTATION_DOCUMENT_SCHEMA_VERSION,
    documentKind: PRESENTATION_DOCUMENT_KIND,
    id: "cuicuilco-aprobado",
    title: "La voz de las y los Nets de Cuicuilco",
    locale: "es-MX",
    // The approved dashboard reports every base and withholds nothing, down to a
    // single respondent. That is the system default, not a choice this blueprint
    // had to make — and it is why no threshold appears anywhere in this file.
    samplePolicy: DEFAULT_SAMPLE_POLICY,
    methodologyDisclosure: "plain_language_with_base",
    pages: [{ id: "panorama", title: "Panorama del estudio", order: 0, blocks }],
    publication: {
      status: "draft",
      sourceDraftRevision: null,
      definitionSha256: null,
      studyFingerprint: null,
      acknowledgedWarnings: [],
      preparedNote: null,
    },
  };
}

/** The five visible routes, named, for a gate that pins the mapping. */
export const APPROVED_ROUTE_IDS = [
  "operacion",
  "interaccion",
  "rendicion-de-cuentas",
  "cultura-equipo-de-liderazgo",
  "cultura-miembros",
] as const;

/** The two ordered partitions of the first source group, for the same gate. */
export const APPROVED_FIRST_GROUP_PARTITION = {
  operacion: OPERATION_POSITIONS,
  interaccion: INTERACTION_POSITIONS,
} as const;
