import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { appConfig } from "./config";
import { healthcheckDb, query } from "./db";
import { createAuthRoutes } from "./auth-routes";
import { createPanelClientsRoutes } from "./panel-api-clients";
import { createAgentsRoutes } from "./panel-api-agents";
import { executeAndPersistTestRun, RunFailedError } from "./run-service";
import type { Project, Scenario } from "./types";
import { serializeContextBundle, type QaContextItem } from "./qa-context-bundle";
import { serializeLayout, validateLayoutInput } from "./webhook-variable-layout";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: appConfig.allowedOrigins.includes("*") ? "*" : appConfig.allowedOrigins
  })
);

app.use("*", async (c, next) => {
  if (!appConfig.internalApiKey) {
    return next();
  }
  const path = c.req.path;
  if (path === "/health" || path === "/" || path.startsWith("/api/")) {
    return next();
  }
  const key = c.req.header("x-api-key");
  if (key !== appConfig.internalApiKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

app.onError((error, c) => {
  if (error instanceof z.ZodError) {
    return c.json({ error: "Validation error", details: error.issues }, 400);
  }
  console.error("[api]", c.req.method, c.req.path, error);
  return c.json(
    {
      error: "Internal server error",
      message: error.message,
      detail: error.message
    },
    500
  );
});

const qaAttachmentItemSchema = z.object({
  description: z.string().max(8000),
  fileName: z.string().max(260).optional(),
  mimeType: z.string().max(200).optional(),
  dataBase64: z.string().max(7_000_000).optional()
});

function mergeContextPreferredItems(items: QaContextItem[] | undefined, legacy: string | undefined): string {
  if (items !== undefined) {
    const cleaned = items.filter(
      (it) =>
        (it.description ?? "").trim().length > 0 ||
        Boolean(it.dataBase64) ||
        Boolean((it.fileName ?? "").trim())
    );
    if (!cleaned.length) return "";
    return serializeContextBundle(cleaned);
  }
  return (legacy ?? "").trim();
}

const webhookHttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const webhookVariableLayoutSchema = z.object({
  responsePath: z.string().min(1).max(400),
  fields: z
    .array(
      z.object({
        kind: z.enum([
          "tester_message",
          "session_id",
          "datetime",
          "qa_id",
          "phone",
          "document",
          "link",
          "image"
        ]),
        key: z.string().min(1).max(300)
      })
    )
    .min(1)
});

const createProjectSchema = z
  .object({
    clientId: z.string().uuid().optional().nullable(),
    name: z.string().min(2),
    webhookUrl: z.string().url(),
    webhookMethod: webhookHttpMethodSchema.optional(),
    webhookAuthToken: z.string().optional().nullable(),
    /** Modo legacy: plantilla JSON con placeholders (ver README). */
    webhookRequestJson: z.string().optional(),
    /** Modo panel: variables fijas con nombres de campo en el JSON del POST. */
    webhookVariableLayout: webhookVariableLayoutSchema.optional(),
    documentation: z.string().optional(),
    clientContext: z.string().optional(),
    /** Lista opcional: descripción + archivo en base64 (sustituye a `documentation` / `clientContext` si se envía). */
    documentationItems: z.array(qaAttachmentItemSchema).max(30).optional(),
    testInstructions: z.string().optional(),
    testInstructionItems: z.array(qaAttachmentItemSchema).max(30).optional()
  })
  .superRefine((val, ctx) => {
    const hasLayout = val.webhookVariableLayout != null;
    const jsonRaw = val.webhookRequestJson?.trim() ?? "";

    if (!hasLayout && jsonRaw.length < 2) {
      ctx.addIssue({
        code: "custom",
        message: "Debe enviarse webhookVariableLayout o webhookRequestJson",
        path: ["webhookVariableLayout"]
      });
    }

    if (hasLayout && jsonRaw.length >= 2) {
      ctx.addIssue({
        code: "custom",
        message: "No combines webhookVariableLayout con webhookRequestJson",
        path: ["webhookVariableLayout"]
      });
    }

    if (hasLayout) {
      const err = validateLayoutInput(val.webhookVariableLayout!);
      if (err) {
        ctx.addIssue({ code: "custom", message: err, path: ["webhookVariableLayout"] });
      }
    }

    if (!hasLayout && jsonRaw.length >= 2) {
      try {
        const parsed: unknown = JSON.parse(jsonRaw);
        if (parsed == null || (typeof parsed !== "object" && !Array.isArray(parsed))) {
          ctx.addIssue({
            code: "custom",
            message: "webhookRequestJson debe ser JSON válido (objeto o array)",
            path: ["webhookRequestJson"]
          });
        }
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "webhookRequestJson no es JSON valido",
          path: ["webhookRequestJson"]
        });
      }
    }
  });

const createScenarioSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(3),
  goal: z.string().min(10),
  successCriteria: z.string().min(10),
  maxMessagesDefault: z.number().int().min(1).max(50).default(8)
});

