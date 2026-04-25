import type { Context } from "hono";
import { Hono } from "hono";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { appConfig } from "./config";
import { query } from "./db";

const encoder = new TextEncoder();

function secretKey() {
  return encoder.encode(appConfig.jwtSecret);
}

/** JSON o application/x-www-form-urlencoded (OAuth2 / form login). */
export async function readBodyObject(c: Context): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  const trimmed = text.trim();
  if (!trimmed) return {};
  const first = trimmed[0];
  if (first === "{" || first === "[") {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* seguir como form */
    }
  }
  const params = new URLSearchParams(trimmed);
  const out: Record<string, unknown> = {};
  for (const [k, v] of params.entries()) {
    out[k] = v;
  }
  return out;
}

function pickLogin(raw: Record<string, unknown>): string {
  const candidates = [raw.username, raw.user, raw.login, raw.email];
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s) return s;
  }
  return "";
}

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  password_hash: string;
}

async function signAccessToken(userId: string, email: string): Promise<string> {
  return new SignJWT({ sub: userId, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey());
}

export async function getBearerUserId(c: Context): Promise<string | null> {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match?.[1]) return null;
  try {
    const { payload } = await jwtVerify(match[1], secretKey(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

async function ensureFixedUserRow(): Promise<{ id: string; email: string; full_name: string | null }> {
  const username = appConfig.authUsername.trim();
  const existing = await query<{ id: string; email: string; full_name: string | null }>(
    `SELECT id, email, full_name FROM users WHERE email = $1`,
    [username]
  );
  if (existing[0]) {
    return existing[0];
  }

  const passwordHash = await Bun.password.hash(appConfig.authPassword, {
    algorithm: "bcrypt",
    cost: 10
  });
  const rows = await query<{ id: string; email: string; full_name: string | null }>(
    `INSERT INTO users (email, full_name, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, email, full_name`,
    [username, "Administrador", passwordHash]
  );
  if (!rows[0]) {
    throw new Error("No se pudo inicializar el usuario fijo de acceso");
  }
  return rows[0];
}

export function createAuthRoutes(): Hono {
  const r = new Hono();

  r.post("/register", async (c) => {
    return c.json(
      { detail: "Registro deshabilitado. Usa el usuario/contraseña configurados en AUTH_USERNAME y AUTH_PASSWORD." },
      403
    );
  });

  r.post("/login", async (c) => {
    const raw = await readBodyObject(c);
    const loginStr = pickLogin(raw);
    const password = String(raw.password ?? "").trim();
    if (!loginStr || !password) {
      return c.json({ detail: "Usuario y contraseña son obligatorios" }, 400);
    }
    const body = loginSchema.safeParse({ username: loginStr, password });
    if (!body.success) {
      return c.json({ detail: "Usuario y contraseña son obligatorios" }, 400);
    }
    if (body.data.username !== appConfig.authUsername || body.data.password !== appConfig.authPassword) {
      return c.json({ detail: "Usuario o contraseña incorrectos" }, 401);
    }

    const user = await ensureFixedUserRow();
    const access_token = await signAccessToken(user.id, user.email);
    return c.json({
      access_token,
      token: access_token,
      token_type: "bearer",
      user: { id: user.id, email: user.email, full_name: user.full_name }
    });
  });

  r.get("/me", async (c) => {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) {
      return c.json({ detail: "No autenticado" }, 401);
    }
    try {
      const { payload } = await jwtVerify(match[1], secretKey(), { algorithms: ["HS256"] });
      const sub = typeof payload.sub === "string" ? payload.sub : null;
      if (!sub) {
        return c.json({ detail: "Token invalido" }, 401);
      }
      const rows = await query<{ id: string; email: string; full_name: string | null }>(
        `SELECT id, email, full_name FROM users WHERE id = $1`,
        [sub]
      );
      const user = rows[0];
      if (!user) {
        return c.json(
          { user: { id: "fixed-user", email: appConfig.authUsername, full_name: "Administrador" } },
          200
        );
      }
      return c.json({ user });
    } catch {
      return c.json({ detail: "Token invalido" }, 401);
    }
  });

  return r;
}
