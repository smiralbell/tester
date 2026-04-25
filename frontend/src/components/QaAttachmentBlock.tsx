"use client";

import { useCallback } from "react";

export type QaAttachmentFormRow = { id: string; description: string; file: File | null };

const input =
  "rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500/30 placeholder:text-zinc-600 focus:border-emerald-600 focus:ring-2";

export function createEmptyAttachmentRow(): QaAttachmentFormRow {
  return { id: globalThis.crypto?.randomUUID?.() ?? String(Math.random()), description: "", file: null };
}

export const QA_ATTACHMENT_MAX_BYTES = Math.floor(2.5 * 1024 * 1024);

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result;
      if (typeof result !== "string") {
        reject(new Error("Lectura de archivo inválida"));
        return;
      }
      const i = result.indexOf(",");
      resolve(i >= 0 ? result.slice(i + 1) : result);
    };
    r.onerror = () => reject(r.error ?? new Error("No se pudo leer el archivo"));
    r.readAsDataURL(file);
  });
}

export async function attachmentRowsToApiItems(rows: QaAttachmentFormRow[]) {
  const out: Array<{ description: string; fileName?: string; mimeType?: string; dataBase64?: string }> = [];
  for (const row of rows) {
    if (!row.description.trim() && !row.file) continue;
    if (row.file && row.file.size > QA_ATTACHMENT_MAX_BYTES) {
      throw new Error(`El archivo «${row.file.name}» supera el máximo de ${Math.round(QA_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB.`);
    }
    let dataBase64: string | undefined;
    let fileName: string | undefined;
    let mimeType: string | undefined;
    if (row.file) {
      dataBase64 = await readFileAsBase64(row.file);
      fileName = row.file.name;
      mimeType = row.file.type || "application/octet-stream";
    }
    out.push({
      description: row.description.trim(),
      fileName,
      mimeType,
      dataBase64
    });
  }
  return out;
}

type Props = {
  title: string;
  hint: string;
  rows: QaAttachmentFormRow[];
  onChange: (rows: QaAttachmentFormRow[]) => void;
};

export function QaAttachmentBlock({ title, hint, rows, onChange }: Props) {
  const updateRow = useCallback(
    (id: string, patch: Partial<Pick<QaAttachmentFormRow, "description" | "file">>) => {
      onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [onChange, rows]
  );

  const removeRow = useCallback(
    (id: string) => {
      if (rows.length <= 1) {
        onChange([createEmptyAttachmentRow()]);
        return;
      }
      onChange(rows.filter((r) => r.id !== id));
    },
    [onChange, rows]
  );

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-500">{hint}</p>
        </div>
        <button
          className="shrink-0 rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          onClick={() => onChange([...rows, createEmptyAttachmentRow()])}
          type="button"
        >
          + Añadir
        </button>
      </div>

      <ul className="mt-5 grid gap-4">
        {rows.map((row, index) => (
          <li className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4" key={row.id}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Entrada {index + 1}</span>
              <button
                className="text-xs text-zinc-500 hover:text-red-400"
                onClick={() => removeRow(row.id)}
                type="button"
              >
                Quitar
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-start">
              <label className="flex flex-col gap-1.5 text-xs text-zinc-400">
                <span className="font-medium text-zinc-300">Archivo (opcional)</span>
                <input
                  accept="*/*"
                  className="text-xs file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-200"
                  onChange={(ev) => {
                    const f = ev.target.files?.[0] ?? null;
                    updateRow(row.id, { file: f });
                  }}
                  type="file"
                />
                {row.file ? (
                  <span className="truncate text-[11px] text-emerald-500/90" title={row.file.name}>
                    {row.file.name} ({(row.file.size / 1024).toFixed(1)} KB)
                  </span>
                ) : (
                  <span className="text-[11px] text-zinc-600">Máx. ~{Math.round(QA_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB c/u</span>
                )}
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-zinc-300">
                <span className="font-medium">Descripción breve</span>
                <textarea
                  className={`${input} min-h-[88px] resize-y`}
                  onChange={(ev) => updateRow(row.id, { description: ev.target.value })}
                  placeholder="Qué es este documento o qué debe tenerse en cuenta…"
                  value={row.description}
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