const createRunSchema = z.object({
  projectId: z.string().uuid(),
  scenarioId: z.string().uuid(),
  maxMessages: z.number().int().min(1).max(100).optional(),
  evaluationBrief: z.string().max(8000).optional().nullable()
});

app.get("/", (c) =>
  c.json({
    service: "qa-agent-microservice",
    hint: "Puerto = PORT en .env (usa 8000 si el panel llama a localhost:8000). Si ves 404 en :3000, es otro servicio (p. ej. Next.js).",
    endpoints: {
      health: "GET /health",
      auth: "POST /api/auth/register, POST /api/auth/login, GET /api/auth/me",
      clients: "GET/POST /api/clients, GET /api/clients/:id (Bearer)",
      agents:
        "GET /api/agents/summary, GET /api/agents/recent-runs, POST /api/agents/run-quick-test, GET /api/agents/:agentId/runs/:runId/detail, GET /api/agents/:agentId/project, GET /api/agents/:agentId/qa-knowledge-preview, GET /api/agents/:agentId/runs (Bearer)",
      projects: "POST /projects, GET /projects",
      scenarios: "POST /scenarios, GET /projects/:projectId/scenarios",
      runs: "POST /runs, GET /runs, GET /runs/:id"
    }
  })
);

app.get("/health", async (c) => {
  const dbOk = await healthcheckDb().catch(() => false);
  return c.json({ ok: dbOk, service: "qa-agent-microservice", db: dbOk ? "up" : "down" }, dbOk ? 200 : 503);
});

app.route("/api/auth", createAuthRoutes());
app.route("/api/clients", createPanelClientsRoutes());
app.route("/api/agents", createAgentsRoutes());

// Compat: si la base se creó sin `projects.client_id`, la añadimos sin romper despliegues viejos.
try {
  await query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL
  `);
} catch (error) {
  console.warn("[db] no se pudo verificar projects.client_id:", error);
}

try {
  await query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS webhook_request_json TEXT
  `);
} catch (error) {
  console.warn("[db] no se pudo verificar projects.webhook_request_json:", error);
}

try {
  await query(`CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id)`);
} catch (error) {
  console.warn("[db] idx_projects_client_id:", error);
}

