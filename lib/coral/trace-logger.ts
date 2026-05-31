import { db } from "@/db";
import { agentQueries } from "@/db/schema";

export type AgentRole =
  | "writer"
  | "analyzer"
  | "failure_enricher"
  | "smart_run"
  | "explorer";

export type TraceEntry = {
  testCaseId?: number;
  runId: string;
  source: string;
  sql: string;
  rowsReturned: number;
  durationMs: number;
  agentRole: AgentRole;
  status?: "ok" | "error" | "timeout";
  errorMessage?: string;
};

export async function logAgentQuery(entry: TraceEntry): Promise<void> {
  try {
    await db.insert(agentQueries).values({
      testCaseId: entry.testCaseId,
      runId: entry.runId,
      source: entry.source,
      sql: entry.sql.slice(0, 4000),
      rowsReturned: entry.rowsReturned,
      durationMs: entry.durationMs,
      agentRole: entry.agentRole,
      status: entry.status ?? "ok",
      errorMessage: entry.errorMessage?.slice(0, 1000),
    });
  } catch (err) {
    console.warn("[trace-logger] persist failed:", (err as Error).message);
  }
}

export function newRunId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
