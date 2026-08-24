"use client";

/**
 * The last-resort boundary: it replaces the root layout, so it renders its own
 * document — including `lang="es"`, which the framework default would not.
 * Styling is inline because `globals.css` belongs to the layout this replaces.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#faf8f3",
          color: "#24405c",
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          padding: "2rem",
        }}
      >
        <main id="contenido" style={{ maxWidth: "32rem" }}>
          <h1 style={{ color: "#0e2a45", fontSize: "1.75rem", margin: 0 }}>
            No pudimos cargar la aplicación
          </h1>
          <p style={{ lineHeight: 1.55 }}>
            Ocurrió un error inesperado antes de que la página pudiera dibujarse.
            Intenta de nuevo; si vuelve a pasar, avísale al equipo de Be Community.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "2.75rem",
              padding: "0.625rem 1rem",
              borderRadius: "0.625rem",
              border: "none",
              background: "#0e2a45",
              color: "#faf8f3",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
