export type QaContextItemView = {
  description: string;
  fileName?: string;
  mimeType?: string;
  dataBase64?: string;
};

export type QaContextBundleView = { v: 1; items: QaContextItemView[] };

export function tryParseContextBundle(raw: string | null | undefined): QaContextBundleView | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  try {
    const o = JSON.parse(t) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const rec = o as Record<string, unknown>;
    if (rec.v !== 1 || !Array.isArray(rec.items)) return null;
    const items: QaContextItemView[] = [];
    for (const it of rec.items) {
      if (!it || typeof it !== "object" || Array.isArray(it)) continue;
      const row = it as Record<string, unknown>;
      items.push({
        description: typeof row.description === "string" ? row.description : "",
        fileName: typeof row.fileName === "string" ? row.fileName : undefined,
        mimeType: typeof row.mimeType === "string" ? row.mimeType : undefined,
        dataBase64: typeof row.dataBase64 === "string" ? row.dataBase64 : undefined
      });
    }
    if (!items.length) return null;
    return { v: 1, items };
  } catch {
    return null;
  }
}
