# P2 — Ingesta universal

> **Estado:** P2A implementa el núcleo puro; persistencia versionada, confirmación
> atómica e interfaz visual permanecen pendientes en incrementos separados.

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

- migración para firmas, mapeos, recodificaciones e historial de importación;
- RLS y privilegios least-privilege en cada tabla nueva;
- RPC/transacción para que confirmación y rollback sean atómicos;
- prueba adversarial contra Supabase: error deliberado = cero filas residuales.

### P2C — interfaz del centro de importación

- subir y analizar sin escribir;
- mapeador visual con muestras de valores;
- reutilización automática por firma;
- previsualización, errores y confirmación explícita;
- historial y rollback del último import confirmado.

P2 no se considerará cerrado hasta que P2A–P2C pasen la compuerta completa.
