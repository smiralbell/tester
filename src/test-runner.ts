import { randomUUID } from "node:crypto";
import { appConfig } from "./config";
import { completeWithOpenRouter } from "./openrouter";
import type { Project, Scenario } from "./types";
import { contextToPromptText } from "./qa-context-bundle";
import {
  buildWebhookBodyFromLayout,
  isVariableLayoutPayload,
  parseLayoutFromStoredJson
} from "./webhook-variable-layout";

export interface ExchangeEvaluation {
  score: number;
  passed: boolean;
  errors: string[];
  advice: string[];
  notes: string;
}

export interface RunMetrics {
  averageScore: number;
  passed: boolean;
  errorCount: number;
  adviceCount: number;
  summary: string;
}

export interface TranscriptItem {
  testerMessage: string;
  agentReply: string;
  webhookResponseMs: number | null;
  evaluation: ExchangeEvaluation;
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

const WEBHOOK_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function normalizeWebhookMethod(raw: string | null | undefined): string {
  const m = (raw ?? "POST").toUpperCase().trim();
  return (WEBHOOK_HTTP_METHODS as readonly string[]).includes(m) ? m : "POST";
}

async function fetchAgentWebhook(
  project: Project,
  payload: unknown,
  signal: AbortSignal
): Promise<Response> {
  const method = normalizeWebhookMethod(project.webhookMethod);
  const headers: Record<string, string> = {};
  if (project.webhookAuthToken) {
    headers.Authorization = `Bearer ${project.webhookAuthToken}`;
  }

  if (method === "GET") {
    const u = new URL(project.webhookUrl);
    u.searchParams.set("payload", JSON.stringify(payload));
    return fetch(u.toString(), { method: "GET", headers, signal });
  }

  headers["Content-Type"] = "application/json";
  return fetch(project.webhookUrl, {
    method,
    headers,
    body: JSON.stringify(payload),
    signal
  });
}

function readPath(payload: Record<string, unknown>, path: string): string | null {
  const chunks = path.split(".");
  let current: unknown = payload;
  for (const key of chunks) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : null;
}

async function generateTesterMessage(project: Project, scenario: Scenario, transcript: TranscriptItem[]): Promise<string> {
  const previousTurns = transcript
    .map((item, index) => `Turn ${index + 1}\nTester: ${item.testerMessage}\nAgent: ${item.agentReply}`)
    .join("\n\n");

  const prompt = `
Eres QA de conversaciones para WhatsApp.
Contexto del cliente:
${contextToPromptText(project.clientContext)}

Instrucciones generales del test:
${contextToPromptText(project.testInstructions)}

Escenario:
Nombre: ${scenario.name}
Objetivo: ${scenario.goal}
Criterio de exito: ${scenario.successCriteria}

Conversacion previa:
${previousTurns || "Sin mensajes previos"}

Devuelve SOLO el siguiente mensaje que enviaria el cliente de prueba.
`;

  const nextMessage = await completeWithOpenRouter([
    {
      role: "system",
      content: "Genera mensajes realistas de cliente para pruebas QA."
    },
    { role: "user", content: prompt }
  ]);

  return nextMessage.trim();
}

async function evaluateTurn(project: Project, scenario: Scenario, testerMessage: string, agentReply: string): Promise<ExchangeEvaluation> {
  const evalPrompt = `
Evalua una respuesta de un agente de WhatsApp.
Contexto cliente:
${contextToPromptText(project.clientContext)}

Instrucciones del agente:
${contextToPromptText(project.testInstructions)}

Escenario:
${scenario.name}
Objetivo: ${scenario.goal}
Exito esperado: ${scenario.successCriteria}

Mensaje del cliente:
${testerMessage}

Respuesta del agente:
${agentReply}

Devuelve JSON valido con esta forma exacta:
{
  "score": 0-100,
  "passed": true o false,
  "errors": ["lista de errores concretos"],
  "advice": ["lista de mejoras concretas"],
  "notes": "explicacion breve"
}
`;

  const raw = await completeWithOpenRouter([
    {
      role: "system",
      content: "Eres evaluador QA estricto. Devuelves solo JSON valido."
    },
    { role: "user", content: evalPrompt }
  ]);

  const parsed = safeJsonParse<ExchangeEvaluation>(raw);
  if (!parsed) {
    return {
      score: 0,
      passed: false,
      errors: ["No se pudo parsear la evaluacion JSON del modelo"],
      advice: ["Reducir ambiguedad del prompt de evaluacion"],
      notes: raw.slice(0, 200)
    };
  }

  return {
    score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
    passed: Boolean(parsed.passed),
    errors: Array.isArray(parsed.errors) ? parsed.errors : [],
    advice: Array.isArray(parsed.advice) ? parsed.advice : [],
    notes: parsed.notes ?? ""
  };
}

function applyWebhookTemplate(
  templateRoot: Record<string, unknown>,
  vars: { testerMessage: string; sessionId: string }
): { payload: unknown; responsePath: string } {
  const responsePathRaw = templateRoot.__qa_responsePath;
  const responsePath = typeof responsePathRaw === "string" && responsePathRaw.trim() ? responsePathRaw.trim() : "reply";

  const bodyTemplate: Record<string, unknown> = { ...templateRoot };
  delete bodyTemplate.__qa_responsePath;

  const iso = new Date().toISOString();
  const replacers: [string, string][] = [
    ["{{TESTER_MESSAGE}}", vars.testerMessage],
    ["{{SESSION_ID}}", vars.sessionId],
    ["{{ISO_TIMESTAMP}}", iso]
  ];

  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      let s = value;
      for (const [needle, rep] of replacers) {
        if (s.includes(needle)) {
          s = s.split(needle).join(rep);
        }
      }
      return s;
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return value;
  };

