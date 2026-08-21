# Política de privacidad y calidad de resultados

> **Estado:** decisión de producto vigente desde el 20 de agosto de 2026.
>
> Esta política no modifica las fórmulas del catálogo. Decide cuándo un resultado
> puede mostrarse y cómo resolver entradas ambiguas de forma determinista.

## 1. Poblaciones pequeñas

Clasificación predeterminada para resultados de encuestas y celdas segmentadas:

| Base válida (`n`) | Estado | Presentación |
|---:|---|---|
| 0 | Sin datos | Mostrar “Sin datos”; nunca mostrar cero como resultado medido. |
| 1–4 | Suprimido | Ocultar valor, numerador, denominador y distribución; mostrar “Muestra insuficiente”. |
| 5–29 | Base pequeña | Mostrar el resultado y `n`, acompañado de una advertencia de cautela. |
| 30 o más | Estándar | Mostrar normalmente. |

Cinco es un **piso de privacidad**, no una garantía de anonimato ni de calidad
estadística. Una plantilla puede elevarlo por sensibilidad, pero no reducirlo
sin una evaluación de privacidad documentada.

La supresión se aplica después de cada combinación de filtros y también a:

- tarjetas KPI;
- cruces y pivotes;
- desgloses de promotores/pasivos/detractores;
- histogramas y porcentajes que permitan reconstruir un conteo pequeño.

La interfaz no debe revelar una celda suprimida por diferencia entre totales y
subtotales. Cuando sea necesario, debe agregar categorías, desactivar el filtro
o aplicar supresión secundaria.

Las citas y respuestas cualitativas requieren aprobación humana independiente;
cumplir `n ≥ 5` no autoriza automáticamente publicar texto libre.

### Fundamento

- ICO, guía de anonimización: valores pequeños —por ejemplo 1–5— elevan el
  riesgo de reidentificación y el estándar citado para anonimización fuerte usa
  `k=5`: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/how-do-we-ensure-anonymisation-is-effective/>
- ONS, control de divulgación: los exploradores y tablas personalizadas permiten
  ataques por diferencia y pueden requerir supresión a un mínimo más alto, como
  menos de cinco: <https://www.ons.gov.uk/methodology/methodologytopicsandstatisticalconcepts/disclosurecontrol/policyonprotectingconfidentialityintablesofbirthanddeathstatistics>
- ICO, código de anonimización: en encuestas, celdas por debajo de 30 también
  pueden ser poco útiles por error muestral; aquí se usa como advertencia de
  calidad, no como bloqueo: <https://ico.org.uk/media/for-organisations/documents/1061/anonymisation-code.pdf>

## 2. Registros duplicados

La ingesta debe preservar la fuente original y producir una decisión auditable.
Para un mismo identificador de participante:

1. se rechazan registros que no pasen la validación obligatoria;
2. gana la respuesta válida con la marca temporal más reciente;
3. si empatan, gana la que tenga más campos mapeados contestados;
4. si persiste el empate, gana la fila con mayor posición en el archivo fuente;
5. la bitácora registra las filas descartadas y el motivo, sin borrarlas del
   archivo original.

Si no existe una clave estable de participante, el sistema no debe deduplicar
por nombre aproximado automáticamente; debe solicitar una columna identificadora
o revisión humana.

## 3. Precisión visual

- valor predeterminado para NPS, CSAT, TDP, CRI, retención y deserción: un decimal;
- puntuaciones promedio: dos decimales;
- una plantilla puede declarar cero, uno o dos decimales cuando el entregable lo
  requiera, usando siempre la función canónica de redondeo;
- exportaciones y API entregan el mismo valor canónico mostrado, sin precisión
  oculta que contradiga la presentación.

## 4. Cruces con LTV

- habilitados por defecto: LTV × CRI y LTV × NPS;
- opcional por plantilla: LTV × CSAT;
- las combinaciones se controlan mediante una lista permitida de configuración;
- LTV no se clasifica universalmente como “alto” o “bajo”; el valor y cualquier
  umbral pertenecen a la configuración del estudio.

## 5. Referentes por sector

Una IA no puede convertir por sí sola una búsqueda en un umbral operativo. Todo
referente debe guardar al menos:

- valor o rango;
- sector, geografía, periodo y población comparable;
- URL/fuente y fecha de consulta;
- responsable que lo aprobó;
- fecha de próxima revisión.

Sin un referente aprobado, el sistema muestra el valor observado sin afirmar que
es bueno o malo y sin generar una alerta normativa.
