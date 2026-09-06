# Catálogo de cálculos de Be Community

> **Estado:** reglas de negocio confirmadas al 19 de agosto de 2026, con la
> corrección del denominador del TDP y la resolución de Esfera × CRI
> registradas por la propiedad metodológica el 6 de septiembre de 2026 (§5, §9).
>
> Este documento es la fuente autoritativa para las métricas propias de Be
> Community. `CALCULATION_POLICY.md` gobierna precisión y redondeo; este catálogo
> gobierna significado, población, fórmula y exclusiones.

## 1. Precedencia de fuentes

Cuando dos materiales históricos difieran, se aplica este orden:

1. confirmación explícita más reciente de la responsable metodológica;
2. documentación integral del proceso;
3. resultados numéricos verificables de los tableros históricos;
4. fórmulas históricas de Excel/Power Pivot;
5. comportamiento legado del software.

Power Pivot sirve como evidencia de auditoría, no como autoridad por encima de
una corrección metodológica posterior.

## 2. Contratos comunes

- Todos los indicadores se recalculan sobre la población que permanece después
  de aplicar los filtros permitidos para el KPI.
- Una respuesta no válida se excluye tanto del numerador como del denominador,
  salvo que la fórmula indique expresamente que esa categoría es el fenómeno
  medido (por ejemplo, Desconocimiento en TDP).
- Una población sin respuestas válidas se representa como **sin datos**, nunca
  como un cero medido.
- Los agregados se calculan con valores sin redondear y se redondean una sola vez
  conforme a `CALCULATION_POLICY.md`.

## 3. NPS — Net Promoter Score

**Entrada:** una respuesta obligatoria entera de 1 a 10.

| Categoría | Respuesta |
|---|---:|
| Detractor | 1–6 |
| Pasivo | 7–8 |
| Promotor | 9–10 |

```text
NPS = ((promotores / total válido) - (detractores / total válido)) × 100
    = ((promotores - detractores) / total válido) × 100
```

Los pasivos no suman como promotores ni detractores, pero **sí permanecen en el
denominador**. Esta interpretación reproduce el resultado histórico verificable:
24 promotores, 3 pasivos y 2 detractores producen `75.862…`, no `84.615…`.

Vacíos, “No aplica” y valores fuera de 1–10 se excluyen. Rango del resultado:
−100 a 100.

Bandas de presentación:

- verde: 80 a 100;
- amarillo: 60 a menos de 80;
- rojo: menos de 60 (incluye valores negativos).

## 4. CSAT por punto de contacto

**Entrada:** una respuesta de 1 a 5 para un único punto de contacto.

```text
CSAT = (respuestas 4 o 5 / respuestas válidas 1–5) × 100
```

- 4–5: satisfecho, forman el numerador;
- 1–3: insatisfecho, no forman el numerador pero **sí el denominador**;
- “No lo conozco”, “No lo he utilizado”, “No he interactuado”, “No aplica” y
  equivalentes: se excluyen del CSAT.

CSAT se calcula y presenta **por punto de contacto**. No existe un CSAT general
obtenido promediando puntos de contacto.

Bandas de presentación:

- verde: 75 a 100;
- amarillo: 60 a menos de 75;
- rojo: menos de 60.

## 5. TDP — Tasa de Desconocimiento de Proceso

TDP acompaña a cada punto de contacto evaluado mediante CSAT.

```text
TDP = (respuestas de desconocimiento / respuestas válidas satisfechas e insatisfechas) × 100
```

El denominador es la **base válida** del punto: las respuestas que expresaron
satisfacción o insatisfacción. **Excluye** las respuestas de desconocimiento,
que son el numerador. Por ejemplo, siete respuestas numéricas y tres de
desconocimiento producen `3 / 7 = 42.9%`.

Dos consecuencias son deliberadas y no deben “corregirse”:

- **el resultado puede superar 100 %.** Un proceso que cuatro personas
  pudieron evaluar y veinte nunca conocieron da 500 %, y ésa es la lectura
  honesta de un proceso que casi nadie ha encontrado. Acotarlo borraría
  justamente los casos que la medida existe para mostrar;
- **sin base válida no hay tasa**, nunca un cero medido. El numerador se
  conserva, de modo que puede decirse “nadie pudo evaluarlo, y N personas
  declararon no conocerlo”.

“No lo conozco”, “No lo he utilizado”, “No he interactuado” y “No aplica” son
variantes configurables de la categoría Desconocimiento.

La documentación integral no define bandas para este indicador, así que el
modelo canónico no emite ninguna.

Implementación canónica: `processUnawarenessTdp`
(`src/lib/calc/business-metrics.ts`).

### Cantidad auxiliar — proporción de desconocimiento sobre las respuestas

```text
Proporción de desconocimiento = (respuestas de desconocimiento / todas las respuestas clasificadas del punto) × 100
```

Ésta **no es el TDP** y no debe llamarse así en ninguna superficie. Es el
complemento del “% que conoce” del gráfico apilado de §7.1 de la documentación
integral, que sólo cierra en cien con este denominador, y por eso se conserva
como cantidad auxiliar útil. Está acotada entre 0 y 100, nunca sustituye al
TDP, y su denominador debe permanecer explícito allí donde se publique.

