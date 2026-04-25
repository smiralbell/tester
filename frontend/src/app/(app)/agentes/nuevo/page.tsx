"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";
import {
  attachmentRowsToApiItems,
  createEmptyAttachmentRow,
  QaAttachmentBlock,
  type QaAttachmentFormRow
} from "@/components/QaAttachmentBlock";
import { apiJson } from "@/lib/api";
import { getStoredToken } from "@/lib/auth-token";
import { QA_VARIABLE_CATALOG, type QaVariableKind } from "@/lib/qa-webhook-variables";

type AgentRow = { id: string; name: string };
type ProjectRow = { id: string };

const input =
  "rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500/30 placeholder:text-zinc-600 focus:border-emerald-600 focus:ring-2";
const label = "flex flex-col gap-1.5 text-sm text-zinc-300";

const WEBHOOK_HTTP_METHODS = ["POST", "GET", "PUT", "PATCH", "DELETE"] as const;

function inferResponsePathFromExampleJson(exampleJson: string): string {
  const parsed = JSON.parse(exampleJson) as unknown;
  const leaves: Array<{ path: string; val: string }> = [];
  const walk = (value: unknown, base: string) => {
    if (typeof value === "string") {
      leaves.push({ path: base, val: value });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, base ? `${base}.${i}` : String(i)));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, base ? `${base}.${k}` : k);
    }
  };
  walk(parsed, "");
  if (!leaves.length) throw new Error("No se encontró ningún campo de texto en el JSON de ejemplo.");
  const withPath = leaves.filter((x) => x.path.trim().length > 0);
  if (!withPath.length) {
    throw new Error("No se pudo inferir ruta. Usa un JSON con campos (objeto/array), ej. {\"reply\":\"...\"}.");
  }
  const hintKeys = new Set(["reply", "message", "text", "answer", "response", "content"]);
  const hinted = withPath.find((x) => hintKeys.has(x.path.split(".").at(-1)?.toLowerCase() ?? "") && x.val.trim());
  if (hinted) return hinted.path;
  return (withPath.find((x) => x.val.trim()) ?? withPath[0]).path;
}

function initialVarState(): Record<QaVariableKind, { enabled: boolean; key: string }> {
  const o = {} as Record<QaVariableKind, { enabled: boolean; key: string }>;
  for (const row of QA_VARIABLE_CATALOG) {
    o[row.kind] = {
      enabled: row.kind === "tester_message" || row.kind === "session_id",
      key: row.defaultKey
    };
  }
  return o;
}

