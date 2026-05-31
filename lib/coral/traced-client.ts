import { coral, CoralError, CoralRow } from "@/lib/coral/client";
import { AgentRole, logAgentQuery, TraceEntry } from "@/lib/coral/trace-logger";

type TracedSqlOptions = {
  testCaseId?: number;
  runId: string;
  source: string;
  agentRole: AgentRole;
  timeoutMs?: number;
};

export async function tracedSql(
  sql: string,
  opts: TracedSqlOptions
): Promise<CoralRow[]> {
  const t0 = performance.now();
  let rows: CoralRow[] = [];
  let status: TraceEntry["status"] = "ok";
  let errorMessage: string | undefined;

  try {
    rows = await coral.sql(sql, { timeoutMs: opts.timeoutMs });
  } catch (err) {
    if (err instanceof CoralError && err.status === 504) {
      status = "timeout";
    } else {
      status = "error";
    }
    errorMessage = err instanceof Error ? err.message : String(err);
    rows = [];
  }

  const ms = Math.round(performance.now() - t0);
  void logAgentQuery({
    testCaseId: opts.testCaseId,
    runId: opts.runId,
    source: opts.source,
    sql,
    rowsReturned: rows.length,
    durationMs: ms,
    agentRole: opts.agentRole,
    status,
    errorMessage,
  });

  return rows;
}