Implementación canónica: `unawarenessShareOfResponses`.

### Corrección registrada — 6 de septiembre de 2026

Hasta esa fecha esta sección definía el TDP con el **otro** denominador (sobre
todas las respuestas del punto), en contradicción con §4.1 de la documentación
integral y con el tablero aprobado por la dirección, que calculan la razón
sobre la base válida. El modelo canónico emitía ambas cantidades y registraba
el desacuerdo como conflicto de autoridad abierto, sin elegir ganador.

**La propiedad metodológica lo resolvió:** el indicador oficial llamado TDP es
la razón de §4.1. Esta sección queda corregida en consecuencia; la otra
cantidad permanece disponible bajo un nombre descriptivo propio. Ninguna
fórmula se cambió para que un número cuadrara, y ningún resultado aprobado se
movió: la paridad dorada seguía en 531 de 531 antes y después de la
corrección. Detalle en `docs/CANONICAL_RESULTS_MODEL.md` §3.

### Nota de reconciliación — “No aplica” como categoría y como ausencia

El clasificador canónico de valores (`src/lib/ingestion/canonical-package/values.ts`)
convierte el token “No aplica” en el estado de ausencia `not_applicable` antes de
que cualquier columna se lea, de modo que ese texto nunca llega como respuesta.
Para Cuicuilco eso no altera el CSAT — la única opción no numérica del bloque de
satisfacción es “No lo conozco/No lo he utilizado/No he interactuado”, y “No
aplica” no aparece ahí — pero sí afecta a la columna de razón de riesgo, donde
“No aplica” es una categoría documentada. El conteo se recupera desde el estado
de ausencia, lo cual es exacto: sólo ese token mapea a ese estado.

## 6. CRI — Índice de Riesgo de Abandono

La pregunta mide qué tan probable es renovar, reinscribirse, regresar o volver a
comprar. Por eso una menor intención de continuar representa mayor riesgo.

| Respuesta | Puntos de riesgo |
|---|---:|
| Nada probable | 100 |
| Poco probable | 75 |
| Algo probable | 50 |
| Muy probable | 25 |
| Extremadamente probable | 0 |

```text
CRI = (
  100 × N_nada +
   75 × N_poco +
   50 × N_algo +
   25 × N_muy +
    0 × N_extremadamente
) / total de respuestas válidas
```

El resultado es directamente el porcentaje/puntaje agregado de riesgo; no se
calcula `100 − CRI`. La pregunta es obligatoria en las plantillas documentadas,
pero el motor conserva el contrato “sin datos” si no hay respuestas válidas.

Bandas agregadas:

- 0–30: Zona segura;
- mayor de 30 y hasta 60: Zona de alerta;
- mayor de 60: Zona de peligro.

La distribución por las cinco categorías puede mostrarse aparte como histograma.

## 7. Retención y deserción

Para cada periodo configurado por el estudio:

```text
Retención (%) =
  ((miembros al final - miembros nuevos) / miembros al inicio) × 100

Deserción (%) =
  (miembros perdidos / miembros al inicio) × 100
```

El periodo puede ser ciclo escolar, semestre, año u otro intervalo definido por
el cliente. Con datos consistentes, ambas tasas son complementarias. El motor
debe rechazar conteos negativos o poblaciones internamente imposibles en lugar
de publicar un porcentaje engañoso.

No existe un umbral universal de retención “buena”. Cualquier referente por
sector debe registrar fuente y fecha, y requiere aprobación humana antes de
convertirse en alerta.

## 8. LTV

LTV es un dato financiero proporcionado por la organización para cada persona;
Be Community no lo recalcula. Se utiliza como dimensión cuantitativa en cruces.

Los cruces LTV × CRI y LTV × NPS están documentados. LTV × CSAT puede habilitarse
por plantilla; no es una fórmula nueva y no debe quedar codificado como una
obligación universal.

## 9. Segmentación

Las dimensiones permitidas pertenecen a la configuración de la plantilla. El
resultado siempre se recalcula dentro del segmento filtrado. La documentación
actual excluye específicamente **Esfera × CRI**; las demás combinaciones deben
pasar por la lista permitida de la plantilla, no construirse libremente en código.

> **RESUELTO — 6 de septiembre de 2026.** El tablero aprobado por la dirección
> ofrece `esfera` como dimensión de filtro del CRI; la documentación integral
> §5.2 dice «OJO: La esfera no se debe cruzar en este KPI». La propiedad
> metodológica confirmó que §5.2 es autoritativa y que el tablero de emergencia
> es una desviación del tablero de referencia, no una anulación metodológica.
> **Esfera no se permite como filtro ni como cruce de segmentación del CRI.** El
> modelo canónico rechaza el cruce con `cross_not_permitted` citando la
> autoridad, en lugar de calcular un número que una autoridad prohíbe, y no
> publica distribución ni base alguna calculada sobre ese cruce.

## 10. Políticas de producto

Muestra mínima, supresión por privacidad, duplicados, precisión visual, cruces
con LTV y referentes externos quedaron definidos en
`docs/PRODUCT_DATA_POLICY.md`. Son contratos técnicos y no requieren otra ronda
de preguntas metodológicas.
