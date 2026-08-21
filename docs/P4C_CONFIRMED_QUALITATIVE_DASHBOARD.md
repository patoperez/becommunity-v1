# P4C — Cualitativos confirmados en dashboard y journey

## Fuente única

El portal consulta exclusivamente `confirmed_qual_observation`, la superficie segura creada en P4B. El navegador nunca recibe texto crudo, sugerencias, estados de revisión ni citas sin aprobar.

## Filtros compartidos

Cada observación confirmada hereda en el servidor las dimensiones de su encuestado. Los mismos filtros globales de P4A se aplican a indicadores cuantitativos, temas, citas y etapas del journey.

- Sin filtros, también pueden aparecer observaciones confirmadas sin `respondent_id`.
- Con filtros activos, esas observaciones se excluyen porque no existe evidencia para asignarlas al segmento elegido.
- Las claves propias del cualitativo (`theme`, `quote`, `stage_key`, etc.) no se convierten accidentalmente en filtros de segmento.

## Privacidad de temas y citas

- El conteo de un tema representa menciones.
- Su base `n` se calcula con unidades distintas: encuestados distintos o, cuando no existe vínculo, observaciones distintas.
- `n=1–4` oculta identidad y magnitud del tema.
- `n=5–29` muestra una advertencia de base pequeña.
- Las citas aparecen únicamente si fueron aprobadas en P4B.
- Si el tema de una cita tiene base suprimida, la cita aprobada puede mostrarse pero su etiqueta temática no se revela.

## Journey

El detalle de cada etapa conserva sus métricas cuantitativas y añade los temas/citas confirmados cuyo `stage_key` coincide con el identificador de la etapa. El resumen general del estudio muestra los confirmados con o sin etapa.

## Gate

`npm run test:confirmed-qualitative` verifica conteos, bases distintas, supresión, cautela, citas aprobadas y filtrado compartido.
