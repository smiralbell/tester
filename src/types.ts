export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export interface Project {
  id: string;
  clientId: string | null;
  name: string;
  webhookUrl: string;
  /** GET, POST, PUT, PATCH o DELETE (por defecto POST). */
  webhookMethod: string;
  webhookAuthToken: string | null;
  /** Cuerpo JSON del POST al webhook (plantilla con placeholders). Si es null, se usan los 4 campos legacy. */
  webhookRequestJson: string | null;
  webhookMessageField: string;
  webhookSessionField: string;
  webhookMetadataField: string;
  responseMessageField: string;
  clientContext: string;
  testInstructions: string;
  createdAt: string;
  updatedAt: string;
}

export interface Scenario {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  successCriteria: string;
  maxMessagesDefault: number;
  createdAt: string;
}

export interface TestRun {
  id: string;
  projectId: string;
  scenarioId: string;
  status: "pending" | "running" | "completed" | "failed";
  maxMessages: number;
  startedAt: string | null;
  finishedAt: string | null;
  averageScore: number | null;
  passed: boolean | null;
  errorCount: number;
  adviceCount: number;
  summary: string | null;
  failureReason: string | null;
  createdAt: string;
}
