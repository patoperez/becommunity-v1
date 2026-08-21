# P2 — Ingesta universal

> **Estado:** P2A–P2C implementados y verificados en `be-community-dev`.
> Migraciones `0003`–`0005` aplicadas. P2 está cerrado funcionalmente.

## Objetivo de aceptación de P2

Un archivo crudo de Forms nunca visto debe poder importarse sin editarlo. Un
archivo corrupto debe producir errores claros por fila y dejar cero residuos.

## P2A — núcleo de mapeo y recodificación

- Los encabezados ya no necesitan prefijos `seg_`, `q_` o `qual_`.
- Cada columna se asigna a segmento, métrica cuantitativa, texto cualitativo o
  se ignora explícitamente.
- Una firma SHA-256 estable identifica el conjunto de encabezados aun si cambia
  su orden, capitalización o espacios exteriores.
- Las tablas de recodificación son configuración versionada: por ejemplo,
  “Muy satisfecho” → 5.
- Métricas admiten obligatoriedad y rangos mínimo/máximo.
- Los errores conservan fila y columna y se recogen todos antes de aceptar el
  paquete.
- La vista previa es pura: no recibe cliente de base de datos ni puede escribir.

El formato V1 por prefijos sigue disponible durante la transición.

## Incrementos

### P2B — almacenamiento y seguridad

- `import_mapping`, `recoding_table` e `import_batch` conservan versiones e
  historial sin exponerlos a cuentas de navegador;
- RLS forzado, política de denegación explícita y privilegios revocados para
  `anon` y `authenticated` en cada tabla interna;
- `commit_import_batch` valida el paquete y escribe encuestados, cuantitativos y
  cualitativos dentro de una sola transacción;
- `rollback_import_batch` elimina únicamente las filas selladas con el lote;
- la aplicación ya no tiene fallback de escrituras directas a tablas de
  respuestas.

La compuerta local revisa el contrato y el parche SQL. La compuerta remota
confirmó que un error deliberado deja cero filas de respuesta; un lote válido se
confirma y su rollback elimina solo sus propias filas. El test de aislamiento
confirmó además que clientes y anónimos no acceden a tablas ni RPC internos.

### P2C — interfaz del centro de importación

- el paso de análisis lee y muestra encabezados/muestras sin escribir;
- el mapeador permite ignorar, segmentar, crear métricas o texto cualitativo,
  marcar campos obligatorios, imponer rangos y definir recodificaciones;
- una firma reconoce automáticamente instrumentos ya configurados;
- la migración `0005` guarda nuevas versiones del mapeo de forma atómica y
  reutiliza la versión activa cuando la configuración no cambió;
- la vista previa vuelve a validar el archivo y muestra conteos y cinco filas;
- la confirmación exige aceptación explícita y vuelve a parsear/validar antes de
  llamar al commit transaccional de P2B;
- el historial muestra los últimos 30 lotes y solo permite revertir el último
  lote todavía confirmado.

La prueba en navegador recorrió análisis → mapeo → preview → confirmación real →
historial → rollback. El estudio, lote y mapeo sintéticos se eliminaron después,
con cero residuos. La compuerta remota probó además que `anon` no puede guardar
mapeos y que una modificación crea la siguiente versión dejando una sola activa.
