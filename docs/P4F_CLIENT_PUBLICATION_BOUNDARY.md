# P4F — Frontera de publicación y datos crudos

## Hallazgo

P4E eliminó las respuestas individuales del payload de React, pero el rol
`authenticated` todavía conservaba `SELECT` directo sobre `respondent` y
`quant_response`. Un cliente podía usar la API pública de Supabase con su sesión
y reconstruir la base, aunque la interfaz no ofreciera esa descarga.

También coexistía una política histórica que mostraba estudios `draft`, y la
restricción remota de estados no aceptaba `published`.

## Cierre

- El cliente solo puede leer metadata de estudios con estado `published`.
- El personal interno puede leer metadata de todos los estados.
- `respondent`, `quant_response`, `qual_observation`, `segment_dimension`,
  `journey_definition` y la vista cualitativa por fila no tienen acceso directo
  para `anon` ni `authenticated`.
- Dashboard, Server Actions y PDF llaman a `loadAuthorizedStudyData`.
- Ese loader consulta primero `study` con la sesión del request y RLS. Solo si
  existe una fila autorizada crea el cliente server-only y carga ese ID exacto.
- Las citas siguen requiriendo `review_status = confirmed` y
  `quote_approved = true`.
- El ciclo canónico del estudio es `draft | published | archived`.

## Prueba viva

La suite crea un estudio temporal y comprueba:

1. `draft` no aparece al cliente;
2. `published` sí aparece al cliente de su tenant;
3. las superficies por fila responden `42501`, incluso después de publicar;
4. otro tenant no ve el estudio;
5. la revisión humana y la aprobación separada de citas permanecen operativas.
