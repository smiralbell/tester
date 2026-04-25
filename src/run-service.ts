import { query } from "./db";
import { generateRunInsight } from "./run-insight";
import { executeScenario, type TranscriptItem, type RunMetrics } from "./test-runner";
import type { Project, Scenario } from "./types";

export class RunFailedError extends Error {
  readonly runId: string;
  constructor(runId: string, message: string) {
    super(message);
    this.name = "RunFailedError";
    this.runId = runId;
  }
}

export type ExecuteTestRunOptions = {
  maxMessages: number;
  deadlineMs?: number;
  evaluationBrief?: string | null;
};

export type ExecuteTestRunResult = {
  runId: string;
  metrics: RunMetrics;
  exchanges: number;
  stoppedByDeadline: boolean;
  qaInsight: string | null;
  kpiSnapshot: unknown | null;
  durationMs: number;
};

export async function insertRunningTestRun(
  projectId: string,
  scenarioId: string,
  maxMessages: number,
  evaluationBrief: string | null
): Promise<string> {
  const runRow = await query<{ id: string }>(
    `INSERT INTO test_runs (project_id, scenario_id, status, max_messages, started_at, evaluation_brief)
     VALUES ($1,$2,'running',$3, NOW(), $4)
     RETURNING id`,
    [projectId, scenarioId, maxMessages, evaluationBrief]
  );
  const runId = runRow[0]?.id;
  if (!runId) {
    throw new Error("Could not create run");
  }
  return runId;
}

async function insertRunMessage(runId: string, item: TranscriptItem): Promise<void> {
  await query(
    `INSERT INTO run_messages
      (run_id, tester_message, agent_reply, response_ms, score, passed, errors, advice, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      runId,
      item.testerMessage,
      item.agentReply,
      item.webhookResponseMs,
      item.evaluation.score,
      item.evaluation.passed,
      JSON.stringify(item.evaluation.errors),
      JSON.stringify(item.evaluation.advice),
      item.evaluation.notes
    ]
  );
}

/**
 * Ejecuta el escenario y actualiza el run. Si `incremental`, cada turno se guarda en `run_messages` al completarse (vista en vivo).
 */
export async function executeRunAfterInsert(
  runId: string,
  project: Project,
  scenario: Scenario,
  opts: ExecuteTestRunOptions,
  incremental: boolean
): Promise<ExecuteTestRunResult> {
  const { maxMessages, deadlineMs, evaluationBrief } = opts;
  const t0 = Date.now();
  try {
    const onTurnComplete = incremental
      ? async (item: TranscriptItem) => {
          await insertRunMessage(runId, item);
        }
      : undefined;

    const result = await executeScenario(project, scenario, maxMessages, {
      deadlineMs,
      onTurnComplete
    });
    const durationMs = Date.now() - t0;

    if (!incremental) {
      for (const item of result.transcript) {
        await insertRunMessage(runId, item);
      }
    }

    let qaInsight: string | null = null;
    let kpiSnapshot: unknown | null = null;
    try {
      const insight = await generateRunInsight({
        project,
        scenario,
        transcript: result.transcript,
        metrics: result.metrics,
        evaluationBrief,
        stoppedByDeadline: result.stoppedByDeadline
      });
      qaInsight = insight.markdown;
      kpiSnapshot = insight.kpi;
    } catch (e) {
      console.warn("[run-service] generateRunInsight:", e);
    }

    await query(
      `UPDATE test_runs
       SET status = 'completed',
           finished_at = NOW(),
           average_score = $2,
           passed = $3,
           error_count = $4,
           advice_count = $5,
           summary = $6,
           duration_ms = $7,
           qa_insight = $8,
           kpi_snapshot = $9::jsonb
       WHERE id = $1`,
      [
        runId,
        result.metrics.averageScore,
        result.metrics.passed,
        result.metrics.errorCount,
        result.metrics.adviceCount,
        result.metrics.summary,
        durationMs,
        qaInsight,
        kpiSnapshot != null ? JSON.stringify(kpiSnapshot) : null
      ]
    );

    return {
      runId,
      metrics: result.metrics,
      exchanges: result.transcript.length,
      stoppedByDeadline: result.stoppedByDeadline,
      qaInsight,
      kpiSnapshot,
      durationMs
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unexpected error";
    await query(
      `UPDATE test_runs
       SET status = 'failed',
           finished_at = NOW(),
           failure_reason = $2,
           duration_ms = $3
       WHERE id = $1`,
      [runId, msg, Date.now() - t0]
    );
    throw new RunFailedError(runId, msg);
  }
}

export async function executeAndPersistTestRun(
  project: Project,
  scenario: Scenario,
  opts: ExecuteTestRunOptions
): Promise<ExecuteTestRunResult> {
  const runId = await insertRunningTestRun(
    project.id,
    scenario.id,
    opts.maxMessages,
    opts.evaluationBrief ?? null
  );
  return executeRunAfterInsert(runId, project, scenario, opts, false);
}

/** Lanza la ejecución en segundo plano (no espera al resultado). Errores solo en consola + fila `failed`. */
export function scheduleQuickTestExecution(
  runId: string,
  project: Project,
  scenario: Scenario,
  opts: ExecuteTestRunOptions
): void {
  void executeRunAfterInsert(runId, project, scenario, opts, true).catch((err) => {
    if (err instanceof RunFailedError) {
      console.warn("[run-service] quick test run failed:", err.runId, err.message);
    } else {
      console.error("[run-service] quick test unexpected error:", err);
    }
  });
}
