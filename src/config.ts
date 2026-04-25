import { config } from "dotenv";

config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const defaultJwtSecret = "dev-only-change-JWT_SECRET-in-production-min-32-chars";

export const appConfig = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required("DATABASE_URL"),
  openRouterApiKey: required("OPENROUTER_API_KEY"),
  openRouterModel: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 30000),
  webhookMaxRetries: Number(process.env.WEBHOOK_MAX_RETRIES ?? 2),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "*").split(",").map((item) => item.trim()),
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  /** HS256 secret for panel auth (`/api/auth/*`). Set `JWT_SECRET` in production. */
  jwtSecret: process.env.JWT_SECRET ?? defaultJwtSecret,
  /** Credenciales únicas del panel (login fijo por variables de entorno). */
  authUsername: required("AUTH_USERNAME"),
  authPassword: required("AUTH_PASSWORD"),
  /**
   * Origen del panel Next (sin barra final). Si el login te redirige a :8000/dashboard,
   * el API redirige GET no-API a esta URL (mismo path y query).
   */
  frontendUrl: (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, "")
};

if (!process.env.JWT_SECRET) {
  console.warn("[auth] JWT_SECRET not set; using insecure dev default. Set JWT_SECRET for production.");
}
