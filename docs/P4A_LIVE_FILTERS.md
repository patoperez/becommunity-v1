# P4A — Filtros globales en vivo

## Alcance

P4A incorpora filtros de segmento compartidos por estudio. Las opciones se derivan exclusivamente de filas consultadas bajo RLS y todas las visualizaciones visibles se recalculan en conjunto.

> **Actualizacion P4E:** la primera version recalculaba con filas serializadas al navegador. La frontera fue endurecida para cumplir la prohibicion de entregar respuestas crudas: ahora una Server Action autenticada recalcula bajo RLS y devuelve exclusivamente agregados ya suprimidos. Consulte `P4E_SERVER_AGGREGATION_BOUNDARY.md`.

- indicadores principales (NPS, CSAT y promedios);
- cruces por segmento;
- mapa de experiencia;
- tabla dinámica validada.

Las dimensiones no están codificadas de forma fija. El catálogo admite nivel, grado, grupo, género, rango de edad y cualquier dimensión personalizada presente en el esquema canónico del estudio.

## Contrato de filtrado

- Las selecciones se combinan con lógica `AND` entre dimensiones.
- Cada dimensión y valor se valida contra un catálogo generado desde los datos RLS del estudio.
- Una dimensión o valor desconocido se rechaza antes del cálculo.
- La ausencia de filtros conserva las filas de entrada sin modificarlas.
- Una combinación válida sin coincidencias presenta un estado vacío explícito.

## Privacidad posterior al filtro

La política de `docs/PRODUCT_DATA_POLICY.md` se vuelve a aplicar después de cada cambio:

- `n = 0`: sin datos;
- `n = 1–4`: resultados suprimidos y tamaño exacto oculto;
- `n = 5–29`: resultados visibles con advertencia de base pequeña;
- `n >= 30`: visualización estándar.

La supresión también se evalúa en cada indicador, fila de cruce, etapa del journey y celda del pivote. Las celdas suprimidas no participan en las barras comparativas, evitando que su magnitud se infiera visualmente.

## Verificación

`npm run test:bi-filters` comprueba:

- catálogo estable de dimensiones y valores;
- combinación de dos filtros;
- recálculo de encuestados, NPS y promedio;
- preservación de entrada sin filtros;
- combinación válida vacía;
- rechazo de dimensiones y valores fuera del catálogo.

`scripts/pivot-test.mjs` comprueba además el tamaño de muestra asociado a cada celda del pivote.
