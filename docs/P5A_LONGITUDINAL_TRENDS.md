# P5A — Memoria longitudinal segura

El portal compara indicadores entre estudios del mismo tenant usando la clave
canónica del indicador, no el texto visible de la pregunta. Por ello un cambio de
redacción no rompe una serie mientras la importación conserve `metric_key`.

## Reglas

- Los estudios se ordenan por `created_at`; `period` es la etiqueta visible.
- Un indicador nuevo conserva huecos explícitos en periodos anteriores.
- NPS, CSAT y promedios reutilizan exclusivamente el motor canónico existente.
- Cada punto aplica la política de divulgación de forma independiente.
- Con `n` entre 1 y 4 no se serializan ni valor ni conteo exacto.
- Con `n` entre 5 y 29 el punto aparece con advertencia de cautela.
- El Client Component recibe solamente series agregadas: nunca filas, segmentos,
  identificadores de personas ni IDs internos de estudios.
- La vista se oculta para cuentas internas, que pueden alcanzar más de un tenant.
  El backoffice futuro exigirá seleccionar un cliente antes de construir historia.

P5A no crea benchmarks entre clientes ni nuevas fórmulas de negocio. Esas
capacidades requieren una fase independiente y controles de anonimización.
