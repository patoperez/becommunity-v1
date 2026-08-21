# P6A — Backoffice de clientes y usuarios

El panel interno `/admin/clients` permite crear y renombrar tenants, invitar
usuarios cliente, reasignarlos y configurar su `data_scope`. El rol no se recibe
del formulario: todas las cuentas creadas por esta superficie son `client`.

Cada acción valida primero la sesión con el cliente Supabase normal y exige un
perfil `internal`. La llave `service_role` se instancia únicamente después de
esa comprobación y permanece en código de servidor.

Las invitaciones usan el flujo de correo de Supabase. La fila de perfil se
completa con `upsert` porque el proyecto remoto puede crear una fila mínima desde
un trigger de Auth. Si esa operación falla, la cuenta se elimina como
compensación. La eliminación
de una cuenta exige escribir su correo exacto y solo acepta perfiles `client`;
los estudios del tenant no se eliminan.

El alcance usa el mismo parser estricto de P5C. Un objeto vacío concede todos
los datos publicados del tenant; valores de una dimensión se combinan con OR y
dimensiones diferentes con AND.
