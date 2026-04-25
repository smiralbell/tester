"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth-token";
import type { AgentSummary } from "@/types/panel";

export type { AgentSummary };

export default function AgentesListPage() {
  const router = useRouter();
  const [token, setTokenState] = useState<string | null>(null);
  const [rows, setRows] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (t: string) => {
      setError(null);
      setLoading(true);
      try {
        const list = await apiJson<AgentSummary[]>("/api/agents/summary", { token: t });
        setRows(Array.isArray(list) ? list : []);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error al cargar";
        setError(msg);
        if (msg.toLowerCase().includes("autentic") || msg.toLowerCase().includes("401")) {
          clearStoredToken();
          router.replace("/login");
        }
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  useEffect(() => {
    const t = getStoredToken();
    setTokenState(t);
    if (!t) {
      router.replace("/login");
      return;
    }
    void load(t);
  }, [load, router]);

  if (!token && typeof window !== "undefined" && !getStoredToken()) {
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap justify-end gap-2">
        <button
          className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
          onClick={() => token && void load(token)}
          type="button"
        >
          Actualizar
        </button>
        <Link
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
          href="/agentes/nuevo"
        >
          Crear agente
        </Link>
      </div>

      {error ? (
        <p className="mt-6 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-10 text-sm text-zinc-500">Cargando agentes…</p>
      ) : !rows?.length ? (
        <div className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/40 p-10 text-center">
          <p className="text-sm text-zinc-400">No hay agentes todavía.</p>
          <Link className="mt-4 inline-block text-sm font-medium text-emerald-500 hover:text-emerald-400" href="/agentes/nuevo">
            Crear el primero
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {rows.map((a) => (
            <li
              className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 lg:grid-cols-3"
              key={a.agentId}
            >
              <div className="border-b border-zinc-800 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Agente</p>
                <p className="mt-1 text-lg font-semibold text-white">{a.agentName}</p>
                <p className="mt-1 text-xs text-zinc-600">Alta: {new Date(a.agentCreatedAt).toLocaleString("es")}</p>
                {!a.primaryProjectId ? (
                  <p className="mt-2 text-xs text-amber-500">Sin proyecto QA vinculado — completa el alta en Crear agente.</p>
                ) : null}
              </div>

              <div className="border-b border-zinc-800 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:px-2">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Métricas de pruebas</p>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-zinc-500">Mensajes</dt>
                    <dd className="font-semibold text-white">{a.totalTestMessages}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Score medio</dt>
                    <dd className="font-semibold text-emerald-400">{a.avgScore != null ? a.avgScore.toFixed(1) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Runs</dt>
                    <dd className="text-zinc-200">
                      {a.totalRuns}{" "}
                      <span className="text-zinc-500">
                        ({a.completedRuns} ok)
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="flex flex-col justify-center gap-2 lg:pl-2">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Accesos rápidos</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:flex-col">
                  <Link
                    className="rounded-lg border border-zinc-700 px-3 py-2 text-center text-sm text-zinc-200 transition hover:border-emerald-700 hover:bg-zinc-800"
                    href={`/agentes/${a.agentId}/configuracion`}
                  >
                    Ver configuración
                  </Link>
                  <Link
                    className="rounded-lg border border-zinc-700 px-3 py-2 text-center text-sm text-zinc-200 transition hover:border-emerald-700 hover:bg-zinc-800"
                    href={`/estadisticas?agente=${a.agentId}`}
                  >
                    Ver estadísticas
                  </Link>
                  <Link
                    className="rounded-lg border border-zinc-700 px-3 py-2 text-center text-sm text-zinc-200 transition hover:border-emerald-700 hover:bg-zinc-800"
                    href={`/agentes/${a.agentId}/conversaciones`}
                  >
                    Ver conversaciones
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
