import { z } from "zod";
import { completeWithOpenRouter } from "./openrouter";
import type { Project, Scenario } from "./types";
import type { RunMetrics } from "./test-runner";
import type { ExchangeEvaluation } from "./test-runner";

type TranscriptLite = {
  testerMessage: string;
  agentReply: string;
  webhookResponseMs?: number | null;
  evaluation: ExchangeEvaluation;
};

const insightSchema = z.object({
  executiveSummary: z.string(),
  whatWentWell: z.array(z.string()).default([]),
  problems: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  kpis: z.object({
    exchanges: z.number(),
    avgScore: z.number(),
    passRatePct: z.number(),
    riskLevel: z.enum(["bajo", "medio", "alto"])
  })
});

function stripJsonFence(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return m ? m[1].trim() : t;
}

export type RunInsightKpi = z.infer<typeof insightSchema>["kpis"] & {
  totalErrors: number;
  totalAdvice: number;
  responseTimeAvgMs: number | null;
  responseTimeP95Ms: number | null;
  consistencyPct: number;
  reliabilityObservedPct: number;
  sampleConfidence: "baja" | "media" | "alta";
  stoppedByDeadline?: boolean;
};

export type RunInsightResult = {
  markdown: string;
  kpi: RunInsightKpi;
};

export async function generateRunInsight(input: {
  project: Project;
  scenario: Scenario;
  transcript: TranscriptLite[];
  metrics: RunMetrics;
  evaluationBrief?: string | null;
  stoppedByDeadline?: boolean;
}): Promise<RunInsightResult> {
  const { project, scenario, transcript, metrics, evaluationBrief, stoppedByDeadline } = input;
  const responseTimes = transcript
    .map((t) => t.webhookResponseMs)
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);
  const responseTimeAvgMs =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((sum, x) => sum + x, 0) / responseTimes.length)
      : null;
  const p95Idx = responseTimes.length > 0 ? Math.min(responseTimes.length - 1, Math.ceil(responseTimes.length * 0.95) - 1) : -1;
  const responseTimeP95Ms = p95Idx >= 0 ? responseTimes[p95Idx] : null;
  const passTurns = transcript.filter((t) => t.evaluation.passed).length;
  const reliabilityObservedPct = transcript.length > 0 ? Math.round((100 * passTurns) / transcript.length) : 0;
  const consistencyPct =
    transcript.length > 1
      ? Math.round(
          (100 *
            transcript.reduce((acc, t, i, arr) => {
              if (i === 0) return acc;
              return acc + (Math.abs(t.evaluation.score - arr[i - 1].evaluation.score) <= 12 ? 1 : 0);
            }, 0)) /
            (transcript.length - 1)
        )
      : 100;
  const sampleConfidence: "baja" | "media" | "alta" =
    transcript.length >= 12 ? "alta" : transcript.length >= 7 ? "media" : "baja";

  const turnDigest = transcript.map((t, i) => ({
    turn: i + 1,
    score: t.evaluation.score,
    passed: t.evaluation.passed,
    testerPreview: t.testerMessage.slice(0, 400),
    agentPreview: t.agentReply.slice(0, 400),
    errors: t.evaluation.errors.slice(0, 5),
    advice: t.evaluation.advice.slice(0, 4),
    notes: t.evaluation.notes.slice(0, 280)
  }));

  const prompt = `
Eres el agente senior de QA de Buffalo. Has supervisado una prueba automatizada contra un webhook (simulación de WhatsApp).

Objetivo declarado del evaluador humano (brief):
${evaluationBrief ?? "(no aportado)"}

Proyecto QA: ${project.name}
Escenario en BD:
- Nombre: ${scenario.name}
- Meta (goal): ${scenario.goal}
- Criterio de éxito: ${scenario.successCriteria}

Métricas agregadas:
- Score medio: ${metrics.averageScore.toFixed(1)}
- ¿Superó?: ${metrics.passed ? "sí" : "no"}
- Total errores listados: ${metrics.errorCount}
- Total consejos listados: ${metrics.adviceCount}
- Resumen algorítmico: ${metrics.summary}
${stoppedByDeadline ? "- Nota: la prueba se detuvo por límite de tiempo.\n" : ""}

Turnos (JSON):
${JSON.stringify(turnDigest, null, 2)}

Devuelve SOLO un JSON válido con esta forma exacta (sin markdown alrededor):
{
  "executiveSummary": "2-4 frases en español para dirección de producto",
  "whatWentWell": ["..."],
  "problems": ["problemas concretos observados"],
  "recommendations": ["acciones priorizadas"],
  "kpis": {
    "exchanges": ${transcript.length},
    "avgScore": número decimal 0-100 alineado con la tabla,
    "passRatePct": porcentaje de turnos passed,
    "riskLevel": "bajo" | "medio" | "alto"
  }
}
`;

  const raw = await completeWithOpenRouter([
    { role: "system", content: "Eres analista QA. Respondes únicamente JSON válido UTF-8, sin texto fuera del objeto." },
    { role: "user", content: prompt }
  ]);

  let parsed: z.infer<typeof insightSchema>;
  try {
    parsed = insightSchema.parse(JSON.parse(stripJsonFence(raw)));
  } catch {
    parsed = {
      executiveSummary: raw.slice(0, 800),
      whatWentWell: [],
      problems: ["No se pudo parsear el JSON de insight del modelo"],
      recommendations: ["Repetir la prueba o revisar OPENROUTER_MODEL"],
      kpis: {
        exchanges: transcript.length,
        avgScore: metrics.averageScore,
        passRatePct:
          transcript.length > 0
            ? Math.round((100 * transcript.filter((t) => t.evaluation.passed).length) / transcript.length)
            : 0,
        riskLevel: "alto"
      }
    };
  }

  const passRatePct =
    transcript.length > 0
      ? Math.round((100 * transcript.filter((t) => t.evaluation.passed).length) / transcript.length)
      : parsed.kpis.passRatePct;

  const kpi: RunInsightKpi = {
    ...parsed.kpis,
    exchanges: transcript.length,
    avgScore: Number(parsed.kpis.avgScore.toFixed(1)),
    passRatePct,
    totalErrors: metrics.errorCount,
    totalAdvice: metrics.adviceCount,
    responseTimeAvgMs,
    responseTimeP95Ms,
    consistencyPct,
    reliabilityObservedPct,
    sampleConfidence,
    stoppedByDeadline: Boolean(stoppedByDeadline)
  };

  const readiness =
    kpi.avgScore >= 85 && kpi.reliabilityObservedPct >= 90 && kpi.riskLevel === "bajo"
      ? "Apto para producción"
      : kpi.avgScore >= 70 && kpi.reliabilityObservedPct >= 75
        ? "Apto con mejoras"
        : "No apto aún";

  const md = [
    `## Veredicto QA`,
    `**${readiness}** · Riesgo **${kpi.riskLevel}** · Confianza muestral **${kpi.sampleConfidence}**`,
    ``,
    `## Resumen ejecutivo`,
    parsed.executiveSummary,
    ``,
    `## KPIs clave`,
    `- Cobertura ejecutada: **${kpi.exchanges}** turnos`,
    `- Calidad media: **${kpi.avgScore}/100**`,
    `- Fiabilidad observada (turnos OK): **${kpi.reliabilityObservedPct}%**`,
    `- Consistencia entre turnos: **${kpi.consistencyPct}%**`,
    `- Tiempo respuesta medio: **${kpi.responseTimeAvgMs != null ? `${kpi.responseTimeAvgMs} ms` : "N/D"}**`,
    `- Tiempo respuesta p95: **${kpi.responseTimeP95Ms != null ? `${kpi.responseTimeP95Ms} ms` : "N/D"}**`,
    `- Errores detectados: **${kpi.totalErrors}** · Recomendaciones: **${kpi.totalAdvice}**`,
    stoppedByDeadline ? `- ⚠️ Finalizada por **límite de tiempo**` : "",
    ``,
    `## Fortalezas`,
    ...(parsed.whatWentWell.length ? parsed.whatWentWell.map((x) => `- ${x}`) : ["- (nada destacable)"]),
    ``,
    `## Fallos detectados`,
    ...(parsed.problems.length ? parsed.problems.map((x) => `- ${x}`) : ["- (ninguno explícito)"]),
    ``,
    `## Acciones recomendadas`,
    ...(parsed.recommendations.length ? parsed.recommendations.map((x) => `- ${x}`) : ["- (mantener monitorización)"])
  ]
    .filter(Boolean)
    .join("\n");

  return { markdown: md, kpi };
}
