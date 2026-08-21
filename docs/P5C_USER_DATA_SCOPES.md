# P5C — Alcance de datos por usuario

Varios usuarios pueden pertenecer al mismo tenant. Por defecto todos consultan
los estudios publicados completos. Opcionalmente, `profiles.data_scope` limita
una cuenta a valores de segmentos canónicos:

```json
{ "area": ["Direccion"], "nivel": ["Primaria", "Secundaria"] }
```

Los valores de una dimensión se combinan con OR; dimensiones distintas, con
AND. Un objeto vacío significa acceso completo al tenant. Una configuración
inválida falla cerrada.

El alcance se obtiene de la fila `profiles` del usuario bajo RLS y se aplica en
`loadAuthorizedStudyData`, antes de cualquier agregado. Por ello afecta de forma
uniforme portada narrativa, tendencias, filtros, pivote, journey, cualitativos y
PDF. Las tablas por fila siguen sin acceso directo desde el navegador.

P6 incorporará la interfaz interna para crear usuarios y editar este alcance;
P5C entrega el contrato y su enforcement.
