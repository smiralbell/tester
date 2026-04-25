"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { getStoredToken } from "@/lib/auth-token";

type Msg = {
  testerMessage: string;
  agentReply: string;
  score: number;
  passed: boolean;
  notes: string;
  createdAt: string;
};

type RunDetail = {
  run: {
    id: string;
    status: string;
    averageScore: number | null;
    summary: string | null;
    evaluationBrief?: string | null;
    qaInsight?: string | null;
    kpiSnapshot?: Record<string, unknown> | null;
    durationMs?: number | null;
    errorCount?: number;
    adviceCount?: number;
  };
  messages: Msg[];
};

export default function RunDialogoPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = String(params.agentId ?? "");
  const runId = String(params.runId ?? "");
  const [data, setData] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!getStoredToken()) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const d = await apiJson<RunDetail>(`/api/agents/${agentId}/runs/${runId}/detail`, {
        token: getStoredToken()
      });
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [agentId, runId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Detalle del run</h2>
        <Link className="text-sm text-emerald-500 hover:text-emerald-400" href={`/agentes/${agentId}/conversaciones`}>
          Volver al listado
        </Link>
      </div>

      {loading ? <p className="mt-8 text-sm text-zinc-500">Cargando…</p> : null}
      {error ? <p className="mt-6 text-sm text-red-400">{error}</p> : null}

      {data?.run ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
            <p>
              Estado: <span className="text-zinc-200">{data.run.status}</span>
            </p>
            {data.run.averageScore != null ? (
              <p className="mt-1">
                Score medio: <span className="text-emerald-400">{data.run.averageScore.toFixed(2)}</span>
              </p>
            ) : null}
            {data.run.durationMs != null ? (
              <p className="mt-1 text-xs">
                Duración: <span className="text-zinc-300">{(data.run.durationMs / 1000).toFixed(1)} s</span>
              </p>
            ) : null}
            {data.run.summary ? <p className="mt-2 text-zinc-500">{data.run.summary}</p> : null}
            {data.run.evaluationBrief ? (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <p className="text-xs font-medium uppercase text-zinc-500">Brief del evaluador</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{data.run.evaluationBrief}</p>
              </div>
            ) : null}
          </div>
          {data.run.qaInsight ? (
            <div className="rounded-lg border border-emerald-900/30 bg-emerald-950/10 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-500/80">Informe QA (agente)</p>
              <pre className="mt-2 max-h-[min(60vh,480px)] overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-300">
                {data.run.qaInsight}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      <ul className="mt-8 space-y-4">
        {(data?.messages ?? []).map((m, i) => (
          <li className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4" key={`${m.createdAt}-${i}`}>
            <p className="text-xs font-medium uppercase text-zinc-500">Turno {i + 1}</p>
            <p className="mt-2 text-sm text-emerald-400/90">Tester</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{m.testerMessage}</p>
            <p className="mt-3 text-sm text-sky-400/90">Agente</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{m.agentReply}</p>
            <p className="mt-3 text-xs text-zinc-500">
              Score {m.score} · {m.passed ? "pass" : "fail"}
              {m.notes ? ` · ${m.notes}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
