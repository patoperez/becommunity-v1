# Sistema de plantillas de estudios (P3)

## Alcance

P3 implementa el mecanismo genérico de plantillas. La biblioteca inicial con
plantillas de negocio reales pertenece a V2.5 y solo se poblará con definiciones
documentadas; esta fase no inventa fórmulas ni contenido de consultoría.

## Contrato de copia

Al crear un estudio desde una plantilla, `instantiate_study_template` copia el
`payload` completo a `study.template_snapshot` y registra el identificador y la
versión de origen. El estudio usa su propia instantánea, su
`dashboard_config`, su `journey_definition` y sus filas de configuración. Nunca
consulta la versión vigente de la plantilla durante su uso normal.

Por lo tanto:

- actualizar o eliminar una plantilla no modifica estudios existentes;
- sobrescribir una plantilla incrementa `version` atómicamente;
- una nueva instancia recibe la versión vigente en ese momento;
- la biblioteca es personal para cada usuario interno (`created_by`).

## Contenido permitido

El esquema `TemplatePayload` admite únicamente:

- claves de métricas;
- definiciones y jerarquía de dimensiones de segmentación;
- tablas de recodificación;
- firmas y asignaciones de mapeos de columnas;
- definición del journey;
- configuración del dashboard;
- nombres de categorías cualitativas.

El recolector nunca selecciona valores de `quant_response`, segmentos de
respondientes ni citas de `qual_observation`. Esos datos no forman parte de una
plantilla.

## Seguridad

`study_template` fuerza RLS y revoca todos los privilegios a `anon` y
`authenticated`. Las funciones de guardado e instanciación solo son ejecutables
por `service_role`; además, la aplicación revalida en el servidor que la sesión
pertenece a un perfil `internal`. Las funciones también verifican que el dueño
registrado sea un perfil interno.

La instantánea y la procedencia guardadas en `study` contienen configuración
interna. La migración `0007` sustituye el permiso amplio de lectura por una
lista explícita de columnas seguras para clientes. Las columnas visibles del
portal siguen protegidas por RLS, pero `template_snapshot` y
`template_origin_*` no se pueden solicitar con el rol `authenticated`.

## Verificación

- `npm run test:templates`: esquema, exclusión de datos, resumen y copia profunda.
- `npm run test:templates-live`: prueba transaccional contra Supabase; crea una
  plantilla v1, instancia un estudio, avanza la plantilla a v2, verifica que la
  instantánea del estudio siga en v1 y elimina los datos temporales.
- `npm run test:isolation`: confirma que clientes y anónimos no pueden leer la
  biblioteca ni ejecutar sus RPC.
