/* Launcher behaviour. Local only: no network, no storage, no analytics.
   Direction notes are held in a fixed-order object so the launcher cannot
   accidentally rank or reorder the options. */

(function () {
  "use strict";

  var NOTES = {
    "informe-vivo": {
      title: "A · Informe Vivo",
      thesis:
        "El estudio es un texto que además es interactivo. La estructura viene de la tipografía y del espacio en blanco, como en un informe bien compuesto; el color aparece sólo donde significa algo.",
      strengths:
        "El hallazgo va primero y los números lo sostienen. La lectura de la consultora cae de forma natural en la parte alta de la página. Es lo más lejano a una hoja de cálculo en un navegador, y funciona de forma nativa en el teléfono.",
      risks:
        "Exige escribir bien: una frase floja se ve peor que un número suelto. La paleta casi monocroma obliga a marcar los estados desactivados con algo más que color. La serif no puede bajar del tamaño del cuerpo.",
      notice:
        "Dónde cae el primer número respecto de la primera frase. Cuánto pesa la cita frente al indicador. Que casi no haya cajas: separan reglas y espacio, no tarjetas."
    },
    "mesa-de-trabajo": {
      title: "B · Mesa de Trabajo",
      thesis:
        "Las operaciones complejas deberían sentirse como un taller ordenado: una tarea delante, sus herramientas a mano y todo lo demás en silencio pero localizable. Studio manda; Insights hereda los mismos elementos y se quita el andamiaje.",
      strengths:
        "La mejor orientación de las tres: navegación fija, migas que siempre nombran al cliente, y una sola tinta de acción que responde a «¿qué hago ahora?». Es la más barata de construir y la de menor riesgo de accesibilidad.",
      risks:
        "Responde a «¿puedo operar esto?» mejor que a «¿qué pasó en mi colegio?». Corre el riesgo de devolverle al cliente la consola que el producto existe para reemplazar. En el teléfono es correcta, no nativa.",
      notice:
        "En Studio: cuánto más rápido sabes dónde estás. En Insights: si el mismo sistema, sin andamiaje, sigue leyéndose como un relato o vuelve a parecer un panel."
    },
    recorrido: {
      title: "C · Recorrido",
      thesis:
        "El recorrido es el producto. La evidencia aparece donde ocurrió: cada punto de contacto muestra su resultado y sólo los que se profundizaron llevan etiquetas, deliberadamente pocas.",
      strengths:
        "Es la más distintiva y la más cercana a cómo la consultora explica su trabajo. Las voces quedan pegadas al momento que las produjo. La disciplina de dos o tres etiquetas sale del espacio disponible, no de una regla arbitraria.",
      risks:
        "Asume que todo estudio tiene recorrido, y no todos lo tienen. Los resultados del ciclo completo no tienen sitio natural. En móvil la metáfora cambia de horizontal a vertical: son dos maquetas, no una que fluye.",
      notice:
        "Compara escritorio y móvil en «Insights»: el cambio de metáfora es el costo real de esta dirección. En «Studio», mira el bloque «Sin recorrido»: es la prueba de que la dirección no inventa caminos falsos."
    }
  };

  var DIR_ORDER = ["informe-vivo", "mesa-de-trabajo", "recorrido"];
  var state = { dir: "informe-vivo", surface: "entry", view: "desktop" };

  var frame = document.getElementById("l-frame");
  var shell = document.getElementById("l-shell");
  var open = document.getElementById("l-open");
  var frameLabel = document.getElementById("l-frame-label");
  var notes = document.getElementById("l-notes");

  function press(selector, attr, value) {
    document.querySelectorAll(selector).forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.dataset[attr] === value));
    });
  }

  function render() {
    var href = state.dir + "/" + state.surface + ".html";
    if (frame.getAttribute("src") !== href) frame.setAttribute("src", href);
    open.setAttribute("href", href);

    shell.classList.toggle("is-mobile", state.view === "mobile");
    shell.classList.toggle("is-desktop", state.view === "desktop");
    frameLabel.textContent =
      state.view === "mobile" ? "Móvil · 375 × 812 px" : "Escritorio · ancho completo";

    var note = NOTES[state.dir];
    notes.querySelector('[data-note="title"]').textContent = note.title;
    notes.querySelector('[data-note="thesis"]').textContent = note.thesis;
    notes.querySelector('[data-note="strengths"]').textContent = note.strengths;
    notes.querySelector('[data-note="risks"]').textContent = note.risks;
    notes.querySelector('[data-note="notice"]').textContent = note.notice;
  }

  document.querySelectorAll("[data-dir]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.dir = btn.dataset.dir;
      press("[data-dir]", "dir", state.dir);
      render();
    });
  });

  document.querySelectorAll("[data-surface]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.surface = btn.dataset.surface;
      press("[data-surface]", "surface", state.surface);
      render();
    });
  });

  document.querySelectorAll("[data-view]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.view = btn.dataset.view;
      press("[data-view]", "view", state.view);
      render();
    });
  });

  // Sanity: the launcher must offer every direction exactly once.
  var offered = Array.prototype.map.call(
    document.querySelectorAll("[data-dir]"),
    function (b) { return b.dataset.dir; }
  );
  if (offered.join(",") !== DIR_ORDER.join(",")) {
    console.warn("Launcher direction order drifted from the fixed neutral order.");
  }

  render();
})();
