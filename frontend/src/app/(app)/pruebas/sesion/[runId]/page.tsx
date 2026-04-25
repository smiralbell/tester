"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
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
    maxMessages?: number;
    startedAt?: string | null;
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

function TypingDots() {
  return (
    <span className="ml-1 inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
    </span>
  );
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function KpiStrip({ kpi }: { kpi: Record<string, unknown> | null }) {
  if (!kpi || typeof kpi !== "object") return null;
  const avg = typeof kpi.avgScore === "number" ? kpi.avgScore.toFixed(1) : String(kpi.avgScore ?? "—");
  const risk = String(kpi.riskLevel ?? "—");
  return (
    <div className="mt-4 flex flex-wrap gap-3 text-xs text-zinc-400">
      <span className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1">Score medio {avg}</span>
      <span className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1">Riesgo {risk}</span>
    </div>
  );
}

function SesionLiveInner() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const runId = String(params.runId ?? "");
  const agentId = String(search.get("agente") ?? "");

  const [data, setData] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [typingCycleStartTs, setTypingCycleStartTs] = useState(() => Date.now());
  const [lastMessageCount, setLastMessageCount] = useState(0);

  const fetchDetail = useCallback(async () => {
    const t = getStoredToken();
    if (!t) return null;
    return apiJson<RunDetail>(`/api/agents/${agentId}/runs/${runId}/detail`, { token: t });
  }, [agentId, runId]);

  useEffect(() => {
    if (!getStoredToken()) {
      router.replace("/login");
      return;
    }
    if (!agentId || !runId) {
      setError("Falta el parámetro agente en la URL (?agente=UUID).");
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (cancelled) return;
      setError(null);
      try {
        const d = await fetchDetail();
        if (cancelled || !d) return;
        if (d.run.status === "running" && d.messages.length !== lastMessageCount) {
          setTypingCycleStartTs(Date.now());
          setLastMessageCount(d.messages.length);
        }
        setData(d);
        setLoading(false);
        if (d.run.status === "running") {
          timeoutId = setTimeout(poll, 1500);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Error");
          setLoading(false);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [agentId, runId, fetchDetail, router, lastMessageCount]);

  const running = data?.run.status === "running";
  const averageScore = toNumberOrNull(data?.run.averageScore);
  const durationMs = toNumberOrNull(data?.run.durationMs);
  const startedTs = data?.run.startedAt ? Date.parse(data.run.startedAt) : null;
  const liveElapsedMs = running && startedTs ? Math.max(0, nowTs - startedTs) : null;
  const typingPhase: "tester" | "agent" =
    running && nowTs - typingCycleStartTs < 1100 ? "tester" : "agent";

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setNowTs(Date.now());
    }, 300);
    return () => clearInterval(id);
  }, [running]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Prueba en vivo</h2>
          <p className="mt-0.5 font-mono text-xs text-zinc-500">{runId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-950/80 px-3 py-1 text-xs font-medium text-amber-200">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
              </span>
              En curso
            </span>
          ) : (
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                data?.run.status === "completed"
                  ? "bg-emerald-950 text-emerald-300"
                  : data?.run.status === "failed"
                    ? "bg-red-950 text-red-300"
                    : "bg-zinc-800 text-zinc-300"
              }`}
            >
              {data?.run.status ?? "—"}
            </span>
          )}
          <Link className="text-sm text-emerald-500 hover:text-emerald-400" href="/pruebas">
            ← Pruebas
          </Link>
        </div>
      </div>

      {loading && !data ? <p className="mt-8 text-sm text-zinc-500">Cargando conversación…</p> : null}
      {error ? <p className="mt-6 text-sm text-red-400">{error}</p> : null}

      {data?.run.evaluationBrief ? (
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-xs text-zinc-400">
          <span className="font-medium text-zinc-500">Brief: </span>
          <span className="whitespace-pre-wrap text-zinc-300">{data.run.evaluationBrief}</span>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
            {typeof data.run.maxMessages === "number" ? (
              <span>
                Turnos: <span className="text-zinc-300">{(data.messages ?? []).length}</span> / {data.run.maxMessages}
              </span>
            ) : null}
            {liveElapsedMs != null ? (
              <span>
                Tiempo: <span className="text-zinc-300">{(liveElapsedMs / 1000).toFixed(1)} s</span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {data?.run && !running ? (
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 text-sm text-zinc-400">
          {averageScore != null ? (
            <p>
              Score medio: <span className="text-emerald-400">{averageScore.toFixed(2)}</span>
            </p>
          ) : null}
          {durationMs != null ? (
            <p className="mt-1 text-xs">
              Duración: <span className="text-zinc-300">{(durationMs / 1000).toFixed(1)} s</span>
            </p>
          ) : null}
          {data.run.summary ? <p className="mt-2 text-zinc-500">{data.run.summary}</p> : null}
          <KpiStrip kpi={data.run.kpiSnapshot ?? null} />
        </div>
      ) : null}

      <div className="mt-6 flex flex-1 flex-col gap-3 pb-24">
        {(data?.messages ?? []).map((m, i) => (
          <div className="flex flex-col gap-2" key={`${m.createdAt}-${i}`}>
            <div className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-zinc-700 bg-zinc-800/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Simulador</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-100">{m.testerMessage}</p>
              </div>
            </div>
            <div className="flex justify-end">
              <div className="max-w-[92%] rounded-2xl rounded-tr-sm border border-emerald-900/50 bg-emerald-950/40 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600/90">Agente</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-100">{m.agentReply}</p>
                <p className="mt-2 text-[11px] text-zinc-500">
                  Score {m.score} · {m.passed ? "pass" : "fail"}
                </p>
              </div>
            </div>
          </div>
        ))}
        {running ? (
          <div className="space-y-2">
            <div className="flex justify-start">
              <div
                className={`rounded-2xl rounded-tl-sm border px-4 py-2 text-xs ${
                  typingPhase === "tester"
                    ? "border-zinc-700 bg-zinc-800/70 text-zinc-300"
                    : "border-zinc-800 bg-zinc-900/40 text-zinc-500"
                }`}
              >
                Simulador escribiendo
                {typingPhase === "tester" ? <TypingDots /> : null}
              </div>
            </div>
            <div className="flex justify-end">
              <div
                className={`rounded-2xl rounded-tr-sm border px-4 py-2 text-xs ${
                  typingPhase === "agent"
                    ? "border-emerald-900/50 bg-emerald-950/40 text-zinc-200"
                    : "border-zinc-800 bg-zinc-900/40 text-zinc-500"
                }`}
              >
                Agente escribiendo
                {typingPhase === "agent" ? <TypingDots /> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {data?.run.qaInsight && !running ? (
        <div className="mt-4 rounded-lg border border-emerald-900/30 bg-emerald-950/10 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-500/80">Informe QA</p>
          <pre className="mt-2 max-h-[min(50vh,400px)] overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-300">
            {data.run.qaInsight}
          </pre>
        </div>
      ) : null}

      {data && !running ? (
        <div className="mt-6">
          <Link
            className="text-sm text-zinc-400 underline hover:text-zinc-200"
            href={`/agentes/${agentId}/conversaciones/${runId}`}
          >
            Abrir en vista detalle de agente →
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export default function PruebaSesionPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-zinc-500">Cargando…</p>
        </div>
      }
    >
      <SesionLiveInner />
    </Suspense>
  );
}
