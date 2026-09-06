/**
 * THE AUTHORITY REGISTER.
 *
 * Every decision this layer makes cites one of these, by id, in the result it
 * produces. The order below is the order that resolves a disagreement:
 *
 *   1. the documented Be Community methodology, and explicit recorded decisions;
 *   2. the complete source-workbook structure;
 *   3. the approved dashboard, as the expected numerical and presentation output;
 *   4. the legacy application, as compatibility evidence only — never as
 *      methodological authority.
 *
 * `statement` quotes the source in the language it uses. These strings are
 * INTERNAL: they travel on `MetricResult.provenance.internal`, never on the
 * client-safe `explanation`.
 */

import type { AuthorityReference } from "./contract";

export type AuthorityRank = 1 | 2 | 3 | 4;

export type RegisteredAuthority = AuthorityReference & { rank: AuthorityRank };

/**
 * Ranked authorities. Adding one is a documentation act: it must name a real
 * document and a real section, and `npm run test:canonical-results` fails if a
 * result cites an id that is not registered here.
 */
export const AUTHORITIES: Record<string, RegisteredAuthority> = {
  "methodology-4-1-csat": {
    id: "methodology-4-1-csat",
    rank: 1,
    document: "Documentacion_Integral_Proceso_Be_Community (1).docx",
    section: "§4.1 — CSAT",
    statement:
      "«CSAT de cada punto de contacto de la experiencia del cliente o empleado.» " +
      "Recodificación: «4 y 5= satisfecho / 3, 2 y 1= Insatisfecho / " +
      "No lo conozco/No lo he utilizado/No he interactuado= Desconocimiento». " +
      "Escala 1 a 5. Bandas: «Verde: 75 a 100 / Amarillo 74 a 60 / Rojo 59 a 0».",
  },
  "methodology-4-1-tdp": {
    id: "methodology-4-1-tdp",
    rank: 1,
    document: "Documentacion_Integral_Proceso_Be_Community (1).docx",
    section: "§4.1 — TDP",
    statement:
      "«TDP = (Número de eventos reportados por desconocimiento / Número total de respuestas " +
      "con categoría de Satisfecho y Insatisfecho) × 100». El denominador EXCLUYE las respuestas " +
      "de desconocimiento, por lo que el resultado puede superar 100. La celda de regla o " +
      "excepción está vacía: no hay bandas.",
  },
  "methodology-7-1-conocimiento": {
    id: "methodology-7-1-conocimiento",
    rank: 1,
    document: "Documentacion_Integral_Proceso_Be_Community (1).docx",
    section: "§7.1 — gráfico de niveles de conocimiento",
    statement:
      "«Distribución por niveles de conocimiento: barras apiladas mostrando el % que conoce / " +
      "% que no conoce». Un par que suma 100 implica un denominador de TODAS las respuestas del " +
      "punto, distinto del denominador de la fórmula TDP de §4.1.",
  },
  "methodology-4-1-nps": {
    id: "methodology-4-1-nps",
    rank: 1,
    document: "Documentacion_Integral_Proceso_Be_Community (1).docx",
    section: "§4.1 — NPS",
    statement:
      "«NPS= %Promotores-%Detractores»; «Promotores= 9 y 10 Pasivos= 7 y 8 / Detractores= 0 a 6»; " +
      "«Los pasivos se excluyen de la fórmula». Bandas: «Verde: 80 a 100 / Amarillo 60 a 79 / " +
      "Rojo 59 a 0». §3.2 y la celda «qué datos usa» describen el instrumento en escala 1 a 10.",
  },
  "methodology-4-1-cri": {
    id: "methodology-4-1-cri",
    rank: 1,
    document: "Documentacion_Integral_Proceso_Be_Community (1).docx",
    section: "§4.1 y §4.3 — CRI",
    statement:
      "Puntajes por respuesta: «Nada=100 / Poco= 75 / Algo= 50 / Muy= 25 / Extremadamente= 0». " +
      "Niveles de alerta por respuesta. Zonas en §4.3: «De 0 a 30 puntos: Zona Segura… " +
      "De 31 a 60 puntos: Zona de Alerta… Más de 60 puntos: Zona de Peligro». " +
      "El documento NO enuncia cómo se agrega el índice.",
  },
  "methodology-4-1-retencion": {
    id: "methodology-4-1-retencion",
    rank: 1,
    document: "Documentacion_Integral_Proceso_Be_Community (1).docx",
    section: "§4.1 — Retención y deserción",
    statement:
      "«CRR= Número de miembros al final del periodo - Número de miembros nuevos durante el " +
      "periodo entre Número de miembros al inicio del periodo». " +
      "«CR= Número de miembros perdidos durante el periodo entre Número de miembros al inicio " +
      "del periodo». §7.4: el rango de color no es fijo y debe capturarse por cliente.",
  },
  "methodology-4-1-categorias-csat": {
    id: "methodology-4-1-categorias-csat",
    rank: 1,
    document: "Documentacion_Integral_Proceso_Be_Community (1).docx",
    section: "§4.1 — categorías evaluadas (BNI)",
    statement:
      "«Para BNI los aspectos evaluados corresponden a 4 categorías: Interacciones y operación al " +
      "interior del capítulo; Rendición de cuentas, Cultura BNI del Equipo de Liderazgo, Cultura " +
      "BNI Miembros.» «En el dashboard separar cada categoría.» El documento NO enumera qué " +
      "punto de contacto pertenece a cada categoría.",
  },
  "methodology-7-2-journey": {
    id: "methodology-7-2-journey",
    rank: 1,
    document: "Documentacion_Integral_Proceso_Be_Community (1).docx",
    section: "§7.2 — Customer journey",
    statement:
      "«Cada cliente puede tener un recorrido diferente, los puntos de inicio y final son fijos en " +
      "general.» «Las etapas son puntos de contacto o touchpoints.» No existe una lista nombrada " +
      "de etapas ni una capa intermedia a la que un indicador pudiera adscribirse.",
  },
  "methodology-5-2-esfera-cri": {
    id: "methodology-5-2-esfera-cri",
    rank: 1,
    document: "Documentacion_Integral_Proceso_Be_Community (1).docx",
    section: "§5.2 — cruces permitidos",
    statement: "«OJO: La esfera no se debe cruzar en este KPI» — dicho del CRI.",
  },
  "methodology-3-3-sin-supresion": {
    id: "methodology-3-3-sin-supresion",
    rank: 1,
    document: "Documentacion_Integral_Proceso_Be_Community (1).docx",
    section: "§3.3 — depuración",
    statement:
      "«No hubo necesidad de eliminar a nadie del estudio.» El documento no define muestra mínima, " +
      "umbral, supresión ni anonimización: no hay regla metodológica de ocultamiento.",
  },
  "catalog-3-nps": {
    id: "catalog-3-nps",
    rank: 1,
    document: "docs/CALCULATION_CATALOG.md",
    section: "§3 — NPS",
    statement:
      "Entrada entera 1 a 10. Detractor 1–6, Pasivo 7–8, Promotor 9–10. " +
      "«Los pasivos … sí permanecen en el denominador». Bandas verde 80–100, amarillo 60–<80, rojo <60.",
  },
  "catalog-4-csat": {
    id: "catalog-4-csat",
    rank: 1,
    document: "docs/CALCULATION_CATALOG.md",
    section: "§4 — CSAT",
    statement:
      "«CSAT = (respuestas 4 o 5 / respuestas válidas 1–5) × 100». " +
      "«CSAT se calcula y presenta por punto de contacto. No existe un CSAT general obtenido " +
      "promediando puntos de contacto.» Bandas verde 75–100, amarillo 60–<75, rojo <60.",
  },
  "catalog-5-tdp": {
    id: "catalog-5-tdp",
    rank: 1,
    document: "docs/CALCULATION_CATALOG.md",
    section: "§5 — TDP",
    statement:
      "Corregido el 6 de septiembre de 2026: «TDP = (respuestas de desconocimiento / respuestas " +
      "válidas satisfechas e insatisfechas) × 100», el mismo denominador de §4.1 de la " +
      "documentación integral. Puede superar 100. La proporción sobre todas las respuestas del " +
      "punto se conserva como cantidad auxiliar con nombre propio y NO se llama TDP.",
  },
  "owner-decision-tdp": {
    id: "owner-decision-tdp",
    rank: 1,
    document: "Decisión registrada de la propiedad metodológica",
    section: "2026-09-06 — significado de TDP",
    statement:
      "El indicador oficial llamado TDP es la razón de §4.1 y del tablero aprobado: respuestas de " +
      "desconocimiento sobre respuestas válidas satisfechas e insatisfechas. Puede superar 100 %. " +
      "La cantidad alternativa (desconocimiento sobre todas las respuestas clasificadas) puede " +
      "conservarse como proporción auxiliar útil, pero no puede llamarse TDP, debe llevar un " +
      "nombre descriptivo inequívoco, no sustituye al TDP autoritativo y su denominador debe " +
      "permanecer explícito.",
  },
  "owner-decision-esfera-cri": {
    id: "owner-decision-esfera-cri",
    rank: 1,
    document: "Decisión registrada de la propiedad metodológica",
    section: "2026-09-06 — Esfera × CRI",
    statement:
      "Esfera NO se permite como filtro ni como cruce de segmentación del CRI. La documentación " +
      "integral §5.2 es autoritativa; que el tablero de emergencia ofrezca el cruce es una " +
      "desviación del tablero de referencia, no una anulación metodológica. Se conserva el " +
      "rechazo canónico y la cuestión queda RESUELTA.",
  },
  "owner-decision-journey-metrics": {
    id: "owner-decision-journey-metrics",
    rank: 1,
    document: "Decisión registrada de la propiedad metodológica",
    section: "2026-09-06 — relaciones del recorrido",
    statement:
      "Un punto de contacto posee DIRECTAMENTE su CSAT y sus resultados de desconocimiento con " +
      "sus bases. NPS, CRI, retención, deserción, LTV y demás indicadores de estudio NO se " +
      "adscriben implícitamente a un punto de contacto, y no puede inferirse ninguna asociación " +
      "genérica indicador-etapa. Cualquier asociación adicional en un estudio futuro debe venir " +
      "de configuración explícita de estudio o plantilla, con procedencia. Esto es una REGLA DEL " +
      "CONTRATO, no una incertidumbre metodológica.",
  },
  "owner-decision-capitanes": {
    id: "owner-decision-capitanes",
    rank: 1,
    document: "Decisión registrada de la propiedad metodológica",
    section: "2026-09-06 — Capitanes / #REF!",
    statement:
      "La implementación vigente es correcta: se conserva el punto de contacto canónico " +
      "«Capitanes de Esfera» poblado, se excluye únicamente la columna duplicada cuyos registros " +
      "son todos source_unavailable/#REF!, y se mantiene la regla general de exclusión basada en " +
      "evidencia. RESUELTO.",
  },
  "owner-decision-journey-cloud": {
    id: "owner-decision-journey-cloud",
    rank: 1,
    document: "Decisión registrada de la propiedad metodológica",
    section: "2026-09-06 — nube cualitativa del recorrido",
    statement:
      "La nube de puntos de dolor del recorrido depende de una segmentación editorial de frases y " +
      "de un mapeo de alias escrito a mano que no puede derivarse autoritativamente de las " +
      "fuentes canónicas actuales. Se trata como contenido editorial curado y configurado, NO " +
      "como un indicador calculado en servidor. No es un cálculo fallido ni un bloqueo para la " +
      "importación canónica futura.",
  },
  "catalog-6-cri": {
    id: "catalog-6-cri",
    rank: 1,
    document: "docs/CALCULATION_CATALOG.md",
    section: "§6 — CRI",
    statement:
      "Media aritmética ponderada de los puntajes de riesgo sobre el total de respuestas válidas. " +
      "«no se calcula 100 − CRI». Zonas 0–30 segura, >30 y ≤60 alerta, >60 peligro.",
  },
  "catalog-7-retencion": {
    id: "catalog-7-retencion",
    rank: 1,
    document: "docs/CALCULATION_CATALOG.md",
    section: "§7 — Retención y deserción",
    statement:
      "«Retención (%) = ((miembros al final - miembros nuevos) / miembros al inicio) × 100»; " +
      "«Deserción (%) = (miembros perdidos / miembros al inicio) × 100». " +
      "«No existe un umbral universal de retención “buena”.»",
  },
  "catalog-9-cruces": {
    id: "catalog-9-cruces",
    rank: 1,
    document: "docs/CALCULATION_CATALOG.md",
    section: "§9 — Segmentación",
    statement: "«La documentación actual excluye específicamente Esfera × CRI».",
  },
  "catalog-2-ausencia": {
    id: "catalog-2-ausencia",
    rank: 1,
    document: "docs/CALCULATION_CATALOG.md",
    section: "§2 — Contratos comunes",
    statement:
      "«Una población sin respuestas válidas se representa como sin datos, nunca como un cero medido.» " +
      "«Una respuesta no válida se excluye tanto del numerador como del denominador, salvo que la " +
      "fórmula indique expresamente que esa categoría es el fenómeno medido.»",
  },
  "policy-rounding": {
    id: "policy-rounding",
    rank: 1,
    document: "docs/CALCULATION_POLICY.md",
    section: "§2-§4 — precisión y redondeo",
    statement:
      "Un solo helper `roundTo`, mitad alejándose de cero (paridad con ROUND() de Excel), " +
      "precisión declarada por unidad y cada valor redondeado EXACTAMENTE UNA VEZ; " +
      "`formatNumber` es la frontera de presentación.",
  },
  "workbook-csat-merged-bands": {
    id: "workbook-csat-merged-bands",
    rank: 2,
    document: "Datos limpio estudio Cuicuilco.xlsx",
    section: "hoja «CSAT», fila 1",
    statement:
      "Los únicos rangos combinados del libro son D1:BI1, BJ1:BU1, BV1:CO1 y CP1:DI1 sobre la " +
      "hoja CSAT. Esa banda combinada es la evidencia estructural del agrupamiento de los 55 " +
      "puntos de contacto en 4 categorías (29 / 6 / 10 / 10), y el orden de columnas de la fila 2 " +
      "es el orden de los puntos dentro de cada categoría.",
  },
  "workbook-csat-scale": {
    id: "workbook-csat-scale",
    rank: 2,
    document: "Datos limpio estudio Cuicuilco.xlsx",
    section: "hoja «SatisfacciónCSAT»",
    statement:
      "Seis opciones: 1, 2, 3 → Insatisfecho; 4, 5 → Satisfecho; " +
      "«No lo conozco/No lo he utilizado/No he interactuado» → Desconocimiento. " +
      "Es la única opción no numérica presente en el bloque CSAT.",
  },
  "workbook-nps-scale": {
    id: "workbook-nps-scale",
    rank: 2,
    document: "Datos limpio estudio Cuicuilco.xlsx",
    section: "hoja «Recomendación NPS»",
    statement:
      "Diez opciones, 1 a 10: 1–6 Detractor, 7–8 Pasivo, 9–10 Promotor. " +
      "El instrumento no ofrece un 0, lo que resuelve la discrepancia 0–10 / 1–10 del documento.",
  },
  "workbook-cohorts": {
    id: "workbook-cohorts",
    rank: 2,
    document: "Datos limpio estudio Cuicuilco.xlsx",
    section: "hojas «IDCliente», «Perfil Cliente», «Perfil Desertores»",
    statement:
      "60 identidades en el catálogo; 28 en la cohorte activa y 32 en la desertora, sin " +
      "solapamiento. La columna «Respuesta» de Perfil Desertores separa 11 que contestaron la " +
      "encuesta de salida de 21 que no participaron.",
  },
  "workbook-retencion": {
    id: "workbook-retencion",
    rank: 2,
    document: "Datos limpio estudio Cuicuilco.xlsx",
    section: "hoja «RetenciónDeserción»",
    statement:
      "Seis periodos con cuatro conteos cada uno (inicio, nuevos, final, perdidos) y dos tasas " +
      "almacenadas como literales a dos decimales. Las tasas se recalculan desde los conteos; " +
      "las almacenadas no se leen.",
  },
  "revised-journey-csv": {
    id: "revised-journey-csv",
    rank: 2,
    document: "Datos limpio estudio Cuicuilco.xlsx - Hoja 1.csv",
    section: "columna AC",
    statement:
      "El CSV revisado lleva la columna «Capitanes de Esfera» dos veces: en AC, cuyas 19 celdas " +
      "de datos son todas el token de error de hoja de cálculo #REF!, y en AW como " +
      "«Capitán de Esfera», poblada. El CSV es corroboración estructural del agrupamiento y NO " +
      "es fuente numérica; su columna rota queda excluida de todo cálculo y de toda salida.",
  },
  "approved-dashboard": {
    id: "approved-dashboard",
    rank: 3,
    document: "becommunity-bni-cuicuilco-demo @ a7248fdbccd139da80ed7c09daa70f006a62b9cf",
    section: "tablero aprobado por la dirección",
    statement:
      "Salida numérica y de presentación esperada. Su implementación no es autoridad de cálculo: " +
      "la adscripción de un punto de dolor a un punto de contacto se resuelve allí con una tabla " +
      "de alias escrita a mano en su propio script de construcción.",
  },
  "approved-dashboard-sin-supresion": {
    id: "approved-dashboard-sin-supresion",
    rank: 3,
    document: "becommunity-bni-cuicuilco-demo @ a7248fdbccd139da80ed7c09daa70f006a62b9cf",
    section: "src/lib/calc.ts — sampleState",
    statement:
      "«Sample size is REPORTED, never used to withhold a result… That policy has been removed at " +
      "the client's explicit instruction.» Decisión registrada: se publica el resultado de toda " +
      "población que exista, acompañado de su n exacta.",
  },
  "canonical-model-projection": {
    id: "canonical-model-projection",
    rank: 2,
    document: "docs/CANONICAL_STUDY_MODEL.md",
    section: "Unidad 3 — decisiones de mapeo",
    statement:
      "«`journeyEvidence` is empty for Cuicuilco v1 … nothing in the package states which metric " +
      "belongs to which journey stage, and inventing that association would put a fabricated " +
      "relationship in front of a consultant.»",
  },
};

export function authority(id: string): AuthorityReference {
  const found = AUTHORITIES[id];
  if (!found) throw new RangeError(`unregistered authority: ${id}`);
  return { id: found.id, document: found.document, section: found.section, statement: found.statement };
}

export function authorities(...ids: string[]): AuthorityReference[] {
  return ids.map(authority);
}
