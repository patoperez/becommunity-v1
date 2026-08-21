# Catálogo de cálculos de Be Community

> **Estado:** reglas de negocio confirmadas al 19 de agosto de 2026.
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
TDP = (respuestas de desconocimiento / total de respuestas del punto) × 100
```

El denominador incluye respuestas satisfechas, insatisfechas y de
desconocimiento. Por ejemplo, siete respuestas numéricas y tres de
desconocimiento producen `3 / 10 = 30%`, no `3 / 7`.

“No lo conozco”, “No lo he utilizado”, “No he interactuado” y “No aplica” son
variantes configurables de la categoría Desconocimiento.

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

## 10. Políticas de producto

Muestra mínima, supresión por privacidad, duplicados, precisión visual, cruces
con LTV y referentes externos quedaron definidos en
`docs/PRODUCT_DATA_POLICY.md`. Son contratos técnicos y no requieren otra ronda
de preguntas metodológicas.
