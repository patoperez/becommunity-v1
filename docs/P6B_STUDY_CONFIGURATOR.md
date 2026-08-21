# P6B — Configuración y publicación de estudios

El backoffice de estudios controla el ciclo `draft | published | archived`, las
secciones visibles del portal y las etapas del journey. Un estudio sin respuestas
cuantitativas ni hallazgos cualitativos confirmados no se puede publicar.

`dashboard_config` usa un contrato versionado con banderas para panorama,
tendencias, filtros, journey, cualitativos, métricas, cruces, pivote e informe.
Los estudios antiguos o una configuración inválida conservan todas las secciones
por compatibilidad. Una configuración válida se aplica en el servidor antes de
serializar el dashboard, también durante recálculos filtrados.

El endpoint PDF responde 404 cuando el informe está desactivado y respeta las
secciones de métricas, journey, segmentos y cualitativos. Cuando los filtros
están desactivados, parámetros construidos manualmente no modifican el informe.

El journey acepta hasta 30 etapas con identificadores únicos y estables. Cada
etapa define etiqueta, clave métrica canónica y descripción opcional. El mismo
parser estricto alimenta portal, recálculo y PDF; una definición dañada falla
cerrada sin romper la vista.
