"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth-token";
import { AgentQaKnowledgePanel } from "@/components/AgentQaKnowledgePanel";
import { DownloadBase64Button } from "@/components/DownloadBase64Button";
import { QA_VARIABLE_CATALOG } from "@/lib/qa-webhook-variables";
import { tryParseContextBundle } from "@/lib/qa-context-bundle";
import type { QaKnowledgePreviewResponse } from "@/types/qa-knowledge-preview";

type ProjectDetail = {
  id: string;
  name: string;
  webhookUrl: string;
  webhookMethod?: string;
  webhookAuthToken: string | null;
  webhookRequestJson: string | null;
  clientContext: string;
  testInstructions: string;
  webhookMessageField: string;
  webhookSessionField: string;
  webhookMetadataField: string;
  responseMessageField: string;
};

export default function AgenteConfigPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = String(params.agentId ?? "");
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [qaPreview, setQaPreview] = useState<QaKnowledgePreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [responsePath, setResponsePath] = useState("");
  const [responseExampleJson, setResponseExampleJson] = useState('{"reply":"Hola, ¿en qué puedo ayudarte?"}');
  const [savingResponsePath, setSavingResponsePath] = useState(false);

  const load = useCallback(async () => {
    const t = getStoredToken();
    if (!t) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    setQaPreview(null);
    try {
      const [p, prev] = await Promise.all([
        apiJson<ProjectDetail>(`/api/agents/${agentId}/project`, { token: t }),
        apiJson<QaKnowledgePreviewResponse>(`/api/agents/${agentId}/qa-knowledge-preview`, { token: t }).catch(() => null)
      ]);
      setData(p);
      setQaPreview(prev);
      const parsedLayout = (() => {
        try {
          if (!p.webhookRequestJson?.trim()) return null;
          const root = JSON.parse(p.webhookRequestJson) as Record<string, unknown>;
          const raw = root.__qa_variableLayout;
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
          const r = raw as Record<string, unknown>;
          return typeof r.responsePath === "string" ? r.responsePath : null;
        } catch {
          return null;
        }
      })();
      setResponsePath(parsedLayout ?? p.responseMessageField ?? "reply");
      const inferred = parsedLayout ?? p.responseMessageField ?? "reply";
      setResponseExampleJson(JSON.stringify({ [inferred.split(".").at(-1) || "reply"]: "Mensaje de ejemplo" }, null, 2));
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

  const variableLayout = useMemo(() => {
    const raw = data?.webhookRequestJson;
    if (!raw?.trim()) return null;
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      const layout = o.__qa_variableLayout;
      if (!layout || typeof layout !== "object" || Array.isArray(layout)) return null;
      const l = layout as Record<string, unknown>;
      const responsePath = typeof l.responsePath === "string" ? l.responsePath : "";
      const fields = Array.isArray(l.fields) ? l.fields : [];
      if (!responsePath) return null;
      return { responsePath, fields };
    } catch {
      return null;
    }
  }, [data?.webhookRequestJson]);

  const kindLabel = (kind: string) => QA_VARIABLE_CATALOG.find((c) => c.kind === kind)?.title ?? kind;

  async function saveResponsePath() {
    if (!agentId) return;
    const t = getStoredToken();
    if (!t) return;
    if (!responseExampleJson.trim()) {
      setError("Pega un JSON de ejemplo de respuesta.");
      return;
    }
    setSavingResponsePath(true);
    setError(null);
    try {
      await apiJson<{ ok: true }>(`/api/agents/${agentId}/project-response-path`, {
        method: "PATCH",
        token: t,
        body: JSON.stringify({ responseExampleJson: responseExampleJson.trim() })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la ruta de respuesta.");
    } finally {
      setSavingResponsePath(false);
    }
  }

  const docBundle = useMemo(() => tryParseContextBundle(data?.clientContext ?? ""), [data?.clientContext]);
  const instrBundle = useMemo(() => tryParseContextBundle(data?.testInstructions ?? ""), [data?.testInstructions]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Configuración del agente</h2>
      </div>

      {loading ? <p className="mt-8 text-sm text-zinc-500">Cargando…</p> : null}
      {error ? (
        <p className="mt-6 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <div className="mt-8 space-y-6">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h3 className="text-sm font-semibold text-white">Proyecto QA</h3>
            <p className="mt-1 text-sm text-zinc-400">{data.name}</p>
            <p className="mt-2 text-xs text-zinc-500">ID: {data.id}</p>
          </section>
          {qaPreview ? <AgentQaKnowledgePanel preview={qaPreview} /> : null}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h3 className="text-sm font-semibold text-white">Webhook</h3>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              Método:{" "}
              <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-zinc-200">{data.webhookMethod ?? "POST"}</span>
            </p>
            <p className="mt-2 break-all text-sm text-emerald-400/90">{data.webhookUrl}</p>
            <p className="mt-2 text-xs text-zinc-500">Token: {data.webhookAuthToken ? "· · · configurado" : "no"}</p>
            <div className="mt-4 grid gap-2 sm:max-w-md">
              <label className="text-xs font-medium text-zinc-400">JSON de ejemplo de respuesta</label>
              <textarea
                className="min-h-28 rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 font-mono text-sm text-zinc-100 outline-none ring-emerald-500/30 focus:border-emerald-600 focus:ring-2"
                onChange={(ev) => setResponseExampleJson(ev.target.value)}
                placeholder='{"reply":"Hola..."}'
                spellCheck={false}
                value={responseExampleJson}
              />
              <p className="text-[11px] text-zinc-500">
                Ruta actual detectada: <span className="font-mono text-zinc-300">{responsePath}</span>
              </p>
              <div>
                <button
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  disabled={savingResponsePath}
                  onClick={() => void saveResponsePath()}
                  type="button"
                >
                  {savingResponsePath ? "Guardando..." : "Guardar ruta de respuesta"}
                </button>
              </div>
            </div>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h3 className="text-sm font-semibold text-white">Cuerpo del webhook (POST)</h3>
            {variableLayout ? (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-zinc-500">
                  Respuesta del agente en el JSON:{" "}
                  <code className="rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-emerald-400/90">{variableLayout.responsePath}</code>
                </p>
                <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
                  {variableLayout.fields.map((f, i) => {
                    const item = f as Record<string, unknown>;
                    const kind = typeof item.kind === "string" ? item.kind : "";
                    const key = typeof item.key === "string" ? item.key : "";
                    return (
                      <li className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between" key={`${kind}-${key}-${i}`}>
                        <span className="text-sm text-zinc-200">{kindLabel(kind)}</span>
                        <code className="text-xs text-emerald-400/90">{key}</code>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : data.webhookRequestJson ? (
              <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300">{data.webhookRequestJson}</pre>
            ) : (
              <p className="mt-2 text-xs text-zinc-500">
                Legacy: campos {data.webhookMessageField}, {data.webhookSessionField}, respuesta {data.responseMessageField}
              </p>
            )}
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h3 className="text-sm font-semibold text-white">Documentación / conocimiento</h3>
            {docBundle ? (
              <ul className="mt-4 space-y-3">
                {docBundle.items.map((it, i) => (
                  <li className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4" key={`doc-${i}`}>
                    <p className="text-sm text-zinc-200">
                      {it.description.trim() ? it.description : <span className="text-zinc-500">(sin descripción)</span>}
                    </p>
                    {it.fileName ? (
                      <p className="mt-2 text-xs text-zinc-500">
                        Archivo: <span className="text-zinc-300">{it.fileName}</span>
                        {it.mimeType ? ` · ${it.mimeType}` : null}
                      </p>
                    ) : null}
                    {it.dataBase64 ? (
                      <DownloadBase64Button
                        dataBase64={it.dataBase64}
                        fileName={it.fileName || "documento"}
                        mimeType={it.mimeType}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : String(data.clientContext ?? "").trim() ? (
              <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{data.clientContext}</p>
            ) : (
              <p className="mt-3 text-xs text-zinc-500">Sin documentación guardada.</p>
            )}
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h3 className="text-sm font-semibold text-white">Instrucciones de las pruebas</h3>
            {instrBundle ? (
              <ul className="mt-4 space-y-3">
                {instrBundle.items.map((it, i) => (
                  <li className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4" key={`ins-${i}`}>
                    <p className="text-sm text-zinc-200">
                      {it.description.trim() ? it.description : <span className="text-zinc-500">(sin descripción)</span>}
                    </p>
                    {it.fileName ? (
                      <p className="mt-2 text-xs text-zinc-500">
                        Archivo: <span className="text-zinc-300">{it.fileName}</span>
                        {it.mimeType ? ` · ${it.mimeType}` : null}
                      </p>
                    ) : null}
                    {it.dataBase64 ? (
                      <DownloadBase64Button
                        dataBase64={it.dataBase64}
                        fileName={it.fileName || "instrucciones"}
                        mimeType={it.mimeType}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : String(data.testInstructions ?? "").trim() ? (
              <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{data.testInstructions}</p>
            ) : (
              <p className="mt-3 text-xs text-zinc-500">Sin instrucciones guardadas.</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
