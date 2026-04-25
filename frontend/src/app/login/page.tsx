"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { getStoredToken, setStoredToken } from "@/lib/auth-token";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getStoredToken()) {
      router.replace("/agentes");
    }
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiJson<{ access_token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      setStoredToken(data.access_token);
      router.push("/agentes");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-zinc-950 to-zinc-950" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-500/90">Buffalo QA</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Acceso al panel</h1>
          <p className="mt-2 text-sm text-zinc-500">Credenciales definidas en el servidor (variables de entorno).</p>
        </div>
        <form
          className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-xl shadow-black/40 backdrop-blur"
          onSubmit={onSubmit}
        >
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-1.5 text-sm text-zinc-300">
              <span className="font-medium">Usuario</span>
              <input
                autoComplete="username"
                className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-zinc-100 outline-none ring-emerald-500/30 placeholder:text-zinc-600 focus:border-emerald-600 focus:ring-2"
                name="username"
                onChange={(ev) => setUsername(ev.target.value)}
                required
                type="text"
                value={username}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-zinc-300">
              <span className="font-medium">Contraseña</span>
              <input
                autoComplete="current-password"
                className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-zinc-100 outline-none ring-emerald-500/30 focus:border-emerald-600 focus:ring-2"
                name="password"
                onChange={(ev) => setPassword(ev.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            {error ? (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="mt-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              disabled={loading}
              type="submit"
            >
              {loading ? "Entrando…" : "Entrar al panel"}
            </button>
          </div>
        </form>
        <p className="mt-6 text-center text-xs text-zinc-600">
          Variables <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">AUTH_USERNAME</code> y{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">AUTH_PASSWORD</code> en el backend.
        </p>
      </div>
    </div>
  );
}
