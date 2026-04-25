"use client";

export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center bg-zinc-950 px-6 py-16 text-center text-zinc-200">
      <p className="text-xs font-medium uppercase tracking-wide text-red-400/90">Error</p>
      <h1 className="mt-2 text-lg font-semibold text-white">No se pudo cargar esta vista</h1>
      <p className="mt-3 max-w-md text-sm text-zinc-500">{String(error?.message ?? "Error desconocido")}</p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-zinc-600">digest: {error.digest}</p> : null}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          onClick={() => reset()}
          type="button"
        >
          Reintentar
        </button>
        <a className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800" href="/">
          Ir al inicio
        </a>
      </div>
    </div>
  );
}
