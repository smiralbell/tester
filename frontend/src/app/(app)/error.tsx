"use client";

export default function AppShellError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center bg-zinc-950 px-6 py-12 text-center">
      <p className="text-xs font-medium uppercase text-red-400/90">Error en el panel</p>
      <h2 className="mt-2 text-base font-semibold text-white">{String(error?.message ?? "Algo falló")}</h2>
      <div className="mt-6 flex gap-3">
        <button
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          onClick={() => reset()}
          type="button"
        >
          Reintentar
        </button>
        <a className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800" href="/agentes">
          Volver a agentes
        </a>
      </div>
    </div>
  );
}
