import { Hono } from "hono";
import { z } from "zod";
import { getBearerUserId } from "./auth-routes";
import { query } from "./db";
import { contextToPromptText, inventoryContext } from "./qa-context-bundle";
import { insertRunningTestRun, scheduleQuickTestExecution } from "./run-service";
import { inferResponsePathFromExampleJson, parseLayoutFromStoredJson, serializeLayout } from "./webhook-variable-layout";
import type { Project, Scenario } from "./types";

function toUuidStringList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x));
  }
  return [];
}

export interface AgentSummaryRow {
  agentId: string;
  agentName: string;
  agentCreatedAt: string;
  primaryProjectId: string | null;
  projectIds: string[];
  totalTestMessages: number;
  avgScore: number | null;
  totalRuns: number;
  completedRuns: number;
}

export function createAgentsRoutes(): Hono {
  const r = new Hono();

  const percentile = (values: number[], p: number): number | null => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
    return sorted[idx] ?? null;
  };

  const parseFiniteNumber = (raw: string | null | undefined): number | null => {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  /** Listado para el panel: agente + métricas agregadas de pruebas. */
  r.get("/summary", async (c) => {
    const userId = await getBearerUserId(c);
    if (!userId) {
      return c.json({ detail: "No autenticado" }, 401);
    }

    const rows = await query<{
      agent_id: string;
      agent_name: string;
      agent_created_at: string;
      primary_project_id: string | null;
      project_ids: string[] | null;
      total_test_messages: string | null;
      avg_score: string | null;
      total_runs: string | null;
      completed_runs: string | null;
    }>(
      `SELECT
        c.id AS agent_id,
        c.name AS agent_name,
        c.created_at AS agent_created_at,
        (
          SELECT p.id FROM projects p WHERE p.client_id = c.id ORDER BY p.created_at DESC NULLS LAST LIMIT 1
        ) AS primary_project_id,
        COALESCE(
          (SELECT array_agg(p.id ORDER BY p.created_at DESC) FROM projects p WHERE p.client_id = c.id),
          ARRAY[]::uuid[]
        ) AS project_ids,
        (
          SELECT COUNT(rm.id)::text
          FROM projects p
          JOIN test_runs tr ON tr.project_id = p.id
          JOIN run_messages rm ON rm.run_id = tr.id
          WHERE p.client_id = c.id
        ) AS total_test_messages,
        (
          SELECT AVG(tr.average_score)::text
          FROM projects p
          JOIN test_runs tr ON tr.project_id = p.id
          WHERE p.client_id = c.id AND tr.status = 'completed' AND tr.average_score IS NOT NULL
        ) AS avg_score,
        (
          SELECT COUNT(tr.id)::text
          FROM projects p
          JOIN test_runs tr ON tr.project_id = p.id
          WHERE p.client_id = c.id
        ) AS total_runs,
        (
          SELECT COUNT(tr.id)::text
          FROM projects p
          JOIN test_runs tr ON tr.project_id = p.id
          WHERE p.client_id = c.id AND tr.status = 'completed'
        ) AS completed_runs
      FROM clients c
      WHERE c.owner_id = $1
      ORDER BY c.created_at DESC`,
      [userId]
    );

    const out: AgentSummaryRow[] = rows.map((row) => ({
      agentId: row.agent_id,
      agentName: row.agent_name,
      agentCreatedAt: row.agent_created_at,
      primaryProjectId: row.primary_project_id,
      projectIds: toUuidStringList(row.project_ids),
      totalTestMessages: Number(row.total_test_messages ?? 0),
      avgScore: row.avg_score != null ? Number(row.avg_score) : null,
      totalRuns: Number(row.total_runs ?? 0),
      completedRuns: Number(row.completed_runs ?? 0)
    }));

    return c.json(out);
  });

  /** Últimas pruebas de todos los agentes del usuario (panel). */
  r.get("/recent-runs", async (c) => {
    const userId = await getBearerUserId(c);
    if (!userId) {
      return c.json({ detail: "No autenticado" }, 401);
    }
    const rows = await query<{
      run_id: string;
      status: string;
      average_score: string | null;
      passed: boolean | null;
      created_at: string;
      evaluation_brief: string | null;
      duration_ms: string | null;
      agent_id: string;
      agent_name: string;
      project_name: string;
      scenario_name: string;
    }>(
      `SELECT
        tr.id AS run_id,
        tr.status,
        tr.average_score::text,
        tr.passed,
        tr.created_at,
        tr.evaluation_brief,
        tr.duration_ms::text,
        c.id AS agent_id,
        c.name AS agent_name,
        p.name AS project_name,
        s.name AS scenario_name
      FROM test_runs tr
      INNER JOIN scenarios s ON s.id = tr.scenario_id
      INNER JOIN projects p ON p.id = tr.project_id
      INNER JOIN clients c ON c.id = p.client_id AND c.owner_id = $1
      ORDER BY
        CASE WHEN tr.status = 'running' THEN 0 ELSE 1 END,
        tr.created_at DESC
      LIMIT 80`,
      [userId]
    );
    return c.json(
      rows.map((r) => ({
        runId: r.run_id,
        status: r.status,
        averageScore: r.average_score != null ? Number(r.average_score) : null,
        passed: r.passed,
        createdAt: r.created_at,
        evaluationBrief: r.evaluation_brief,
        durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
        agentId: r.agent_id,
        agentName: r.agent_name,
        projectName: r.project_name,
        scenarioName: r.scenario_name
      }))
    );
  });

  /** Analítica avanzada para dashboard de estadísticas del usuario. */
  r.get("/analytics", async (c) => {
    const userId = await getBearerUserId(c);
    if (!userId) return c.json({ detail: "No autenticado" }, 401);
    const agentFilter = c.req.query("agente") ?? null;

    const rows = await query<{
      run_id: string;
      status: string;
      average_score: string | null;
      passed: boolean | null;
      duration_ms: string | null;
      error_count: number | null;
      advice_count: number | null;
      created_at: string;
      failure_reason: string | null;
      risk_level: string | null;
      agent_id: string;
      agent_name: string;
      avg_response_ms: string | null;
      p95_response_ms: string | null;
    }>(
      `SELECT
        tr.id AS run_id,
        tr.status,
        tr.average_score::text,
        tr.passed,
        tr.duration_ms::text,
        tr.error_count,
        tr.advice_count,
        tr.created_at,
        tr.failure_reason,
        tr.kpi_snapshot->>'riskLevel' AS risk_level,
        c.id AS agent_id,
        c.name AS agent_name,
        rm.avg_response_ms::text AS avg_response_ms,
        rm.p95_response_ms::text AS p95_response_ms
      FROM test_runs tr
      INNER JOIN projects p ON p.id = tr.project_id
      INNER JOIN clients c ON c.id = p.client_id AND c.owner_id = $1
      LEFT JOIN (
        SELECT
          run_id,
          AVG(response_ms)::numeric(12,2) AS avg_response_ms,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY response_ms) AS p95_response_ms
        FROM run_messages
        WHERE response_ms IS NOT NULL
        GROUP BY run_id
      ) rm ON rm.run_id = tr.id
      WHERE ($2::uuid IS NULL OR c.id = $2::uuid)
      ORDER BY tr.created_at DESC
      LIMIT 1200`,
      [userId, agentFilter]
    );

    const runs = rows.map((r) => ({
      runId: r.run_id,
      status: r.status,
      averageScore: parseFiniteNumber(r.average_score),
      passed: r.passed,
      durationMs: parseFiniteNumber(r.duration_ms),
      errorCount: Number(r.error_count ?? 0),
      adviceCount: Number(r.advice_count ?? 0),
      createdAt: r.created_at,
      failureReason: r.failure_reason,
      riskLevel: (r.risk_level ?? "").toLowerCase(),
      agentId: r.agent_id,
      agentName: r.agent_name,
      avgResponseMs: parseFiniteNumber(r.avg_response_ms),
      p95ResponseMs: parseFiniteNumber(r.p95_response_ms)
    }));

    const completed = runs.filter((x) => x.status === "completed");
    const failed = runs.filter((x) => x.status === "failed");
    const running = runs.filter((x) => x.status === "running");
    const avgScoreVals = completed.map((x) => x.averageScore).filter((x): x is number => x != null);
    const durationVals = completed.map((x) => x.durationMs).filter((x): x is number => x != null);
    const avgRespVals = completed.map((x) => x.avgResponseMs).filter((x): x is number => x != null);
    const p95RespVals = completed.map((x) => x.p95ResponseMs).filter((x): x is number => x != null);
    const passCount = completed.filter((x) => x.passed === true).length;

    const byDay = new Map<string, { runs: number; completed: number; failed: number; scoreSum: number; scoreN: number }>();
    const byAgent = new Map<
      string,
      {
        agentId: string;
        agentName: string;
        runs: number;
        completed: number;
        passed: number;
        scoreSum: number;
        scoreN: number;
        responseSum: number;
        responseN: number;
      }
    >();
    const failReasons = new Map<string, number>();
    const scoreBuckets = [
      { label: "0-49", min: 0, max: 49, count: 0 },
      { label: "50-69", min: 50, max: 69, count: 0 },
      { label: "70-84", min: 70, max: 84, count: 0 },
      { label: "85-100", min: 85, max: 100, count: 0 }
    ];
    const riskCounts = { bajo: 0, medio: 0, alto: 0, unknown: 0 };

    for (const run of runs) {
      const day = run.createdAt.slice(0, 10);
      const dayRow = byDay.get(day) ?? { runs: 0, completed: 0, failed: 0, scoreSum: 0, scoreN: 0 };
      dayRow.runs += 1;
      if (run.status === "completed") dayRow.completed += 1;
      if (run.status === "failed") dayRow.failed += 1;
      if (run.averageScore != null) {
        dayRow.scoreSum += run.averageScore;
        dayRow.scoreN += 1;
      }
      byDay.set(day, dayRow);

      const a = byAgent.get(run.agentId) ?? {
        agentId: run.agentId,
        agentName: run.agentName,
        runs: 0,
        completed: 0,
        passed: 0,
        scoreSum: 0,
        scoreN: 0,
        responseSum: 0,
        responseN: 0
      };
      a.runs += 1;
      if (run.status === "completed") a.completed += 1;
      if (run.passed === true) a.passed += 1;
      if (run.averageScore != null) {
        a.scoreSum += run.averageScore;
        a.scoreN += 1;
      }
      if (run.avgResponseMs != null) {
        a.responseSum += run.avgResponseMs;
        a.responseN += 1;
      }
      byAgent.set(run.agentId, a);

      if (run.status === "failed" && run.failureReason?.trim()) {
        const key = run.failureReason.trim().slice(0, 140);
        failReasons.set(key, (failReasons.get(key) ?? 0) + 1);
      }

      if (run.averageScore != null) {
        const bucket = scoreBuckets.find((b) => run.averageScore >= b.min && run.averageScore <= b.max);
        if (bucket) bucket.count += 1;
      }

      if (run.riskLevel === "bajo") riskCounts.bajo += 1;
      else if (run.riskLevel === "medio") riskCounts.medio += 1;
      else if (run.riskLevel === "alto") riskCounts.alto += 1;
      else riskCounts.unknown += 1;
    }

    const timeline = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-21)
      .map(([date, v]) => ({
        date,
        runs: v.runs,
        completed: v.completed,
        failed: v.failed,
        avgScore: v.scoreN > 0 ? Number((v.scoreSum / v.scoreN).toFixed(2)) : null
      }));

    const agents = [...byAgent.values()]
      .map((a) => ({
        agentId: a.agentId,
        agentName: a.agentName,
        runs: a.runs,
        completed: a.completed,
        passRatePct: a.completed > 0 ? Math.round((100 * a.passed) / a.completed) : 0,
        avgScore: a.scoreN > 0 ? Number((a.scoreSum / a.scoreN).toFixed(2)) : null,
        avgResponseMs: a.responseN > 0 ? Math.round(a.responseSum / a.responseN) : null
      }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 12);

    const topFailures = [...failReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const windowStats = (fromMs: number, toMs: number) => {
      const w = runs.filter((r) => {
        const t = Date.parse(r.createdAt);
        return Number.isFinite(t) && t >= fromMs && t < toMs;
      });
      const wc = w.filter((x) => x.status === "completed");
      const pass = wc.filter((x) => x.passed === true).length;
      const scores = wc.map((x) => x.averageScore).filter((x): x is number => x != null);
      return {
        runs: w.length,
        passRatePct: wc.length > 0 ? Math.round((100 * pass) / wc.length) : 0,
        avgScore: scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null
      };
    };
    const last7 = windowStats(now - 7 * DAY, now);
    const prev7 = windowStats(now - 14 * DAY, now - 7 * DAY);
    const trend = {
      runsDelta: last7.runs - prev7.runs,
      passRateDeltaPct: last7.passRatePct - prev7.passRatePct,
      avgScoreDelta: Number(((last7.avgScore ?? 0) - (prev7.avgScore ?? 0)).toFixed(2))
    };

    const responseSla = {
      under1s: avgRespVals.filter((x) => x < 1000).length,
      between1sAnd2s: avgRespVals.filter((x) => x >= 1000 && x < 2000).length,
      over2s: avgRespVals.filter((x) => x >= 2000).length
    };
    const successStreak = (() => {
      let streak = 0;
      for (const r of runs) {
        if (r.status === "completed" && r.passed === true) streak += 1;
        else break;
      }
      return streak;
    })();

    return c.json({
      overview: {
        totalRuns: runs.length,
        completedRuns: completed.length,
        failedRuns: failed.length,
        runningRuns: running.length,
        avgScore: avgScoreVals.length ? Number((avgScoreVals.reduce((a, b) => a + b, 0) / avgScoreVals.length).toFixed(2)) : null,
        passRatePct: completed.length > 0 ? Math.round((100 * passCount) / completed.length) : 0,
        avgDurationMs: durationVals.length ? Math.round(durationVals.reduce((a, b) => a + b, 0) / durationVals.length) : null,
        p95DurationMs: percentile(durationVals, 0.95),
        avgResponseMs: avgRespVals.length ? Math.round(avgRespVals.reduce((a, b) => a + b, 0) / avgRespVals.length) : null,
        p95ResponseMs: percentile(p95RespVals, 0.95),
        totalErrors: runs.reduce((acc, r) => acc + r.errorCount, 0),
        totalAdvice: runs.reduce((acc, r) => acc + r.adviceCount, 0),
        reliabilityObservedPct: completed.length > 0 ? Math.round((100 * passCount) / completed.length) : 0
      },
      benchmark: {
        last7,
        prev7,
        trend,
        responseSla,
        successStreak
      },
      scoreDistribution: scoreBuckets,
      riskDistribution: riskCounts,
      timeline,
      agents,
      topFailures
    });
  });

  const quickTestBodySchema = z.object({
    agentId: z.string().uuid(),
    evaluationBrief: z.string().min(20).max(8000),
    maxMessages: z.number().int().min(1).max(25).default(8),
    maxDurationSec: z.number().int().min(0).max(900).optional()
  });

  const updateResponsePathSchema = z
    .object({
      responsePath: z
        .string()
        .trim()
        .min(1)
        .regex(/^(?:[a-zA-Z_][a-zA-Z0-9_]*|\d+)(?:\.(?:[a-zA-Z_][a-zA-Z0-9_]*|\d+))*$/)
        .optional(),
      responseExampleJson: z.string().min(2).optional()
    })
    .refine((v) => Boolean(v.responsePath?.trim() || v.responseExampleJson?.trim()), {
      message: "Envía responsePath o responseExampleJson"
    });

  /**
   * Crea un escenario temporal desde el brief del evaluador y arranca la prueba en segundo plano.
   * Responde al momento con `runId` y `status: running`; los mensajes se van guardando turno a turno (polling al detalle).
   */
  r.post("/run-quick-test", async (c) => {
    const userId = await getBearerUserId(c);
    if (!userId) {
      return c.json({ detail: "No autenticado" }, 401);
    }
    const body = quickTestBodySchema.parse(await c.req.json());
    const deadlineMs =
      body.maxDurationSec != null && body.maxDurationSec > 0 ? body.maxDurationSec * 1000 : undefined;

    const projectRows = await query<Project>(
      `SELECT
        p.id,
        p.client_id AS "clientId",
        p.name,
        p.webhook_url AS "webhookUrl",
        COALESCE(p.webhook_method, 'POST') AS "webhookMethod",
        p.webhook_auth_token AS "webhookAuthToken",
        p.webhook_message_field AS "webhookMessageField",
        p.webhook_session_field AS "webhookSessionField",
        p.webhook_metadata_field AS "webhookMetadataField",
        p.response_message_field AS "responseMessageField",
        p.webhook_request_json AS "webhookRequestJson",
        p.client_context AS "clientContext",
        p.test_instructions AS "testInstructions",
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt"
      FROM projects p
      INNER JOIN clients c ON c.id = p.client_id AND c.owner_id = $1
      WHERE p.client_id = $2
      ORDER BY p.created_at DESC
      LIMIT 1`,
      [userId, body.agentId]
    );
    const project = projectRows[0];
    if (!project) {
      return c.json({ detail: "No hay proyecto QA para este agente" }, 404);
    }

    const scenarioName = `Panel · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const successCriteria = `Intención del evaluador (brief):\n${body.evaluationBrief}\n\nEl agente debe responder de forma coherente, útil y alineada con el conocimiento configurado; evitar alucinaciones y fugas de datos.`;

    const scenarioRows = await query<Scenario>(
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
      [project.id, scenarioName, body.evaluationBrief, successCriteria, body.maxMessages]
    );
    const scenario = scenarioRows[0];
    if (!scenario) {
      return c.json({ detail: "No se pudo crear el escenario" }, 500);
    }

    try {
      const runId = await insertRunningTestRun(
        project.id,
        scenario.id,
        body.maxMessages,
        body.evaluationBrief
      );
      scheduleQuickTestExecution(runId, project, scenario, {
        maxMessages: body.maxMessages,
        deadlineMs,
        evaluationBrief: body.evaluationBrief
      });
      return c.json({
        ok: true,
        status: "running" as const,
        agentId: body.agentId,
        projectId: project.id,
        scenarioId: scenario.id,
        runId
      });
    } catch (error) {
      return c.json({ ok: false, detail: error instanceof Error ? error.message : "Error" }, 500);
    }
  });

  /** Detalle de un run con mensajes (propiedad verificada por agente + proyecto). */
  r.get("/:agentId/runs/:runId/detail", async (c) => {
    const userId = await getBearerUserId(c);
    if (!userId) {
      return c.json({ detail: "No autenticado" }, 401);
    }
    const agentId = c.req.param("agentId");
    const runId = c.req.param("runId");
    const runRows = await query<{
      id: string;
      projectId: string;
      scenarioId: string;
      status: string;
      maxMessages: number;
      startedAt: string | null;
      finishedAt: string | null;
      averageScore: string | null;
      passed: boolean | null;
      errorCount: number | null;
      adviceCount: number | null;
      summary: string | null;
      failureReason: string | null;
      evaluationBrief: string | null;
      qaInsight: string | null;
      kpiSnapshot: unknown | null;
      durationMs: string | null;
      createdAt: string;
    }>(
      `SELECT
        tr.id,
        tr.project_id AS "projectId",
        tr.scenario_id AS "scenarioId",
        tr.status,
        tr.max_messages AS "maxMessages",
        tr.started_at AS "startedAt",
        tr.finished_at AS "finishedAt",
        tr.average_score::text AS "averageScore",
        tr.passed,
        tr.error_count AS "errorCount",
        tr.advice_count AS "adviceCount",
        tr.summary,
        tr.failure_reason AS "failureReason",
        tr.evaluation_brief AS "evaluationBrief",
        tr.qa_insight AS "qaInsight",
        tr.kpi_snapshot AS "kpiSnapshot",
        tr.duration_ms::text AS "durationMs",
        tr.created_at AS "createdAt"
      FROM test_runs tr
      INNER JOIN projects p ON p.id = tr.project_id
      INNER JOIN clients c ON c.id = p.client_id AND c.owner_id = $1
      WHERE tr.id = $2 AND p.client_id = $3`,
      [userId, runId, agentId]
    );
    if (!runRows[0]) {
      return c.json({ detail: "Run no encontrado" }, 404);
    }
    const run = runRows[0];
    const runNormalized = {
      ...run,
      averageScore: run.averageScore != null ? Number(run.averageScore) : null,
      durationMs: run.durationMs != null ? Number(run.durationMs) : null
    };
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
    return c.json({ run: runNormalized, messages });
  });

  /** Actualiza la ruta del campo de respuesta del webhook para el proyecto QA principal del agente. */
  r.patch("/:agentId/project-response-path", async (c) => {
    const userId = await getBearerUserId(c);
    if (!userId) {
      return c.json({ detail: "No autenticado" }, 401);
    }
    const agentId = c.req.param("agentId");
    const body = updateResponsePathSchema.parse(await c.req.json());
    const resolvedPath =
      body.responsePath?.trim() ||
      (() => {
        const raw = body.responseExampleJson?.trim() ?? "";
        return inferResponsePathFromExampleJson(raw);
      })();

    const rows = await query<{
      id: string;
      webhook_request_json: string | null;
      response_message_field: string | null;
    }>(
      `SELECT p.id, p.webhook_request_json, p.response_message_field
       FROM projects p
       INNER JOIN clients c ON c.id = p.client_id AND c.owner_id = $1
       WHERE p.client_id = $2
       ORDER BY p.created_at DESC
       LIMIT 1`,
      [userId, agentId]
    );
    const project = rows[0];
    if (!project) {
      return c.json({ detail: "No hay configuración para este agente" }, 404);
    }

    const layout = parseLayoutFromStoredJson(project.webhook_request_json);
    if (layout) {
      const updatedJson = serializeLayout({
        responsePath: resolvedPath,
        fields: layout.fields
      });
      await query(
        `UPDATE projects
         SET webhook_request_json = $2, updated_at = NOW()
         WHERE id = $1`,
        [project.id, updatedJson]
      );
    } else {
      await query(
        `UPDATE projects
         SET response_message_field = $2, updated_at = NOW()
         WHERE id = $1`,
        [project.id, resolvedPath]
      );
    }

    return c.json({ ok: true, responsePath: resolvedPath });
  });

  /** Proyecto QA principal del agente (el más reciente). */
  r.get("/:agentId/project", async (c) => {
    const userId = await getBearerUserId(c);
    if (!userId) {
      return c.json({ detail: "No autenticado" }, 401);
    }
    const agentId = c.req.param("agentId");
    const rows = await query(
      `SELECT
        p.id,
        p.client_id AS "clientId",
        p.name,
        p.webhook_url AS "webhookUrl",
        COALESCE(p.webhook_method, 'POST') AS "webhookMethod",
        p.webhook_auth_token AS "webhookAuthToken",
        p.webhook_message_field AS "webhookMessageField",
        p.webhook_session_field AS "webhookSessionField",
        p.webhook_metadata_field AS "webhookMetadataField",
        p.response_message_field AS "responseMessageField",
        p.webhook_request_json AS "webhookRequestJson",
        p.client_context AS "clientContext",
        p.test_instructions AS "testInstructions",
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt"
      FROM projects p
      INNER JOIN clients c ON c.id = p.client_id AND c.owner_id = $1
      WHERE p.client_id = $2
      ORDER BY p.created_at DESC
      LIMIT 1`,
      [userId, agentId]
    );
    if (!rows[0]) {
      return c.json({ detail: "No hay configuración para este agente" }, 404);
    }
    return c.json(rows[0]);
  });

  /**
   * Vista QA del “conocimiento” que usa el microservicio en prompts (alineado con RAG del cliente:
   * documentación + instrucciones tal como las ve el modelo al simular y evaluar).
   */
  r.get("/:agentId/qa-knowledge-preview", async (c) => {
    const userId = await getBearerUserId(c);
    if (!userId) {
      return c.json({ detail: "No autenticado" }, 401);
    }
    const agentId = c.req.param("agentId");
    const rows = await query<{
      id: string;
      client_context: string;
      test_instructions: string;
    }>(
      `SELECT p.id, p.client_context, p.test_instructions
       FROM projects p
       INNER JOIN clients c ON c.id = p.client_id AND c.owner_id = $1
       WHERE p.client_id = $2
       ORDER BY p.created_at DESC
       LIMIT 1`,
      [userId, agentId]
    );
    if (!rows[0]) {
      return c.json({ detail: "No hay configuración para este agente" }, 404);
    }
    const row = rows[0];
    const docText = contextToPromptText(row.client_context);
    const insText = contextToPromptText(row.test_instructions);
    const maxChars = 120_000;
    const cap = (s: string) =>
      s.length <= maxChars ? { text: s, truncated: false as const } : { text: `${s.slice(0, maxChars)}\n\n…(truncado)`, truncated: true as const };

    const docCapped = cap(docText);
    const insCapped = cap(insText);

    return c.json({
      projectId: row.id,
      documentation: {
        asPromptText: docCapped.text,
        truncated: docCapped.truncated,
        inventory: inventoryContext(row.client_context)
      },
      instructions: {
        asPromptText: insCapped.text,
        truncated: insCapped.truncated,
        inventory: inventoryContext(row.test_instructions)
      },
      meta: {
        explanation:
          "Este texto es el que el microservicio inyecta hoy en los prompts de OpenRouter al generar mensajes de prueba y al evaluar respuestas. Debe coincidir con lo que en producción alimentaría el RAG del agente del cliente; úsalo para comprobar cobertura y coherencia antes de confiar en los resultados de las pruebas."
      }
    });
  });

  /** Runs del agente (todos los proyectos vinculados) con conteo de mensajes. */
  r.get("/:agentId/runs", async (c) => {
    const userId = await getBearerUserId(c);
    if (!userId) {
      return c.json({ detail: "No autenticado" }, 401);
    }
    const agentId = c.req.param("agentId");
    const list = await query<{
      id: string;
      project_id: string;
      scenario_id: string;
      status: string;
      average_score: string | null;
      passed: boolean | null;
      started_at: string | null;
      finished_at: string | null;
      message_count: string;
    }>(
      `SELECT
        tr.id,
        tr.project_id,
        tr.scenario_id,
        tr.status,
        tr.average_score,
        tr.passed,
        tr.started_at,
        tr.finished_at,
        (SELECT COUNT(*)::text FROM run_messages rm WHERE rm.run_id = tr.id) AS message_count
      FROM test_runs tr
      INNER JOIN projects p ON p.id = tr.project_id
      INNER JOIN clients c ON c.id = p.client_id AND c.owner_id = $1
      WHERE p.client_id = $2
      ORDER BY tr.created_at DESC
      LIMIT 200`,
      [userId, agentId]
    );

    return c.json(
      list.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        scenarioId: r.scenario_id,
        status: r.status,
        averageScore: r.average_score != null ? Number(r.average_score) : null,
        passed: r.passed,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        messageCount: Number(r.message_count)
      }))
    );
  });

  return r;
}
