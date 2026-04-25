"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth-token";

type RunLite = {
  id: string;
  projectId: string;
  scenarioId: string;
  status: string;
  averageScore: number | null;
  passed: boolean | null;
  startedAt: string | null;
  finishedAt: string | null;
  messageCount: number;
};

export default function AgenteConversacionesPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = String(params.agentId ?? "");
  const [runs, setRuns] = useState<RunLite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const t = getStoredToken();
    if (!t) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await apiJson<RunLite[]>(`/api/agents/${agentId}/runs`, { token: t });
      setRuns(Array.isArray(list) ? list : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      setError(msg);
      if (msg.includes("401") || msg.toLowerCase().includes("autentic")) {
        clearStoredToken();
        router.replace("/login");
      }
    } finally {
      setLoading(false);
    }
  }, [agentId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Conversaciones (runs)</h2>
          <p className="mt-1 text-sm text-zinc-500">Pruebas ejecutadas para este agente.</p>
        </div>
        <Link className="text-sm text-emerald-500 hover:text-emerald-400" href="/agentes">
          Volver
        </Link>
      </div>

      {loading ? <p className="mt-8 text-sm text-zinc-500">Cargando…</p> : null}
      {error ? (
        <p className="mt-6 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && runs && runs.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">No hay runs todavía para este agente.</p>
      ) : null}

      {runs && runs.length > 0 ? (
        <div className="mt-8 overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/60 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Mensajes</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Inicio</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {runs.map((r) => (
                <tr className="bg-zinc-950/30" key={r.id}>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-zinc-200">{r.messageCount}</td>
                  <td className="px-4 py-3 text-zinc-300">{r.averageScore != null ? r.averageScore.toFixed(1) : "—"}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {r.startedAt ? new Date(r.startedAt).toLocaleString("es") : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link className="text-emerald-500 hover:text-emerald-400" href={`/agentes/${agentId}/conversaciones/${r.id}`}>
                      Ver diálogo
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