  const built = walk(bodyTemplate);
  if (built == null || (typeof built !== "object" && !Array.isArray(built))) {
    throw new Error("Plantilla webhook: el JSON raíz debe ser objeto o array");
  }
  return { payload: built, responsePath };
}

export async function callAgentWebhook(
  project: Project,
  testerMessage: string,
  deadlineAt?: number
): Promise<{ reply: string; responseMs: number }> {
  const sessionId = randomUUID();
  const jsonTemplate = project.webhookRequestJson?.trim();

  let payload: unknown;
  let responsePath: string;

  if (jsonTemplate) {
    const parsed = safeJsonParse<unknown>(jsonTemplate);
    if (!parsed) {
      throw new Error("webhookRequestJson no es JSON valido");
    }
    if (!Array.isArray(parsed) && parsed && typeof parsed === "object" && isVariableLayoutPayload(parsed as Record<string, unknown>)) {
      const layout = parseLayoutFromStoredJson(jsonTemplate);
      if (!layout) {
        throw new Error("webhookRequestJson: __qa_variableLayout invalido");
      }
      const built = buildWebhookBodyFromLayout(layout, testerMessage);
      payload = built.payload;
      responsePath = built.responsePath;
    } else {
      if (!parsed || typeof parsed !== "object") {
        throw new Error("webhookRequestJson: raíz inválida (usa objeto o array)");
      }
      const templateRoot = (Array.isArray(parsed) ? { __qa_arrayRoot: parsed } : parsed) as Record<string, unknown>;
      const applied = applyWebhookTemplate(templateRoot, { testerMessage, sessionId });
      payload =
        applied.payload &&
        typeof applied.payload === "object" &&
        !Array.isArray(applied.payload) &&
        "__qa_arrayRoot" in (applied.payload as Record<string, unknown>)
          ? (applied.payload as Record<string, unknown>).__qa_arrayRoot
          : applied.payload;
      responsePath = applied.responsePath;
    }
  } else {
    payload = {
      [project.webhookMessageField]: testerMessage,
      [project.webhookSessionField]: sessionId,
      [project.webhookMetadataField]: {
        source: "qa-microservice",
        timestamp: new Date().toISOString()
      }
    };
    responsePath = project.responseMessageField;
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= appConfig.webhookMaxRetries; attempt++) {
    try {
      if (deadlineAt != null) {
        const remaining = deadlineAt - Date.now();
        if (remaining <= 0) {
          throw new Error("Prueba detenida por límite de tiempo.");
        }
      }
      const controller = new AbortController();
      const timeoutMs =
        deadlineAt != null
          ? Math.max(100, Math.min(appConfig.requestTimeoutMs, deadlineAt - Date.now()))
          : appConfig.requestTimeoutMs;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const tWebhook = Date.now();
      const response = await fetchAgentWebhook(project, payload, controller.signal).finally(() =>
        clearTimeout(timeout)
      );
      const responseMs = Math.max(0, Date.now() - tWebhook);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Webhook failed (${response.status}): ${text}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        const plainText = (await response.text()).trim();
        if (plainText.length > 0) {
          return { reply: plainText, responseMs };
        }
        throw new Error("Webhook returned empty non-JSON response");
      }

      const body = (await response.json()) as Record<string, unknown>;
      const reply = readPath(body, responsePath);
      if (!reply) {
        throw new Error(`Webhook response missing field (ruta): ${responsePath}`);
      }

      return { reply, responseMs };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown webhook error");
      await Bun.sleep(250 * (attempt + 1));
    }
  }

  throw lastError ?? new Error("Webhook failed after retries");
}

