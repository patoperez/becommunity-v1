/**
 * SPANISH LABELS FOR THE CLOSED VOCABULARY — the only text a person may read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS.
 *
 * The stored vocabulary is `snake_case` English on purpose: it is a contract
 * between the document, the resolver and the gates, and it must never drift
 * with a translation. The editor was rendering those identifiers straight into
 * `<option>` text, so the person composing a study chose between
 * «plain_language_with_base» and «stacked_bar» — implementation codes offered
 * as if they were a vocabulary somebody had designed for them.
 *
 * Every map here is an EXHAUSTIVE `Record` over its union. That is the whole
 * mechanism: adding a member to `ChartVariant` and forgetting its label is a
 * type error at build time, not a raw identifier discovered on screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS NOT.
 *
 * It is not a place to change what a value MEANS. A label renames nothing: the
 * stored value is untouched, the resolver still receives `stacked_bar`, and a
 * document written before this file existed reads back identically. Nothing
 * here is ever parsed back into a value — the mapping is one-way, from a stored
 * value to the sentence a person reads.
 *
 * It carries no threshold, no number and no formula. It is client-safe by
 * construction and is exported from the safe barrel.
 */

import type { ChartVariant, MethodologyDisclosureLevel } from "./capabilities";
import type { PresentationErrorCode } from "./errors";
import type { PresentationBlock, SampleDisplayPolicy } from "./document";

/**
 * What each drawing is, said as the thing it draws.
 *
 * Not a translation of the identifier — «bar_vertical» is not "barra vertical"
 * to a reader who has to choose it, it is "columns, one per category". The
 * label answers "what will I see", because that is the question being asked at
 * the moment the control is open.
 */
export const CHART_VARIANT_LABEL: Readonly<Record<ChartVariant, string>> = Object.freeze({
  kpi_value: "Cifra sola",
  kpi_with_base: "Cifra con su base",
  gauge: "Cifra sobre una escala de 0 a 100",
  donut: "Anillo de proporciones",
  pie: "Pastel de proporciones",
  stacked_bar: "Barra de composición al 100%",
  bar_vertical: "Columnas, una por categoría",
  bar_horizontal: "Barras horizontales, una por categoría",
  line: "Línea a lo largo del tiempo",
  area: "Área a lo largo del tiempo",
  period_cards: "Tarjetas por periodo, con su medidor",
  table: "Tabla",
  word_cloud: "Nube de términos",
  term_ranking: "Términos ordenados por menciones",
  callout: "Nota destacada",
  narrative: "Texto redactado",
  journey_route_map: "Mapa del recorrido",
  touchpoint_matrix: "Matriz de puntos de contacto",
  filter_control: "Controles de filtro",
});

/** How much of the method travels with the number. */
export const DISCLOSURE_LABEL: Readonly<Record<MethodologyDisclosureLevel, string>> = Object.freeze({
  none: "Sólo la cifra",
  base_only: "La cifra y cuántas personas la sostienen",
  plain_language: "La cifra y una explicación en lenguaje llano",
  plain_language_with_base: "La cifra, la explicación y la base",
});

/**
 * The three display decisions about a small base.
 *
 * `show_all` is the system default and the only one that needs no author: the
 * other two are decisions a person makes and signs. The labels say who acts —
 * "se muestra", "se anota", "se oculta" — rather than naming a mode.
 */
export const SAMPLE_POLICY_MODE_LABEL: Readonly<Record<SampleDisplayPolicy["mode"], string>> =
  Object.freeze({
    show_all: "Mostrarlo todo",
    annotate_below: "Mostrarlo todo y anotar por debajo de X",
    hide_below: "Ocultar por debajo de X",
  });

/** The same three, said in the present tense for a status line. */
export const SAMPLE_POLICY_MODE_STATE: Readonly<Record<SampleDisplayPolicy["mode"], string>> =
  Object.freeze({
    show_all: "se muestra todo",
    annotate_below: "se muestra todo, con una anotación bajo el umbral",
    hide_below: "se oculta lo que queda bajo el umbral",
  });

/** What a block does when its column is narrower than it wants to be. */
export const RESPONSIVE_LABEL: Readonly<Record<PresentationBlock["placement"]["responsive"], string>> =
  Object.freeze({
    reflow: "Pasa a su propia fila",
    stack: "Se apila con los demás",
    scroll_x: "Se desplaza dentro de su caja",
  });

