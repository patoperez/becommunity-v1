# P2 — Ingesta universal

> **Estado:** P2A y P2B implementados. Migraciones `0003` y `0004` aplicadas y
> verificadas en `be-community-dev` el 20 de agosto de 2026. La interfaz visual
> P2C permanece pendiente.

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

## Incrementos restantes

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

- subir y analizar sin escribir;
- mapeador visual con muestras de valores;
- reutilización automática por firma;
- previsualización, errores y confirmación explícita;
- historial y rollback del último import confirmado.

P2 no se considerará cerrado hasta que P2A–P2C pasen la compuerta completa.