export type ExecuteScenarioOptions = {
  /** Tiempo máximo de reloj (ms) desde el inicio; si se agota, se detiene el bucle. */
  deadlineMs?: number;
  /** Tras cada turno completo (mensaje tester + respuesta + evaluación). Útil para persistir en vivo. */
  onTurnComplete?: (item: TranscriptItem) => Promise<void>;
};

export async function executeScenario(
  project: Project,
  scenario: Scenario,
  maxMessages: number,
  options?: ExecuteScenarioOptions
): Promise<{
  transcript: TranscriptItem[];
  metrics: RunMetrics;
  stoppedByDeadline: boolean;
}> {
  const transcript: TranscriptItem[] = [];
  let hardFail = false;
  const t0 = Date.now();
  const deadlineAt = options?.deadlineMs != null ? t0 + options.deadlineMs : undefined;
  let stoppedByDeadline = false;
  const deadlineReached = () => deadlineAt != null && Date.now() >= deadlineAt;

  for (let i = 0; i < maxMessages; i++) {
    if (deadlineReached()) {
      stoppedByDeadline = true;
      break;
    }
    const testerMessage = await generateTesterMessage(project, scenario, transcript);
    if (deadlineReached()) {
      stoppedByDeadline = true;
      break;
    }
    let agentReply = "";
    let webhookResponseMs: number | null = null;
    let evaluation: ExchangeEvaluation;

    try {
      const webhookResult = await callAgentWebhook(project, testerMessage, deadlineAt);
      agentReply = webhookResult.reply;
      webhookResponseMs = webhookResult.responseMs;
      if (deadlineReached()) {
        stoppedByDeadline = true;
        break;
      }
      evaluation = await evaluateTurn(project, scenario, testerMessage, agentReply);
    } catch (error) {
      if (deadlineReached()) {
        stoppedByDeadline = true;
        break;
      }
      hardFail = true;
      evaluation = {
        score: 0,
        passed: false,
        errors: [error instanceof Error ? error.message : "Unexpected execution error"],
        advice: ["Revisar webhook y disponibilidad del agente"],
        notes: "Fallo tecnico durante ejecucion"
      };
    }

    const item: TranscriptItem = {
      testerMessage,
      agentReply,
      webhookResponseMs,
      evaluation
    };
    transcript.push(item);
    await options?.onTurnComplete?.(item);

    if (hardFail) {
      break;
    }
  }

  const totalScore = transcript.reduce((sum, item) => sum + item.evaluation.score, 0);
  const averageScore = transcript.length > 0 ? totalScore / transcript.length : 0;
  const errorCount = transcript.reduce((sum, item) => sum + item.evaluation.errors.length, 0);
  const adviceCount = transcript.reduce((sum, item) => sum + item.evaluation.advice.length, 0);
  const passed = transcript.length > 0 && transcript.every((item) => item.evaluation.passed);
  const summary = passed
    ? "El escenario supera las pruebas con respuestas consistentes."
    : stoppedByDeadline
      ? "Prueba detenida por límite de tiempo antes de completar todos los turnos previstos."
      : "El escenario presenta fallos o respuestas mejorables.";

  return {
    transcript,
    metrics: {
      averageScore,
      passed,
      errorCount,
      adviceCount,
      summary
    },
    stoppedByDeadline
  };
}
