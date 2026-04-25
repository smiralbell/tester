"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth-token";

type MeResponse = { user: { id: string; email: string; full_name: string | null } };

const nav = [
  { href: "/agentes", label: "Agentes", desc: "Alta y configuración QA" },
  { href: "/pruebas", label: "Pruebas", desc: "Runs contra agentes" },
  { href: "/estadisticas", label: "Estadísticas", desc: "KPIs, tendencias y gráficos" }
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<MeResponse["user"] | null>(null);

  const loadUser = useCallback(async (token: string) => {
    try {
      const me = await apiJson<MeResponse>("/api/auth/me", { token });
      setUser(me.user);
    } catch {
      clearStoredToken();
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.replace("/login");
      return;
    }
    void loadUser(t).finally(() => setReady(true));
  }, [loadUser, router]);

  function logout() {
    clearStoredToken();
    router.replace("/login");
    router.refresh();
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        <p className="text-sm">Cargando sesión…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <aside className="fixed left-0 top-0 z-30 flex h-screen w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/90">
        <div className="border-b border-zinc-800 px-5 py-6">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Buffalo QA</p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-white">Panel agentes</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-3">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                className={`rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
                }`}
                href={item.href}
                key={item.href}
              >
                <span className="font-medium">{item.label}</span>
                <span className="mt-0.5 block text-xs font-normal text-zinc-500">{item.desc}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-zinc-800 p-3">
          <button
            className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            onClick={logout}
            type="button"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="ml-64 flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            {pathname.startsWith("/agentes/") ? (
              <Link
                aria-label="Volver al listado de agentes"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-white"
                href="/agentes"
              >
                <svg aria-hidden className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ) : null}
            <div>
              <h1 className="text-sm font-medium text-zinc-400">
                {nav.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`))?.label ?? "Panel"}
              </h1>
            </div>
          </div>
          {user ? (
            <div className="text-right text-xs text-zinc-500">
              <p className="font-medium text-zinc-300">{user.full_name ?? user.email}</p>
              <p>{user.email}</p>
            </div>
          ) : null}
        </header>
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