export default function NuevoAgentePage() {
  const router = useRouter();
  const [agentName, setAgentName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookMethod, setWebhookMethod] = useState<(typeof WEBHOOK_HTTP_METHODS)[number]>("POST");
  const [webhookAuthToken, setWebhookAuthToken] = useState("");
  const [responseExampleJson, setResponseExampleJson] = useState('{"reply":"Hola, ¿en qué puedo ayudarte?"}');
  const [varState, setVarState] = useState(initialVarState);
  const [docRows, setDocRows] = useState<QaAttachmentFormRow[]>(() => [createEmptyAttachmentRow()]);
  const [instrRows, setInstrRows] = useState<QaAttachmentFormRow[]>(() => [createEmptyAttachmentRow()]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!getStoredToken()) {
      router.replace("/login");
    }
  }, [router]);

  const layoutPayload = useMemo(() => {
    const fields = QA_VARIABLE_CATALOG.filter((row) => {
      const s = varState[row.kind];
      return s.enabled && s.key.trim().length > 0;
    }).map((row) => ({
      kind: row.kind,
      key: varState[row.kind].key.trim()
    }));
    const inferredPath = inferResponsePathFromExampleJson(responseExampleJson.trim());
    return {
      responsePath: inferredPath,
      fields
    };
  }, [responseExampleJson, varState]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = getStoredToken();
    if (!t) return;
    if (!agentName.trim()) {
      setError("El nombre del agente es obligatorio.");
      return;
    }
    if (!webhookUrl.trim()) {
      setError("El webhook es obligatorio.");
      return;
    }
    if (!responseExampleJson.trim()) {
      setError("Pega un JSON de ejemplo de respuesta del webhook.");
      return;
    }
    if (!varState.tester_message.enabled || !varState.tester_message.key.trim()) {
      setError("El mensaje del test es obligatorio: actívalo y pon el nombre de campo que espera tu webhook.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      void inferResponsePathFromExampleJson(responseExampleJson.trim());
      const documentationItems = await attachmentRowsToApiItems(docRows);
      const testInstructionItems = await attachmentRowsToApiItems(instrRows);

      const agent = await apiJson<AgentRow>("/api/clients", {
        method: "POST",
        token: t,
        body: JSON.stringify({ name: agentName.trim() })
      });
      await apiJson<ProjectRow>("/projects", {
        method: "POST",
        body: JSON.stringify({
          clientId: agent.id,
          name: `${agentName.trim()} · QA`,
          webhookUrl: webhookUrl.trim(),
          webhookMethod,
          webhookAuthToken: webhookAuthToken.trim() || undefined,
          webhookVariableLayout: layoutPayload,
          documentationItems,
          testInstructionItems
        })
      });
      startTransition(() => {
        router.push("/agentes");
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="text-xl font-semibold tracking-tight text-white">Crear agente</h2>

      <form className="mt-8 grid gap-5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6" onSubmit={onSubmit}>
        <label className={label}>
          <span className="font-medium">Nombre del agente *</span>
          <input className={input} onChange={(ev) => setAgentName(ev.target.value)} value={agentName} />
        </label>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-3">
          <label className={`${label} min-w-0 flex-1`}>
            <span className="font-medium">URL del webhook *</span>
            <input className={input} onChange={(ev) => setWebhookUrl(ev.target.value)} type="url" value={webhookUrl} />
          </label>
          <label className={`${label} w-full shrink-0 sm:w-44`}>
            <span className="font-medium">Método HTTP</span>
            <select
              className={input}
              onChange={(ev) => setWebhookMethod(ev.target.value as (typeof WEBHOOK_HTTP_METHODS)[number])}
              value={webhookMethod}
            >
              {WEBHOOK_HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {webhookMethod === "GET" ? (
              <span className="text-[11px] leading-snug text-amber-500/90">
                GET: el cuerpo JSON va en el query <code className="text-amber-400">payload</code> (URL codificada). Útil solo si el payload es pequeño.
              </span>
            ) : null}
          </label>
        </div>

        <label className={label}>
          <span className="font-medium">Token de autenticación (opcional)</span>
          <input className={input} onChange={(ev) => setWebhookAuthToken(ev.target.value)} value={webhookAuthToken} />
        </label>

        <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Variables del cuerpo JSON (POST)</h3>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-500">
                Elige qué datos debe recibir este agente y con qué nombre llegan en el JSON. Puedes usar rutas con
                puntos (ej. <code className="text-emerald-500/90">payload.message</code>).
              </p>
            </div>
          </div>

          <label className={`${label} mt-5`}>
            <span className="font-medium text-zinc-200">JSON de ejemplo de respuesta *</span>
            <span className="text-xs text-zinc-500">
              Pega una respuesta real/ejemplo del webhook y el sistema detectará automáticamente dónde viene el texto del agente.
            </span>
            <textarea
              className={`${input} min-h-28 font-mono`}
              onChange={(ev) => setResponseExampleJson(ev.target.value)}
              placeholder='{"reply":"Hola..."}'
              value={responseExampleJson}
            />
          </label>

          <ul className="mt-6 grid gap-3">
            {QA_VARIABLE_CATALOG.map((row) => {
              const s = varState[row.kind];
              return (
                <li
                  className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 sm:flex-row sm:items-center sm:gap-4"
                  key={row.kind}
                >
                  <label className="flex cursor-pointer items-start gap-3 sm:min-w-[200px] sm:shrink-0">
                    <input
                      checked={s.enabled}
                      className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-emerald-600 focus:ring-emerald-500/40"
                      disabled={row.required}
                      onChange={(ev) =>
                        setVarState((prev) => ({
                          ...prev,
                          [row.kind]: { ...prev[row.kind], enabled: ev.target.checked }
                        }))
                      }
                      type="checkbox"
                    />
                    <span>
                      <span className="block text-sm font-medium text-zinc-100">{row.title}</span>
                      {row.required ? (
                        <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-wide text-emerald-500/80">
                          Obligatorio
                        </span>
                      ) : null}
                    </span>
                  </label>
                  <p className="hidden flex-1 text-xs leading-relaxed text-zinc-500 sm:block">{row.description}</p>
                  <div className="flex w-full flex-col gap-1 sm:max-w-[240px] sm:shrink-0">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Nombre en el JSON</span>
                    <input
                      className={`${input} ${!s.enabled ? "opacity-40" : ""}`}
                      disabled={!s.enabled}
                      onChange={(ev) =>
                        setVarState((prev) => ({
                          ...prev,
                          [row.kind]: { ...prev[row.kind], key: ev.target.value }
                        }))
                      }
                      placeholder={row.defaultKey}
                      spellCheck={false}
                      value={s.key}
                    />
                    <span className="text-[11px] text-zinc-600">
                      Ejemplo: <span className="font-mono text-zinc-400">{row.sample}</span>
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-500 sm:hidden">{row.description}</p>
                </li>
              );
            })}
          </ul>
        </section>

        <QaAttachmentBlock
          hint="Opcional. Añade tantas entradas como quieras: archivo y una descripción breve al lado. Puedes dejar solo la descripción o solo el archivo."
          onChange={setDocRows}
          rows={docRows}
          title="Documentación / conocimiento"
        />

        <QaAttachmentBlock
          hint="Opcional. Misma idea: archivos de referencia (guías, casos límite…) y descripción breve por entrada."
          onChange={setInstrRows}
          rows={instrRows}
          title="Instrucciones de las pruebas"
        />

        {error ? (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            disabled={creating}
            type="submit"
          >
            {creating ? "Guardando…" : "Guardar agente"}
          </button>
          <Link className="rounded-lg border border-zinc-600 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800" href="/agentes">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
