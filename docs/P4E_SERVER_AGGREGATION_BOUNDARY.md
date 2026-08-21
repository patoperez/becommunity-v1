# P4E - Frontera segura de agregacion

## Hallazgo

La primera implementacion de filtros y pivotes enviaba filas cuantitativas y observaciones confirmadas al componente cliente para recalcular en memoria. La interfaz no ofrecía una descarga de la base, pero un usuario podia inspeccionar esas filas en el payload de React. Esto contradecia la decision de negocio de no entregar respuestas crudas al cliente.

## Correccion

- El Server Component carga filas mediante la sesion Supabase y las transforma antes de serializar React.
- `StudyCard`, `JourneyMap`, `QualitativeInsights` y `PivotExplorer` reciben exclusivamente DTOs agregados y suprimidos.
- Los filtros siguen siendo interactivos, pero una Server Action autenticada vuelve a consultar bajo RLS y devuelve solo el nuevo agregado.
- El pivote valida filtros, dimensiones, metricas y agregaciones en el servidor. Las celdas con `n=1-4` eliminan valor y `n` antes de cruzar la frontera.
- Identificadores de encuestado y de observacion nunca forman parte del payload cliente.
- Las citas siguen apareciendo solo cuando fueron aprobadas independientemente en P4B.

## Gate

`npm run test:client-boundary` prueba la ausencia de IDs/campos de fila, la supresion antes de serializar y la autenticacion/RLS de las acciones interactivas.
