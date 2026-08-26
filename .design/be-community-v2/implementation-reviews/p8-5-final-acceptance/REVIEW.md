# P8.5 — revisión final de experiencia

Estado: **automatización terminada; revisión humana en teléfono real pendiente**.

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

## Recorrido humano pendiente

En un teléfono físico, revisar una vez cada bloque. No hace falta comparar
capturas; importa que la experiencia se entienda y se pueda operar.

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

## Criterio de cierre

Marcar la fila humana como aprobada solo si no hay texto cortado, controles
inaccesibles, callejones sin salida ni pasos que requieran conocimiento técnico.
Registrar cualquier observación con ruta, rol y tamaño aproximado de pantalla.
