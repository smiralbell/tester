"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { getStoredToken } from "@/lib/auth-token";

type RecentRun = {
  runId: string;
  status: string;
  averageScore: number | null;
  passed: boolean | null;
  createdAt: string;
  evaluationBrief: string | null;
  durationMs: number | null;
  agentId: string;
  agentName: string;
  projectName: string;
  scenarioName: string;
};

export default function PruebasPage() {
  const router = useRouter();
  const [recent, setRecent] = useState<RecentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const t = getStoredToken();
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const rec = await apiJson<RecentRun[]>("/api/agents/recent-runs", { token: t });
      setRecent(Array.isArray(rec) ? rec : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getStoredToken()) {
      router.replace("/login");
      return;
    }
    void load();
  }, [load, router]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex justify-end">
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            disabled={loading}
            onClick={() => void load()}
            title="Actualizar"
            type="button"
          >
            ↻
          </button>
          <Link
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
            href="/pruebas/nueva"
            rel="noopener noreferrer"
            target="_blank"
            title="Nueva prueba"
          >
            +
          </Link>
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded-lg border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200" role="alert">
          {error}
        </div>
      ) : null}

      <section className="mt-6">
        {loading ? (
          <p className="mt-4 text-sm text-zinc-500">Cargando…</p>
        ) : !recent.length ? (
          <p className="mt-4 text-sm text-zinc-500">Aún no hay pruebas registradas.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Agente</th>
                  <th className="px-4 py-3 font-medium">Brief</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Tiempo</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">En vivo</th>
                  <th className="px-4 py-3 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {recent.map((r) => (
                  <tr
                    className="cursor-pointer bg-zinc-950/40 hover:bg-zinc-900/40"
                    key={r.runId}
                    onClick={() =>
                      router.push(
                        `/pruebas/sesion/${r.runId}?agente=${encodeURIComponent(r.agentId)}`
                      )
                    }
                  >
                    <td className="px-4 py-3 text-zinc-200">{r.agentName}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-xs text-zinc-500" title={r.evaluationBrief ?? ""}>
                      {r.evaluationBrief ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.status === "completed"
                            ? "bg-emerald-950 text-emerald-400"
                            : r.status === "failed"
                              ? "bg-red-950 text-red-300"
                              : r.status === "running"
                                ? "bg-amber-950 text-amber-200"
                                : "bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        {r.status === "running" ? "en curso" : r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      {r.averageScore != null ? r.averageScore.toFixed(1) : "—"}
                      {r.passed != null ? (
                        <span className="ml-1 text-xs text-zinc-500">{r.passed ? "ok" : "fail"}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)} s` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{new Date(r.createdAt).toLocaleString("es")}</td>
                    <td className="px-4 py-3">
                      <Link
                        className="text-xs font-medium text-amber-400 hover:text-amber-300"
                        href={`/pruebas/sesion/${r.runId}?agente=${encodeURIComponent(r.agentId)}`}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        Ver en vivo
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        className="text-xs font-medium text-emerald-500 hover:text-emerald-400"
                        href={`/agentes/${r.agentId}/conversaciones/${r.runId}`}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        Detalle
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