/** What kind of block this is, for a list a person reads. */
export const BLOCK_KIND_LABEL: Readonly<Record<PresentationBlock["kind"], string>> = Object.freeze({
  result: "Resultado",
  journey_routes: "Recorrido",
  filter_panel: "Panel de filtros",
  editorial: "Texto editorial",
});

/**
 * The label for a variant that may be absent.
 *
 * A `journey_routes` or `editorial` block can carry no variant at all, and a
 * document written against a future vocabulary can carry one this build does
 * not know. Both are said in words rather than shown as a code or as "null".
 */
export function chartVariantLabel(variant: ChartVariant | null | undefined): string {
  if (variant === null || variant === undefined) return "Sin forma elegida";
  return CHART_VARIANT_LABEL[variant] ?? "Una forma que esta versión no conoce";
}

/**
 * WHY A RESOLUTION REFUSED, SAID TO A PERSON.
 *
 * The codes stay on screen beside these sentences and that is deliberate: this
 * surface is internal, a reviewer needs the exact token to search for, and the
 * payload contract already decided that codes and paths — never the contract's
 * own prose — are what crosses. What was wrong was showing the token ALONE, so
 * the whole explanation a consultant got for a study that would not open was
 * `unsupported_filter_dimension` in a monospace box.
 *
 * Exhaustive over the union, so a new refusal code cannot be added without
 * deciding what it says.
 */
export const PRESENTATION_ERROR_LABEL: Readonly<Record<PresentationErrorCode, string>> = Object.freeze({
  unsupported_schema_version: "El documento está escrito en una versión que esta capa no interpreta.",
  malformed_document: "El documento no tiene la forma que el esquema exige.",
  duplicate_id: "Dos elementos del documento comparten el mismo identificador.",
  unknown_reference: "El documento apunta a algo que no existe dentro de él.",
  invalid_layout: "La rejilla pedida no es válida.",
  unknown_handle: "El documento nombra un resultado que este estudio no publica.",
  handle_facet_mismatch: "El resultado enlazado no es de la clase que ese bloque puede dibujar.",
  incompatible_chart_variant: "Esa forma no puede dibujar honestamente esa medición.",
  registry_contract_mismatch: "El registro y el contrato de resultados no concuerdan.",
  registry_study_mismatch: "El registro pertenece a otro estudio.",
  registry_plan_mismatch: "El registro pertenece a otro plan de cálculo.",
  registry_version_mismatch: "El registro es de otra versión que la que el documento fijó.",
  binding_fingerprint_mismatch:
    "Los resultados cambiaron desde que se escribió el documento, así que el enlace se niega en vez de apuntar a otra cifra.",
  unbound_presentation_document: "El documento todavía no está enlazado a ningún registro.",
  incompatible_display_format: "Ese formato pediría menos decimales de los que la medición declara.",
  unsupported_filter_dimension: "Esa medición no se puede desglosar por una de las características del panel.",
  forbidden_filter_cross: "Una autoridad del estudio prohíbe cruzar esa característica con esa medición.",
  invalid_filter_connection: "Esa conexión de filtro no es válida.",
  route_touchpoint_outside_group: "Una ruta reclama un punto que su grupo de origen no contiene.",
  route_touchpoint_duplicated: "Un punto aparece en dos rutas del mismo bloque.",
  persistence_scope_mismatch: "El documento guardado pertenece a otro estudio.",
  persistence_scope_invalid: "El alcance guardado no es válido.",
  persistence_too_large: "El documento excede el tamaño que se puede guardar.",
  persistence_hash_mismatch: "El documento no coincide con su propia huella.",
  persistence_unbound_document: "No se puede guardar un documento sin enlazar.",
  sample_policy_unauthored: "Anotar u ocultar por base pequeña exige quién lo decide y por qué.",
  unknown_disclosure_level: "Ese nivel de divulgación metodológica no existe.",
});

/** The sentence for a code, without assuming this build knows every code. */
export function presentationErrorLabel(code: string): string {
  return (
    (PRESENTATION_ERROR_LABEL as Record<string, string | undefined>)[code] ??
    "Esta versión no tiene una explicación escrita para esta negativa."
  );
}
