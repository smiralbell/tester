import { Buffer } from "node:buffer";

export type QaContextItem = {
  description: string;
  fileName?: string;
  mimeType?: string;
  /** Base64 del archivo (opcional). */
  dataBase64?: string;
};

export type QaContextBundle = { v: 1; items: QaContextItem[] };

const MAX_PROMPT_TEXT_BYTES = 24_000;

export function parseContextBundle(raw: string | null | undefined): QaContextBundle | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  try {
    const o = JSON.parse(t) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const rec = o as Record<string, unknown>;
    if (rec.v !== 1 || !Array.isArray(rec.items)) return null;
    const items: QaContextItem[] = [];
    for (const it of rec.items) {
      if (!it || typeof it !== "object" || Array.isArray(it)) continue;
      const row = it as Record<string, unknown>;
      const description = typeof row.description === "string" ? row.description : "";
      const fileName = typeof row.fileName === "string" ? row.fileName : undefined;
      const mimeType = typeof row.mimeType === "string" ? row.mimeType : undefined;
      const dataBase64 = typeof row.dataBase64 === "string" ? row.dataBase64 : undefined;
      items.push({ description, fileName, mimeType, dataBase64 });
    }
    return { v: 1, items };
  } catch {
    return null;
  }
}

/** Texto listo para inyectar en prompts del runner (soporta bundle v1 o texto plano legacy). */
export function contextToPromptText(raw: string | null | undefined): string {
  const bundle = parseContextBundle(raw);
  if (bundle && bundle.items.length > 0) {
    const parts: string[] = [];
    for (let i = 0; i < bundle.items.length; i++) {
      const it = bundle.items[i];
      let block = `### Entrada ${i + 1}\n`;
      block += `Descripción: ${it.description.trim() || "(sin descripción)"}\n`;
      if (it.fileName) {
        block += `Archivo: ${it.fileName}${it.mimeType ? ` (${it.mimeType})` : ""}\n`;
      }
      if (it.dataBase64 && it.mimeType?.startsWith("text/")) {
        try {
          const buf = Buffer.from(it.dataBase64, "base64");
          let text = buf.toString("utf8");
          if (text.length > MAX_PROMPT_TEXT_BYTES) {
            text = `${text.slice(0, MAX_PROMPT_TEXT_BYTES)}\n…(truncado)`;
          }
          block += `Contenido (texto):\n${text}\n`;
        } catch {
          block += "(No se pudo leer el contenido de texto del adjunto.)\n";
        }
      } else if (it.dataBase64) {
        block +=
          "Nota: hay un archivo adjunto en base64 (binario o no texto); su contenido no se expande íntegro en el prompt.\n";
      }
      parts.push(block);
    }
    return parts.join("\n");
  }
  const plain = (raw ?? "").trim();
  if (plain) return plain;
  return "(Sin contenido en esta sección.)";
}

export function serializeContextBundle(items: QaContextItem[]): string {
  return JSON.stringify({ v: 1 as const, items });
}

/** Inventario legible para el panel (qué entradas hay y cómo llegan al modelo). */
export type ContextInventoryEntry = {
  index: number;
  description: string;
  fileName?: string;
  mimeType?: string;
  /** Contenido textual del adjunto se expande en el prompt (hasta límite). */
  textExpandedInPrompt: boolean;
  /** Adjunto binario / no texto: el modelo solo recibe una nota, no el binario íntegro. */
  binaryAttachmentNote: boolean;
};

export type ContextInventory = {
  format: "bundle" | "plain" | "empty";
  entries: ContextInventoryEntry[];
  /** Primeros caracteres si es texto plano legacy (solo vista). */
  plainPreview?: string;
};

export function inventoryContext(raw: string | null | undefined): ContextInventory {
  const bundle = parseContextBundle(raw);
  if (bundle && bundle.items.length > 0) {
    return {
      format: "bundle",
      entries: bundle.items.map((it, i) => ({
        index: i + 1,
        description: it.description ?? "",
        fileName: it.fileName,
        mimeType: it.mimeType,
        textExpandedInPrompt: Boolean(it.dataBase64 && it.mimeType?.startsWith("text/")),
        binaryAttachmentNote: Boolean(it.dataBase64 && !it.mimeType?.startsWith("text/"))
      }))
    };
  }
  const plain = (raw ?? "").trim();
  if (plain) {
    return {
      format: "plain",
      entries: [
        {
          index: 1,
          description: "Texto plano almacenado (formato legacy, sin lista de adjuntos).",
          textExpandedInPrompt: true,
          binaryAttachmentNote: false
        }
      ],
      plainPreview: plain.length > 600 ? `${plain.slice(0, 600)}…` : plain
    };
  }
  return { format: "empty", entries: [] };
}
