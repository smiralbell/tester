"use client";

import { useCallback, useState } from "react";
import type { QaKnowledgePreviewResponse } from "@/types/qa-knowledge-preview";

type Props = {
  preview: QaKnowledgePreviewResponse;
};

function InventoryTable({ title, inv }: { title: string; inv: QaKnowledgePreviewResponse["documentation"]["inventory"] }) {
  if (inv.format === "empty") {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <p className="text-xs font-medium text-zinc-400">{title}</p>
        <p className="mt-1 text-xs text-zinc-600">Sin entradas.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-xs font-medium text-zinc-400">{title}</p>
      {inv.format === "plain" && inv.plainPreview ? (
        <p className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-500">{inv.plainPreview}</p>
      ) : null}
      <ul className="mt-2 space-y-2">
        {inv.entries.map((e) => (
          <li className="border-l-2 border-emerald-600/50 pl-2 text-xs text-zinc-300" key={e.index}>
            <span className="font-mono text-zinc-500">#{e.index}</span>{" "}
            {e.description.trim() ? e.description : <span className="text-zinc-600">(sin descripción)</span>}
            {e.fileName ? (
              <span className="mt-0.5 block text-[11px] text-zinc-500">
                Archivo: {e.fileName}
                {e.mimeType ? ` · ${e.mimeType}` : ""}
              </span>
            ) : null}
            <span className="mt-1 flex flex-wrap gap-1">
              {e.textExpandedInPrompt ? (
                <span className="rounded bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400/90">Texto en prompt</span>
              ) : null}
              {e.binaryAttachmentNote ? (
                <span className="rounded bg-amber-950/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-400/90">Binario: solo nota</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PromptBlock({ label, text, truncated }: { label: string; text: string; truncated: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800/50"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <span>{label}</span>
        <span className="shrink-0 text-zinc-500">{open ? "Ocultar" : "Ver texto"}</span>
      </button>
      {truncated ? <p className="border-t border-zinc-800 px-3 py-1 text-[10px] text-amber-500/90">Vista truncada por tamaño.</p> : null}
      {open ? (
        <pre className="max-h-[min(70vh,520px)] overflow-auto border-t border-zinc-800 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

export function AgentQaKnowledgePanel({ preview }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(`err-${key}`);
      window.setTimeout(() => setCopied(null), 2500);
    }
  }, []);

  return (
    <section className="rounded-xl border border-emerald-900/40 bg-gradient-to-b from-emerald-950/20 to-zinc-900/40 p-5">
      <h3 className="text-sm font-semibold text-white">Conocimiento en pruebas (vista alineada con RAG)</h3>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">{preview.meta.explanation}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        Estrategia: el inventario resume cada documento/instrucción; el texto desplegable es exactamente el que recibe el modelo al ejecutar escenarios. Si no coincide con el RAG real del cliente en producción, los resultados de QA no serán fiables.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <InventoryTable inv={preview.documentation.inventory} title="Inventario · Documentación" />
        <InventoryTable inv={preview.instructions.inventory} title="Inventario · Instrucciones de prueba" />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400">Texto modelo · Documentación</span>
            <button
              className="text-[11px] font-medium text-emerald-500 hover:text-emerald-400"
              onClick={() => void copy("doc", preview.documentation.asPromptText)}
              type="button"
            >
              {copied === "doc" ? "Copiado" : copied === "err-doc" ? "Error" : "Copiar"}
            </button>
          </div>
          <PromptBlock label="Contexto del cliente (prompt)" text={preview.documentation.asPromptText} truncated={preview.documentation.truncated} />
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400">Texto modelo · Instrucciones</span>
            <button
              className="text-[11px] font-medium text-emerald-500 hover:text-emerald-400"
              onClick={() => void copy("ins", preview.instructions.asPromptText)}
              type="button"
            >
              {copied === "ins" ? "Copiado" : copied === "err-ins" ? "Error" : "Copiar"}
            </button>
          </div>
          <PromptBlock label="Instrucciones del test (prompt)" text={preview.instructions.asPromptText} truncated={preview.instructions.truncated} />
        </div>
      </div>
    </section>
  );
}
