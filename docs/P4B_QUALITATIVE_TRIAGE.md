# P4B — Revisión cualitativa humana

## Principio de publicación

Los textos importados, las categorías de origen y las sugerencias automáticas son material interno. Ningún tema ni cita llega al portal del cliente hasta que una persona del equipo de Be Community lo confirma.

La migración `0008_qualitative_triage.sql` aplica este límite en la base de datos, no solo en la interfaz:

- revoca a `authenticated` el acceso directo a `qual_observation`;
- conserva el texto crudo y las sugerencias para operaciones internas con `service_role`;
- expone `confirmed_qual_observation`, que solo devuelve filas confirmadas del tenant autenticado;
- proyecta la cita como `null` salvo que `quote_approved` haya sido marcado por una persona;
- restringe el RPC de revisión exclusivamente a `service_role`.

## Flujo de la consultora

La ruta `/admin/qualitative` permite:

1. seleccionar un estudio;
2. generar una primera sugerencia determinista por palabras clave;
3. seleccionar una o varias observaciones;
4. aceptar su sugerencia, rechazarlas o asignarles un tema confirmado;
5. fusionar temas al reetiquetar varias filas con la misma categoría;
6. asociarlas opcionalmente a una etapa del journey;
7. aprobar cada cita por separado.

Las sugerencias son ayuda operativa, no decisiones automáticas. La acción de revisión vuelve a validar sesión, rol interno, estudio, identificadores y tamaño del lote en el servidor; el RPC repite las comprobaciones críticas y actualiza el lote atómicamente.

## Gates

- `npm run test:qualitative`: heurísticas y contratos estáticos de seguridad.
- `npm run test:qualitative-live`: prueba contra Supabase de denegación del texto crudo, invisibilidad de pendientes, confirmación humana, aprobación separada de cita, rechazo del RPC al cliente y aislamiento cruzado.
- `npm run test:isolation`: incluye la vista publicada en pruebas anónimas y cross-tenant y comprueba que la tabla cruda sea interna.
