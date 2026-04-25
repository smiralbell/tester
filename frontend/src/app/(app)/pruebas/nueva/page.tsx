"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "@/lib/api";
import { getStoredToken } from "@/lib/auth-token";
import type { AgentSummary } from "@/types/panel";

type QuickTestStarted = {
  ok: true;
  status: "running";
  agentId: string;
  runId: string;
};

const input =
  "rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500/30 placeholder:text-zinc-600 focus:border-emerald-600 focus:ring-2";
const label = "flex flex-col gap-1.5 text-sm text-zinc-300";

export default function NuevaPruebaPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentId, setAgentId] = useState("");
  const [brief, setBrief] = useState("");
  const [maxMessages, setMaxMessages] = useState(8);
  const [maxDurationSec, setMaxDurationSec] = useState(0);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const t = getStoredToken();
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const sum = await apiJson<AgentSummary[]>("/api/agents/summary", { token: t });
      setAgents(Array.isArray(sum) ? sum : []);
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

  const runnableAgents = useMemo(
    () => agents.filter((a) => a.primaryProjectId != null),
    [agents]
  );

  async function onLaunch(e: React.FormEvent) {
    e.preventDefault();
    const t = getStoredToken();
    if (!t) return;
    if (!agentId) {
      setError("Selecciona un agente con proyecto QA.");
      return;
    }
    if (brief.trim().length < 20) {
      setError("El brief debe tener al menos 20 caracteres.");
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      const res = await apiJson<QuickTestStarted>("/api/agents/run-quick-test", {
        method: "POST",
        token: t,
        body: JSON.stringify({
          agentId,
          evaluationBrief: brief.trim(),
          maxMessages,
          maxDurationSec: maxDurationSec > 0 ? maxDurationSec : undefined
        })
      });
      router.push(`/pruebas/sesion/${res.runId}?agente=${encodeURIComponent(res.agentId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al lanzar la prueba");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-white">Nueva prueba</h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            Configura el escenario y lanza la ejecución. Al enviar, se abre automáticamente la conversación en vivo.
          </p>
        </div>
        <Link className="text-sm text-emerald-500 hover:text-emerald-400" href="/pruebas">
          ← Volver a tabla de pruebas
        </Link>
      </div>

      {error ? (
        <div className="mt-6 rounded-lg border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200" role="alert">
          {error}
        </div>
      ) : null}

      <form className="mt-8 grid gap-5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6" onSubmit={onLaunch}>
        <label className={label}>
          <span className="font-medium">Agente *</span>
          <span className="text-xs text-zinc-500">Solo agentes con proyecto QA (alta en Agentes).</span>
          <select className={input} onChange={(ev) => setAgentId(ev.target.value)} required value={agentId}>
            <option value="">— Seleccionar —</option>
            {runnableAgents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {a.agentName}
              </option>
            ))}
          </select>
        </label>

        <label className={label}>
          <span className="font-medium">Brief: qué quieres evaluar *</span>
          <span className="text-xs text-zinc-500">
            Describe la intención del cliente, producto, tono o riesgos a vigilar. Se usa como meta del escenario y en el informe final.
          </span>
          <textarea
            className={`${input} min-h-32 resize-y`}
            onChange={(ev) => setBrief(ev.target.value)}
            placeholder="Ej.: Verificar que el agente explica la tarifa X sin inventar descuentos y escala a humano si el usuario pide factura."
            value={brief}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            <span className="font-medium">Máximo de mensajes (turnos)</span>
            <span className="text-xs text-zinc-500">Cada turno = 1 mensaje simulador + 1 respuesta webhook.</span>
            <input
              className={input}
              max={25}
              min={1}
              onChange={(ev) => setMaxMessages(Number(ev.target.value) || 8)}
              type="number"
              value={maxMessages}
            />
          </label>
          <label className={label}>
            <span className="font-medium">Máximo de tiempo (segundos)</span>
            <span className="text-xs text-zinc-500">0 = sin límite (solo aplica el máximo de mensajes).</span>
            <input
              className={input}
              max={900}
              min={0}
              onChange={(ev) => setMaxDurationSec(Number(ev.target.value) || 0)}
              step={30}
              type="number"
              value={maxDurationSec}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            disabled={launching || loading}
            type="submit"
          >
            {launching ? "Arrancando prueba..." : "Lanzar prueba"}
          </button>
        </div>
      </form>
    </div>
  );
}
