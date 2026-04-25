export type AgentSummary = {
  agentId: string;
  agentName: string;
  agentCreatedAt: string;
  primaryProjectId: string | null;
  projectIds: string[];
  totalTestMessages: number;
  avgScore: number | null;
  totalRuns: number;
  completedRuns: number;
};
