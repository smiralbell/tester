import { randomUUID } from "node:crypto";

/** Valores fijos de QA (España inventado para pruebas). */
export const QA_PHONE_ES = "+34600123456";
export const QA_DOCUMENT_SAMPLE =
  "Documento de ejemplo QA (panel Buffalo). Contenido ficticio para pruebas automatizadas.";
export const QA_LINK_SAMPLE = "https://ejemplo-qa.buffalo.local/recurso";
export const QA_IMAGE_URL =
  "https://placehold.co/600x400/1a1a1a/4ade80/png?text=QA+Buffalo";

export const QA_VARIABLE_KINDS = [
  "tester_message",
  "session_id",
  "datetime",
  "qa_id",
  "phone",
  "document",
  "link",
  "image"
] as const;

export type QaVariableKind = (typeof QA_VARIABLE_KINDS)[number];

export interface QaVariableField {
  kind: QaVariableKind;
  /** Ruta en el JSON del POST, p. ej. `message` o `payload.user.phone` */
  key: string;
}

export interface QaVariableLayout {
  v: 1;
  responsePath: string;
  fields: QaVariableField[];
}

export interface QaVariableLayoutInput {
  responsePath: string;
  fields: QaVariableField[];
}

const KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
const RESPONSE_PATH_RE = /^(?:[a-zA-Z_][a-zA-Z0-9_]*|\d+)(?:\.(?:[a-zA-Z_][a-zA-Z0-9_]*|\d+))*$/;

export function validateLayoutInput(input: QaVariableLayoutInput): string | null {
  const rp = input.responsePath.trim();
  if (!rp) return "La ruta de respuesta es obligatoria.";
  if (!RESPONSE_PATH_RE.test(rp)) {
    return "Ruta de respuesta inválida (ej. reply, data.message o 0.output).";
  }

  const fields = input.fields;
  if (!fields.length) return "Añade al menos una variable al cuerpo del webhook.";

  const keys = new Set<string>();
  const kinds = new Set<QaVariableKind>();

  for (const f of fields) {
    const key = f.key.trim();
    if (!key) return "Cada variable activa necesita un nombre de campo en el JSON.";
    if (!KEY_RE.test(key)) {
      return `Nombre de campo inválido: "${key}". Usa letras, números y _; segmentos separados por puntos (ej. user.phone).`;
    }
    if (keys.has(key)) return `El nombre de campo "${key}" está duplicado.`;
    keys.add(key);

    if (!QA_VARIABLE_KINDS.includes(f.kind)) return `Tipo de variable desconocido: ${String(f.kind)}`;
    if (kinds.has(f.kind)) return "Cada tipo de variable solo puede usarse una vez.";
    kinds.add(f.kind);
  }

  if (!kinds.has("tester_message")) {
    return "Debes incluir la variable «Mensaje del test» (es obligatoria para las pruebas).";
  }

  return null;
}

export function serializeLayout(input: QaVariableLayoutInput): string {
  const err = validateLayoutInput(input);
  if (err) throw new Error(err);

  const layout: QaVariableLayout = {
    v: 1,
    responsePath: input.responsePath.trim(),
    fields: input.fields.map((f) => ({
      kind: f.kind,
      key: f.key.trim()
    }))
  };

  return JSON.stringify({ __qa_variableLayout: layout });
}

export function parseLayoutFromStoredJson(jsonStr: string | null | undefined): QaVariableLayout | null {
  if (!jsonStr?.trim()) return null;
  const root = safeJsonParse<Record<string, unknown>>(jsonStr.trim());
  if (!root) return null;
  const raw = root.__qa_variableLayout;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const responsePath = typeof o.responsePath === "string" ? o.responsePath : "";
  const fieldsRaw = o.fields;
  if (!Array.isArray(fieldsRaw)) return null;
  const fields: QaVariableField[] = [];
  for (const item of fieldsRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const it = item as Record<string, unknown>;
    const kind = it.kind;
    const key = it.key;
    if (typeof kind !== "string" || !QA_VARIABLE_KINDS.includes(kind as QaVariableKind)) continue;
    if (typeof key !== "string") continue;
    fields.push({ kind: kind as QaVariableKind, key });
  }
  if (!responsePath || !fields.length) return null;
  return { v: 1, responsePath, fields };
}

export function isVariableLayoutPayload(root: Record<string, unknown>): boolean {
  const raw = root.__qa_variableLayout;
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw));
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function setByPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) throw new Error("Ruta de campo vacía");
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = cur[p];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value as unknown;
}

export function buildWebhookBodyFromLayout(
  layout: QaVariableLayout,
  testerMessage: string
): { payload: Record<string, unknown>; responsePath: string } {
  const sessionId = randomUUID();
  const qaId = randomUUID();
  const iso = new Date().toISOString();

  const byKind: Record<QaVariableKind, unknown> = {
    tester_message: testerMessage,
    session_id: sessionId,
    datetime: iso,
    qa_id: qaId,
    phone: QA_PHONE_ES,
    document: QA_DOCUMENT_SAMPLE,
    link: QA_LINK_SAMPLE,
    image: QA_IMAGE_URL
  };

  const payload: Record<string, unknown> = {};
  for (const f of layout.fields) {
    setByPath(payload, f.key, byKind[f.kind]);
  }

  return { payload, responsePath: layout.responsePath.trim() };
}

const RESPONSE_HINT_KEYS = new Set(["reply", "message", "text", "answer", "response", "content"]);

function collectStringLeafPaths(
  value: unknown,
  basePath: string,
  out: Array<{ path: string; val: string }>
): void {
  if (typeof value === "string") {
    out.push({ path: basePath, val: value });
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const next = basePath ? `${basePath}.${i}` : String(i);
      collectStringLeafPaths(value[i], next, out);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const next = basePath ? `${basePath}.${k}` : k;
    collectStringLeafPaths(v, next, out);
  }
}

/** Dado un JSON de ejemplo de respuesta del webhook, infiere la ruta del mensaje textual. */
export function inferResponsePathFromExampleJson(exampleJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(exampleJson);
  } catch {
    throw new Error("El JSON de ejemplo de respuesta no es válido.");
  }
  const leaves: Array<{ path: string; val: string }> = [];
  collectStringLeafPaths(parsed, "", leaves);
  if (!leaves.length) {
    throw new Error("No se encontró ningún campo de texto en el JSON de ejemplo.");
  }
  const withPath = leaves.filter((x) => x.path.trim().length > 0);
  if (!withPath.length) {
    throw new Error(
      "No se pudo inferir una ruta de respuesta. Usa un JSON con campos (objeto/array), por ejemplo {\"reply\":\"...\"}."
    );
  }

  for (const item of withPath) {
    const key = item.path.split(".").at(-1)?.toLowerCase() ?? "";
    if (RESPONSE_HINT_KEYS.has(key) && item.val.trim().length > 0) {
      return item.path;
    }
  }
  for (const item of withPath) {
    if (item.val.trim().length > 0) return item.path;
  }
  return withPath[0].path;
}
