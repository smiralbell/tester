"use client";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body style={{ background: "#09090b", color: "#e4e4e7", fontFamily: "system-ui, sans-serif", margin: 0, minHeight: "100vh" }}>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.75rem", color: "#f87171", textTransform: "uppercase", letterSpacing: "0.05em" }}>Error crítico</p>
          <h1 style={{ marginTop: "0.5rem", fontSize: "1.125rem", fontWeight: 600, color: "#fafafa" }}>Fallo al renderizar la aplicación</h1>
          <p style={{ marginTop: "0.75rem", maxWidth: "28rem", fontSize: "0.875rem", color: "#a1a1aa" }}>{String(error?.message ?? "Error desconocido")}</p>
          <button
            style={{
              marginTop: "2rem",
              borderRadius: "0.5rem",
              background: "#059669",
              color: "white",
              border: "none",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer"
            }}
            onClick={() => reset()}
            type="button"
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
