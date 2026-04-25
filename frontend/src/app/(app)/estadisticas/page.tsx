"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import type { AgentSummary } from "@/types/panel";
import { getStoredToken } from "@/lib/auth-token";

type AnalyticsResponse = {
  overview: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    runningRuns: number;
    avgScore: number | null;
    passRatePct: number;
    avgDurationMs: number | null;
    p95DurationMs: number | null;
    avgResponseMs: number | null;
    p95ResponseMs: number | null;
    totalErrors: number;
    totalAdvice: number;
    reliabilityObservedPct: number;
  };
  benchmark: {
    last7: { runs: number; passRatePct: number; avgScore: number | null };
    prev7: { runs: number; passRatePct: number; avgScore: number | null };
    trend: { runsDelta: number; passRateDeltaPct: number; avgScoreDelta: number };
    responseSla: { under1s: number; between1sAnd2s: number; over2s: number };
    successStreak: number;
  };
  scoreDistribution: Array<{ label: string; min: number; max: number; count: number }>;
  riskDistribution: { bajo: number; medio: number; alto: number; unknown: number };
  timeline: Array<{ date: string; runs: number; completed: number; failed: number; avgScore: number | null }>;
  agents: Array<{
    agentId: string;
    agentName: string;
    runs: number;
    completed: number;
    passRatePct: number;
    avgScore: number | null;
    avgResponseMs: number | null;
  }>;
  topFailures: Array<{ reason: string; count: number }>;
};

const fmtMs = (ms: number | null) => (ms == null ? "—" : `${ms} ms`);
const pct = (n: number | null) => (n == null ? "—" : `${n}%`);

function EstadisticasInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const agenteFilter = searchParams.get("agente");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [agentLabel, setAgentLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const t = getStoredToken();
    if (!t) {
      router.replace("/login");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      let ids: string[] | null = null;
      let label: string | null = null;
      if (agenteFilter) {
        const summary = await apiJson<AgentSummary[]>("/api/agents/summary", { token: t });
        const hit = summary.find((s) => s.agentId === agenteFilter);
        ids = hit?.projectIds?.length ? hit.projectIds : [];
        label = hit?.agentName ?? null;
      }
      setAgentLabel(label);
      const q = agenteFilter && ids && ids.length > 0 ? `?agente=${encodeURIComponent(agenteFilter)}` : "";
      const analytics = await apiJson<AnalyticsResponse>(`/api/agents/analytics${q}`, { token: t });
      setData(analytics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los datos");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [agenteFilter, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const card = "rounded-xl border border-zinc-800 bg-zinc-900/40 p-5";
  const maxTimelineRuns = Math.max(1, ...(data?.timeline ?? []).map((x) => x.runs));
  const maxScoreBucket = Math.max(1, ...(data?.scoreDistribution ?? []).map((x) => x.count));
  const overview = data?.overview;
  const benchmark = data?.benchmark;
  const agentRows = data?.agents ?? [];
  const riskTotal =
    (data?.riskDistribution.bajo ?? 0) +
    (data?.riskDistribution.medio ?? 0) +
    (data?.riskDistribution.alto ?? 0) +
    (data?.riskDistribution.unknown ?? 0);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 border-b border-zinc-800 pb-6">
        <h2 className="text-2xl font-semibold tracking-tight text-white">Analytics operativo</h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Vista ampliada: tendencia 7+7 días, SLA de respuesta, actividad diaria, distribución de score, riesgo desde KPI,
          incidencias recurrentes y rendimiento por agente. Datos desde el endpoint{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300">/api/agents/analytics</code>.
        </p>
      </header>
      <div className="flex flex-wrap items-end justify-end gap-4">
        {agenteFilter && agentLabel ? (
          <p className="mr-auto rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
            Filtro activo: <span className="text-zinc-200">{agentLabel}</span>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {agenteFilter ? (
            <Link
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              href="/estadisticas"
            >
              Quitar filtro
            </Link>
          ) : null}
          <button
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            onClick={() => void load()}
            type="button"
          >
            Actualizar
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-6 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-10 text-sm text-zinc-500">Calculando…</p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className={card}>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Runs totales</p>
            <p className="mt-2 text-3xl font-semibold text-white">{overview?.totalRuns ?? 0}</p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Fiabilidad observada</p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {pct(overview?.reliabilityObservedPct ?? null)}
            </p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Score medio</p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {overview?.avgScore != null ? overview.avgScore.toFixed(1) : "—"}
            </p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Runs en curso</p>
            <p className="mt-2 text-3xl font-semibold text-amber-300">{overview?.runningRuns ?? 0}</p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">T. respuesta media</p>
            <p className="mt-2 text-2xl font-semibold text-white">{fmtMs(overview?.avgResponseMs ?? null)}</p>
            <p className="mt-1 text-xs text-zinc-500">P95 {fmtMs(overview?.p95ResponseMs ?? null)}</p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Duración media run</p>
            <p className="mt-2 text-2xl font-semibold text-white">{fmtMs(overview?.avgDurationMs ?? null)}</p>
            <p className="mt-1 text-xs text-zinc-500">P95 {fmtMs(overview?.p95DurationMs ?? null)}</p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Errores detectados</p>
            <p className="mt-2 text-3xl font-semibold text-red-300">{overview?.totalErrors ?? 0}</p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Consejos generados</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-300">{overview?.totalAdvice ?? 0}</p>
          </div>
        </div>
      )}

      {!loading && (overview?.totalRuns ?? 0) > 0 ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <section className={card}>
            <h3 className="text-sm font-semibold text-white">Tendencia (7 días vs 7 previos)</h3>
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Runs</p>
                <p className="mt-1 text-lg text-zinc-100">{benchmark?.last7.runs ?? 0}</p>
                <p className={`text-xs ${(benchmark?.trend.runsDelta ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {(benchmark?.trend.runsDelta ?? 0) >= 0 ? "+" : ""}
                  {benchmark?.trend.runsDelta ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Pass rate</p>
                <p className="mt-1 text-lg text-zinc-100">{pct(benchmark?.last7.passRatePct ?? 0)}</p>
                <p className={`text-xs ${(benchmark?.trend.passRateDeltaPct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {(benchmark?.trend.passRateDeltaPct ?? 0) >= 0 ? "+" : ""}
                  {benchmark?.trend.passRateDeltaPct ?? 0} pp
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Score</p>
                <p className="mt-1 text-lg text-zinc-100">
                  {benchmark?.last7.avgScore != null ? benchmark.last7.avgScore.toFixed(1) : "—"}
                </p>
                <p className={`text-xs ${(benchmark?.trend.avgScoreDelta ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {(benchmark?.trend.avgScoreDelta ?? 0) >= 0 ? "+" : ""}
                  {benchmark?.trend.avgScoreDelta ?? 0}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-500">Racha actual de runs aprobados: {benchmark?.successStreak ?? 0}</p>
          </section>

          <section className={card}>
            <h3 className="text-sm font-semibold text-white">SLA de respuesta (por run)</h3>
            <div className="mt-4 space-y-2">
              {[
                { label: "< 1s", value: benchmark?.responseSla.under1s ?? 0, color: "bg-emerald-500" },
                { label: "1s - 2s", value: benchmark?.responseSla.between1sAnd2s ?? 0, color: "bg-amber-500" },
                { label: "> 2s", value: benchmark?.responseSla.over2s ?? 0, color: "bg-red-500" }
              ].map((row) => {
                const total =
                  (benchmark?.responseSla.under1s ?? 0) +
                  (benchmark?.responseSla.between1sAnd2s ?? 0) +
                  (benchmark?.responseSla.over2s ?? 0);
                const width = total ? Math.max(4, Math.round((100 * row.value) / total)) : 0;
                return (
                  <div className="grid grid-cols-[70px_1fr_42px] items-center gap-3" key={row.label}>
                    <span className="text-xs text-zinc-500">{row.label}</span>
                    <div className="h-2 rounded bg-zinc-800">
                      <div className={`h-2 rounded ${row.color}`} style={{ width: `${width}%` }} />
                    </div>
                    <span className="text-right text-xs text-zinc-300">{row.value}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={card}>
            <h3 className="text-sm font-semibold text-white">Actividad por día (últimos 21)</h3>
            <div className="mt-4 space-y-2">
              {(data?.timeline ?? []).map((d) => (
                <div className="grid grid-cols-[88px_1fr_100px] items-center gap-3" key={d.date}>
                  <span className="text-xs text-zinc-500">{d.date.slice(5)}</span>
                  <div className="h-2 rounded bg-zinc-800">
                    <div
                      className="h-2 rounded bg-emerald-500/80"
                      style={{ width: `${Math.max(4, Math.round((100 * d.runs) / maxTimelineRuns))}%` }}
                    />
                  </div>
                  <span className="text-right text-xs text-zinc-300">
                    {d.runs} runs · {d.avgScore != null ? d.avgScore.toFixed(1) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className={card}>
            <h3 className="text-sm font-semibold text-white">Distribución de score</h3>
            <div className="mt-4 space-y-2">
              {(data?.scoreDistribution ?? []).map((b) => (
                <div className="grid grid-cols-[72px_1fr_40px] items-center gap-3" key={b.label}>
                  <span className="text-xs text-zinc-500">{b.label}</span>
                  <div className="h-2 rounded bg-zinc-800">
                    <div
                      className="h-2 rounded bg-sky-500/80"
                      style={{ width: `${Math.max(4, Math.round((100 * b.count) / maxScoreBucket))}%` }}
                    />
                  </div>
                  <span className="text-right text-xs text-zinc-300">{b.count}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={card}>
            <h3 className="text-sm font-semibold text-white">Riesgo (kpi snapshot)</h3>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {[
                { key: "bajo", val: data?.riskDistribution.bajo ?? 0, color: "text-emerald-300" },
                { key: "medio", val: data?.riskDistribution.medio ?? 0, color: "text-amber-300" },
                { key: "alto", val: data?.riskDistribution.alto ?? 0, color: "text-red-300" },
                { key: "sin dato", val: data?.riskDistribution.unknown ?? 0, color: "text-zinc-400" }
              ].map((r) => (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3" key={r.key}>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{r.key}</p>
                  <p className={`mt-1 text-xl font-semibold ${r.color}`}>{r.val}</p>
                  <p className="text-xs text-zinc-500">{riskTotal ? Math.round((100 * r.val) / riskTotal) : 0}%</p>
                </div>
              ))}
            </div>
          </section>

          <section className={card}>
            <h3 className="text-sm font-semibold text-white">Top incidencias</h3>
            <ul className="mt-4 space-y-2">
              {(data?.topFailures ?? []).length ? (
                (data?.topFailures ?? []).map((f) => (
                  <li className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2" key={f.reason}>
                    <p className="text-sm text-zinc-200">{f.reason}</p>
                    <p className="mt-1 text-xs text-zinc-500">Apariciones: {f.count}</p>
                  </li>
                ))
              ) : (
                <li className="text-sm text-zinc-500">Sin fallos repetidos registrados.</li>
              )}
            </ul>
          </section>
        </div>
      ) : null}

      {!loading && agentRows.length > 0 ? (
        <section className="mt-6 overflow-hidden rounded-xl border border-zinc-800">
          <div className="border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
            <h3 className="text-sm font-semibold text-white">Rendimiento por agente</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-zinc-900/30 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Agente</th>
                  <th className="px-4 py-3">Runs</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Fiabilidad</th>
                  <th className="px-4 py-3">Resp. media</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {agentRows.map((a) => (
                  <tr className="bg-zinc-950/30" key={a.agentId}>
                    <td className="px-4 py-3 text-zinc-200">{a.agentName}</td>
                    <td className="px-4 py-3 text-zinc-300">{a.runs}</td>
                    <td className="px-4 py-3 text-zinc-300">{a.avgScore != null ? a.avgScore.toFixed(1) : "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 rounded bg-zinc-800">
                          <div className="h-2 rounded bg-emerald-500" style={{ width: `${Math.max(2, a.passRatePct)}%` }} />
                        </div>
                        <span className="text-xs text-zinc-300">{a.passRatePct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{fmtMs(a.avgResponseMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!loading && (overview?.totalRuns ?? 0) === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">
          Sin datos en esta vista.{" "}
          <Link className="text-emerald-500 underline hover:text-emerald-400" href="/agentes">
            Ir a agentes
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export default function EstadisticasPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-zinc-500">Cargando estadísticas…</div>
      }
    >
      <EstadisticasInner />
    </Suspense>
  );
}
