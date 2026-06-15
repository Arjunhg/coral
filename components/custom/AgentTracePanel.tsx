"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Loader2,
  RefreshCw,
  Zap,
} from "lucide-react";

type TraceQuery = {
  id: number;
  runId: string | null;
  source: string;
  sql: string;
  rowsReturned: number;
  durationMs: number;
  agentRole: string;
  status: "ok" | "error" | "timeout";
  errorMessage: string | null;
  createdAt: string;
};

type TraceRun = {
  runId: string;
  startedAt: string;
  queryCount: number;
  totalRows: number;
  totalMs: number;
  queries: TraceQuery[];
};

const ROLE_STYLES: Record<string, string> = {
  failure_enricher: "bg-amber-100 text-amber-800",
  writer: "bg-blue-100 text-blue-800",
  analyzer: "bg-violet-100 text-violet-800",
  smart_run: "bg-emerald-100 text-emerald-800",
  explorer: "bg-gray-100 text-gray-800",
};

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  error: "bg-rose-100 text-rose-800",
  timeout: "bg-amber-100 text-amber-800",
};

const SOURCE_STYLES: Record<string, string> = {
  github: "bg-slate-100 text-slate-700",
  sentry: "bg-rose-100 text-rose-700",
  linear: "bg-violet-100 text-violet-700",
  splunk: "bg-orange-100 text-orange-700",
  scriptless: "bg-sky-100 text-sky-700",
};

export default function AgentTracePanel({ testCaseId }: { testCaseId: number }) {
  const [runs, setRuns] = useState<TraceRun[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const [expandedQueries, setExpandedQueries] = useState<Set<number>>(new Set());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`/api/test-cases/${testCaseId}/trace`);
      const nextRuns = Array.isArray(res.data?.runs) ? (res.data.runs as TraceRun[]) : [];
      setRuns(nextRuns);
      if (nextRuns.length > 0) {
        setExpandedRuns(new Set([nextRuns[0].runId]));
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to load trace");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [testCaseId]);

  const toggleRun = (runId: string) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const toggleQuery = (id: number) => {
    setExpandedQueries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden h-full flex flex-col min-h-0">
      <div className="bg-gray-50 px-3.5 py-2 border-b flex items-center gap-2 shrink-0">
        <Zap className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold text-gray-700">Agent Trace</span>
        <Badge variant="outline" className="ml-1 text-[10px] border-gray-300">
          {runs?.reduce((sum, run) => sum + run.queryCount, 0) ?? 0} Coral queries
        </Badge>

        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          <span className="text-[11px]">Refresh</span>
        </Button>
      </div>

      <div className="flex-1 overflow-auto scrollbar-hide p-3 space-y-3">
        {error && (
          <div className="rounded bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800">
            {error}
          </div>
        )}

        {!loading && !error && runs && runs.length === 0 && (
          <p className="text-sm text-gray-500 italic">
            No Coral queries were recorded for this test yet.
          </p>
        )}

        {runs?.map((run) => {
          const isExpanded = expandedRuns.has(run.runId);
          return (
            <div key={run.runId} className="rounded-md border border-gray-200 overflow-hidden">
              <button
                onClick={() => toggleRun(run.runId)}
                className="w-full px-3 py-2 bg-gray-50 hover:bg-gray-100 flex items-center gap-2 text-left transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                )}
                <span className="text-[11px] font-mono text-gray-600">{run.runId.slice(0, 8)}</span>
                <span className="text-[10px] text-gray-400">
                  {new Date(run.startedAt).toLocaleTimeString()}
                </span>
                <div className="ml-auto flex items-center gap-2 text-[10px]">
                  <span className="text-gray-600">
                    {run.queryCount} {run.queryCount === 1 ? "query" : "queries"}
                  </span>
                  <span className="text-gray-400">|</span>
                  <span className="text-gray-600">
                    {run.totalRows} {run.totalRows === 1 ? "row" : "rows"}
                  </span>
                  <span className="text-gray-400">|</span>
                  <span className="text-gray-600 flex items-center gap-0.5">
                    <Clock className="h-3 w-3" />
                    {run.totalMs}ms
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="divide-y divide-gray-100">
                  {run.queries.map((query) => {
                    const isQueryExpanded = expandedQueries.has(query.id);
                    const sourceKey = query.source.split(".")[0] || query.source;
                    return (
                      <div key={query.id} className="px-3 py-2 hover:bg-gray-50">
                        <button
                          onClick={() => toggleQuery(query.id)}
                          className="w-full flex items-center gap-2 text-left"
                        >
                          {isQueryExpanded ? (
                            <ChevronDown className="h-3 w-3 text-gray-400 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-gray-400 shrink-0" />
                          )}
                          <Badge
                            className={`text-[10px] ${
                              ROLE_STYLES[query.agentRole] ?? "bg-gray-100 text-gray-800"
                            } border-none`}
                          >
                            {query.agentRole}
                          </Badge>
                          <Database className="h-3 w-3 text-gray-400" />
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                              SOURCE_STYLES[sourceKey] ?? "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {sourceKey}
                          </span>
                          <span className="text-[11px] font-mono text-gray-700 truncate">{query.source}</span>
                          <div className="ml-auto flex items-center gap-2 text-[10px] text-gray-500">
                            <span>{query.rowsReturned} rows</span>
                            <span className="text-gray-300">|</span>
                            <span>{query.durationMs}ms</span>
                            <Badge
                              className={`text-[9px] ${
                                STATUS_STYLES[query.status] ?? "bg-gray-100 text-gray-800"
                              } border-none`}
                            >
                              {query.status}
                            </Badge>
                          </div>
                        </button>

                        {isQueryExpanded && (
                          <div className="mt-2 ml-5 space-y-2">
                            <div className="rounded bg-gray-950 text-emerald-300 p-2.5 font-mono text-[10.5px] leading-relaxed overflow-auto scrollbar-hide max-h-48">
                              <pre className="whitespace-pre-wrap break-words">{query.sql}</pre>
                            </div>
                            {query.errorMessage && (
                              <div className="rounded bg-rose-50 border border-rose-200 px-2.5 py-1.5 text-[10.5px] text-rose-800">
                                <span className="font-semibold">Error: </span>
                                {query.errorMessage}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
