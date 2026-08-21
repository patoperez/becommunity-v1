# Preguntas para el Catálogo de Cálculo — Be Community

> Estas preguntas surgieron al revisar `Documentacion_Integral_Proceso_Be_Community`
> y los archivos de Excel del estudio. **El documento ya aporta muchísimo**: las
> tablas de recodificación (CSAT, NPS, Generaciones), las bandas de color, CRR, CR
> y la escala de puntos del CRI quedaron perfectamente claras y ya se pueden
> implementar.
>
> Faltan sólo **6 puntos** para poder programar los indicadores sin inventar nada.
> Cada número que la plataforma muestre a un cliente debe salir de una regla suya,
> no de una suposición nuestra — por eso preferimos preguntar.

---

### 1. CSAT — denominador exacto

En §4.1 la fórmula dice *"respuestas positivas (4 y 5) entre el **total de
respuestas obtenidas** × 100"*, y luego *"las calificaciones del 1 al 3 … se
excluyen de la fórmula"*.

Queremos confirmar cuál de estas dos interpretaciones es la correcta:

- **(a)** CSAT = (4 y 5) / (**Satisfecho + Insatisfecho**) × 100 → es decir, los
  1–3 **sí** cuentan en el denominador, y sólo se excluye "No lo conozco / No lo
  he utilizado / No he interactuado" (Desconocimiento / No aplica).
- **(b)** Otra forma distinta.

*(Lo preguntamos porque, si los 1–3 se excluyeran también del denominador, el CSAT
siempre daría 100%. La fórmula del TDP sugiere la opción (a), pero preferimos que
usted lo confirme.)*

**En una frase:** ¿el denominador del CSAT son todas las respuestas **menos** las
de "No lo conozco/No aplica"?

---

### 2. CRI — cómo se combinan los puntajes

Los puntajes por respuesta están claros (Nada = 100, Poco = 75, Algo = 50,
Muy = 25, Extremadamente = 0), y también las zonas (0–30 Segura, 31–60 Alerta,
+60 Peligro).

Lo que no aparece es **cómo se obtiene el puntaje único del estudio** a partir de
las respuestas individuales:

- ¿Es el **promedio** de los puntajes de todos los encuestados?
- ¿Es la **suma**? ¿Un porcentaje de personas en cierto nivel de riesgo?
- ¿Se excluye a alguien (por ejemplo, quien contestó "No aplica")?

---

### 3. NPS — escala y denominador

Dos detalles:

- **Escala:** la tabla de recodificación va de **1 a 10**, pero en §4.1 se
  menciona *"Detractores: 0 a 6"*. ¿La encuesta pregunta de **0 a 10** o de
  **1 a 10**?
- **Pasivos:** el documento dice *"los pasivos se excluyen de la fórmula"*.
  ¿Significa que los pasivos **no se suman como promotores ni como detractores**
  (pero **sí** cuentan en el total de encuestados para sacar los porcentajes), o
  que se sacan **por completo** del cálculo?

*Ejemplo para aterrizarlo:* con 10 respuestas — 5 promotores, 3 pasivos, 2
detractores — ¿el NPS es **30** (50% − 20%, pasivos dentro del total) o **43**
(5/7 − 2/7, pasivos fuera)?

---

### 4. Limpieza de datos — paso a paso

En §3.1 quedó anotado *"no tengo lenguaje para simplificar la descripción de lo
que hice para limpiar la base… podríamos grabar una reunión"*. **Nos parece la
mejor idea**: con 20–30 minutos de pantalla compartida sobre la base de BNI
(mostrando qué borra, qué corrige, qué unifica y por qué) nosotros lo
documentamos. Esto es lo que permitirá que la carga de archivos funcione sola.

¿Le acomoda agendarla?

---

### 5. LTV — umbrales de "alto" y "bajo"

El modelo de perfiles (Promotores con Alto LTV, Detractores con Alto LTV, etc.)
es muy potente y lo queremos construir. Para clasificar a cada cliente
necesitamos saber **dónde corta** "alto" y "bajo":

- ¿Es un **monto fijo** (p. ej. arriba de $X al año)?
- ¿Es **relativo** al estudio (p. ej. el 25% que más gasta)?
- ¿Cambia según el tipo de cliente (colegio vs. empresa)?

---

### 6. Fórmulas exactas del tablero de Excel (Power Pivot)

El tablero `Dashboard Escuela Aníbal Ponce Papás.xlsx` calcula el NPS y el CSAT
con **medidas de Power Pivot**, que no se ven en las celdas — están guardadas
dentro del modelo de datos. Son la fuente más confiable de la fórmula real, y nos
permitirían replicar sus números exactamente.

¿Podría copiarlas? Se hace así:

1. Abrir el archivo en Excel.
2. Pestaña **Power Pivot** → **Administrar** (si no aparece: Archivo → Opciones →
   Complementos → COM → activar *Microsoft Power Pivot for Excel*).
3. Abajo, en el **área de cálculo**, aparecen las medidas (`nps`, `CSAT`,
   `Promotor`, `Detractor`, y las de cada punto de contacto).
4. Hacer clic en cada una y **copiar el texto de la fórmula tal cual** (o mandar
   una captura de pantalla donde se vea completa).

Nos interesan sobre todo **`nps`** y **`CSAT`**. Con eso confirmamos las preguntas
1 y 3 de forma definitiva.

---

## Nota rápida

Un punto que **ya quedó resuelto** y que registramos: el **modelo Kano no se va a
utilizar** (§4.4), así que lo quitamos del alcance.

Gracias — con estas respuestas podemos programar los indicadores reproduciendo
exactamente sus números.
