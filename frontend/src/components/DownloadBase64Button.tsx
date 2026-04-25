"use client";

type Props = {
  fileName: string;
  mimeType?: string;
  dataBase64: string;
};

/** Evita `href` data: gigantes en el DOM (rompen React/Next en dev). */
export function DownloadBase64Button({ fileName, mimeType, dataBase64 }: Props) {
  function onClick() {
    try {
      const bin = atob(dataBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType ?? "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "archivo";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.alert("No se pudo preparar la descarga del adjunto.");
    }
  }

  return (
    <button
      className="mt-3 text-xs font-medium text-emerald-500 hover:text-emerald-400"
      onClick={onClick}
      type="button"
    >
      Descargar adjunto
    </button>
  );
}
