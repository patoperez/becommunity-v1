# P8.5 — revisión final de experiencia

Estado: **aceptado por automatización y por la revisión humana en teléfono real;
P8 cerrado el 2026-08-27**.

No se generaron screenshots. La revisión automatizada abre el producto real con
sesiones de cliente y equipo interno, y mide directamente lo que renderiza.

## Lo que ya verifica el producto

- 320, 360, 390, 768, 1024 y 1280 px.
- Sin desplazamiento horizontal de página ni texto cortado.
- Sin identificadores duplicados, imágenes sin alternativa o gráficos sin
  nombre accesible.
- Controles con un área activa mínima de 24 × 24 px; acciones principales usan
  el objetivo de 44 px del sistema.
- “Saltar al contenido” es el primer destino de teclado.
- Movimiento reducido, foco visible, navegación por teclado de hallazgos,
  recorrido, gráficas y confirmaciones.
- Estados de carga, vacío, error, no encontrado y sin permiso con salida clara.
- Lenguaje ordinario: el equipo no ve JSON, claves internas ni “pivote”.

## Recorrido humano completado

El propietario revisó el producto en un teléfono físico. No se usaron capturas
como sustituto de la interacción: se operaron las vistas reales por la dirección
LAN del servidor de desarrollo.

### Cliente

1. Entrar como cliente A y abrir **Insights**.
2. Abrir el estudio, cambiar un filtro, recorrer los hallazgos y el journey.
3. Abrir “Cómo se calcula”, la comparación y la tabla alternativa de evolución.
4. Si el estudio incluye cualitativo, abrir la nube de palabras y comprobar que
   la lista con cantidades sigue disponible.
5. Entrar como cliente B y confirmar que el estado sin estudios se entiende y
   no parece una entrega incompleta.

### Equipo de Be Community

1. Abrir Studio y entrar a un estudio existente.
2. Recorrer Datos → Indicadores → Cualitativo → Interpretación → Vista del
   cliente → Publicar usando solo los controles visibles.
3. Cerrar el aviso pegajoso de vista previa y confirmar que **Volver al estudio**
   permanece disponible.
4. Abrir Clientes y Plantillas; comprobar que cada pantalla conserva una salida
   clara y que ninguna tarea pide sintaxis técnica.
5. Abrir una confirmación destructiva solo hasta el diálogo; cancelar con Escape
   y comprobar que el foco vuelve al botón que lo abrió. No ejecutar la acción.

## Resultado y criterio de cierre

La primera pasada detectó tres problemas reales: los componentes React no
respondían en la revisión LAN por el bloqueo de orígenes de desarrollo de Next,
la fila de cuenta se amontonaba en móvil y la escala relativa del journey no
explicaba sus extremos. `8a4437a` habilitó explícitamente el origen LAN de
revisión mediante `DEV_ALLOWED_ORIGINS`, corrigió la fila de cuenta y mantuvo
los controles de ciclo de vida legibles. `b49df5d` cambió los extremos por
“Más bajo” y “Más alto”.

Después de esas correcciones, el propietario volvió a probar la experiencia y
la aceptó el 2026-08-27 con “todo perfecto”. No quedaron texto cortado,
controles inaccesibles, callejones sin salida ni pasos que requieran conocimiento
técnico. La matriz humana queda aprobada y P8 se considera cerrado.

El fixture revisado no mostraba una nube de palabras cualitativa, así que este
registro no inventa una validación visual humana de ese estado. Su lista contada
alternativa, nombre accesible y estructura responsive sí están cubiertos por los
gates; el propietario decidió no condicionar el cierre de P8 a otra carga de
contenido sintético.