try {
  await query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS webhook_method TEXT NOT NULL DEFAULT 'POST'
  `);
} catch (error) {
  console.warn("[db] projects.webhook_method:", error);
}

try {
  await query(`ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS evaluation_brief TEXT`);
  await query(`ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS qa_insight TEXT`);
  await query(`ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS kpi_snapshot JSONB`);
  await query(`ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER`);
} catch (error) {
  console.warn("[db] test_runs insight columns:", error);
}

try {
  await query(`ALTER TABLE run_messages ADD COLUMN IF NOT EXISTS response_ms INTEGER`);
} catch (error) {
  console.warn("[db] run_messages.response_ms:", error);
}

app.post("/projects", async (c) => {
  const input = createProjectSchema.parse(await c.req.json());
  const documentation = mergeContextPreferredItems(
    input.documentationItems,
    input.documentation ?? input.clientContext
  );
  const testInstructionsStored = mergeContextPreferredItems(input.testInstructionItems, input.testInstructions);
  const storedWebhookJson = input.webhookVariableLayout
    ? serializeLayout(input.webhookVariableLayout)
    : (input.webhookRequestJson ?? "").trim();
  const webhookMethod = input.webhookMethod ?? "POST";
  const rows = await query<Project>(
    `INSERT INTO projects
      (client_id, name, webhook_url, webhook_method, webhook_auth_token, webhook_message_field, webhook_session_field, webhook_metadata_field, response_message_field, webhook_request_json, client_context, test_instructions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING
      id,
      client_id AS "clientId",
      name,
      webhook_url AS "webhookUrl",
      webhook_method AS "webhookMethod",
      webhook_auth_token AS "webhookAuthToken",
      webhook_message_field AS "webhookMessageField",
      webhook_session_field AS "webhookSessionField",
      webhook_metadata_field AS "webhookMetadataField",
      response_message_field AS "responseMessageField",
      webhook_request_json AS "webhookRequestJson",
      client_context AS "clientContext",
      test_instructions AS "testInstructions",
      created_at AS "createdAt",
      updated_at AS "updatedAt"`,
    [
      input.clientId ?? null,
      input.name,
      input.webhookUrl,
      webhookMethod,
      input.webhookAuthToken ?? null,
      "message",
      "sessionId",
      "metadata",
      "reply",
      storedWebhookJson,
      documentation,
      testInstructionsStored
    ]
  );

  return c.json(rows[0], 201);
});

app.post("/scenarios", async (c) => {
  const input = createScenarioSchema.parse(await c.req.json());
  const rows = await query<Scenario>(
    `INSERT INTO scenarios
      (project_id, name, goal, success_criteria, max_messages_default)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING
      id,
      project_id AS "projectId",
      name,
      goal,
      success_criteria AS "successCriteria",
      max_messages_default AS "maxMessagesDefault",
      created_at AS "createdAt"`,
    [input.projectId, input.name, input.goal, input.successCriteria, input.maxMessagesDefault]
  );

  return c.json(rows[0], 201);
});

app.get("/projects", async (c) => {
  const rows = await query<Project>(
    `SELECT
      id,
      client_id AS "clientId",
      name,
      webhook_url AS "webhookUrl",
      COALESCE(webhook_method, 'POST') AS "webhookMethod",
      webhook_auth_token AS "webhookAuthToken",
      webhook_message_field AS "webhookMessageField",
      webhook_session_field AS "webhookSessionField",
      webhook_metadata_field AS "webhookMetadataField",
      response_message_field AS "responseMessageField",
      webhook_request_json AS "webhookRequestJson",
      client_context AS "clientContext",
      test_instructions AS "testInstructions",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM projects
    ORDER BY created_at DESC`
  );
  return c.json(rows);
});

app.get("/projects/:projectId/scenarios", async (c) => {
  const projectId = c.req.param("projectId");
  const rows = await query<Scenario>(
    `SELECT
      id,
      project_id AS "projectId",
      name,
      goal,
      success_criteria AS "successCriteria",
      max_messages_default AS "maxMessagesDefault",
      created_at AS "createdAt"
     FROM scenarios
     WHERE project_id = $1
     ORDER BY created_at DESC`,
    [projectId]
  );
  return c.json(rows);
});

app.post("/runs", async (c) => {
  const input = createRunSchema.parse(await c.req.json());

  const projectRows = await query<Project>(
    `SELECT
      id,
      client_id AS "clientId",
      name,
      webhook_url AS "webhookUrl",
      COALESCE(webhook_method, 'POST') AS "webhookMethod",
      webhook_auth_token AS "webhookAuthToken",
      webhook_message_field AS "webhookMessageField",
      webhook_session_field AS "webhookSessionField",
      webhook_metadata_field AS "webhookMetadataField",
      response_message_field AS "responseMessageField",
      webhook_request_json AS "webhookRequestJson",
      client_context AS "clientContext",
      test_instructions AS "testInstructions",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM projects
     WHERE id = $1`,
    [input.projectId]
  );

  if (!projectRows[0]) {
    return c.json({ error: "Project not found" }, 404);
  }

  const scenarioRows = await query<Scenario>(
    `SELECT
      id,
      project_id AS "projectId",
      name,
      goal,
      success_criteria AS "successCriteria",
      max_messages_default AS "maxMessagesDefault",
      created_at AS "createdAt"
     FROM scenarios
     WHERE id = $1 AND project_id = $2`,
    [input.scenarioId, input.projectId]
  );

  if (!scenarioRows[0]) {
    return c.json({ error: "Scenario not found for this project" }, 404);
  }

  const project = projectRows[0];
  const scenario = scenarioRows[0];
  const maxMessages = input.maxMessages ?? scenario.maxMessagesDefault;

  try {
    const result = await executeAndPersistTestRun(project, scenario, {
      maxMessages,
      evaluationBrief: input.evaluationBrief ?? null
    });

    return c.json({
      runId: result.runId,
      status: "completed",
      metrics: result.metrics,
      exchanges: result.exchanges,
      stoppedByDeadline: result.stoppedByDeadline,
      durationMs: result.durationMs,
      qaInsight: result.qaInsight,
      kpiSnapshot: result.kpiSnapshot
    });
  } catch (error) {
    if (error instanceof RunFailedError) {
      return c.json({ error: "Run failed", runId: error.runId, detail: error.message }, 500);
    }
    return c.json(
      {
        error: "Run failed",
        detail: error instanceof Error ? error.message : "Unexpected error"
      },
      500
    );
  }
});

app.get("/runs/:id", async (c) => {
  const runId = c.req.param("id");
  const runRows = await query(
    `SELECT
      id,
      project_id AS "projectId",
      scenario_id AS "scenarioId",
      status,
      max_messages AS "maxMessages",
      started_at AS "startedAt",
      finished_at AS "finishedAt",
      average_score AS "averageScore",
      passed,
      error_count AS "errorCount",
      advice_count AS "adviceCount",
      summary,
      failure_reason AS "failureReason",
      evaluation_brief AS "evaluationBrief",
      qa_insight AS "qaInsight",
      kpi_snapshot AS "kpiSnapshot",
      duration_ms AS "durationMs",
      created_at AS "createdAt"
     FROM test_runs
     WHERE id = $1`,
    [runId]
  );

  if (!runRows[0]) {
    return c.json({ error: "Run not found" }, 404);
  }

  const messages = await query(
    `SELECT
      id,
      tester_message AS "testerMessage",
      agent_reply AS "agentReply",
      score,
      passed,
      errors,
      advice,
      notes,
      created_at AS "createdAt"
     FROM run_messages
     WHERE run_id = $1
     ORDER BY created_at ASC`,
    [runId]
  );

  return c.json({
    run: runRows[0],
    messages
  });
});

app.get("/runs", async (c) => {
  const projectId = c.req.query("projectId");
  const rows = projectId
    ? await query(
        `SELECT
          id,
          project_id AS "projectId",
          scenario_id AS "scenarioId",
          status,
          max_messages AS "maxMessages",
          started_at AS "startedAt",
          finished_at AS "finishedAt",
          average_score AS "averageScore",
          passed,
          error_count AS "errorCount",
          advice_count AS "adviceCount",
          summary,
          failure_reason AS "failureReason",
          evaluation_brief AS "evaluationBrief",
          qa_insight AS "qaInsight",
          kpi_snapshot AS "kpiSnapshot",
          duration_ms AS "durationMs",
          created_at AS "createdAt"
        FROM test_runs
        WHERE project_id = $1
        ORDER BY created_at DESC`,
        [projectId]
      )
    : await query(
        `SELECT
          id,
          project_id AS "projectId",
          scenario_id AS "scenarioId",
          status,
          max_messages AS "maxMessages",
          started_at AS "startedAt",
          finished_at AS "finishedAt",
          average_score AS "averageScore",
          passed,
          error_count AS "errorCount",
          advice_count AS "adviceCount",
          summary,
          failure_reason AS "failureReason",
          evaluation_brief AS "evaluationBrief",
          qa_insight AS "qaInsight",
          kpi_snapshot AS "kpiSnapshot",
          duration_ms AS "durationMs",
          created_at AS "createdAt"
        FROM test_runs
        ORDER BY created_at DESC`
      );
  return c.json(rows);
});

// Tras login el front a veces abre rutas en el mismo host que el API (:8000). Aquí no hay SPA: redirigimos al panel.
app.notFound((c) => {
  const path = c.req.path;
  if (c.req.method === "GET" && appConfig.frontendUrl && !path.startsWith("/api/")) {
    const u = new URL(c.req.url);
    const target = `${appConfig.frontendUrl}${u.pathname}${u.search}`;
    return c.redirect(target, 302);
  }
  return c.json(
    {
      error: "Not Found",
      path,
      hint:
        "Ruta desconocida en el API. Si buscabas el panel web, usa FRONTEND_URL (p. ej. http://localhost:3000) o abre el front en ese puerto."
    },
    404
  );
});

Bun.serve({
  port: appConfig.port,
  fetch: app.fetch
});

console.log(`QA microservice listening on http://localhost:${appConfig.port}`);
