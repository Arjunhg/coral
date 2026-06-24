"use client";

import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Loader2,
  Play,
  Sparkles,
  Terminal,
} from "lucide-react";

const PENDO_AGENT_ID = "FuFjOvZnWeVyjKqRQZHsui-o7uk";

const SUGGESTED_PROMPTS = [
  "Show me open issues from the last 7 days",
  "Which failing tests touch the checkout route?",
  "List recent commits to authentication files",
  "How many Sentry errors hit /api/users today?",
  "Show recent Splunk error events for the checkout service",
];

type CoralQueryResponse = {
  rows: Record<string, unknown>[];
  count: number;
  duration_ms: number;
};

type Tab = "nl" | "sql" | "results";

type RepoOption = {
  owner: string;
  name: string;
  fullName: string;
};

export default function CoralExplorer({
  initialQuery,
  autoSubmit = false,
  repoOptions = [],
  defaultRepo,
}: {
  initialQuery?: string;
  autoSubmit?: boolean;
  repoOptions?: RepoOption[];
  defaultRepo?: RepoOption;
}) {
  const [nlQuery, setNlQuery] = useState(initialQuery ?? "");
  const [sql, setSql] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("nl");
  const [generating, setGenerating] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogSchemas, setCatalogSchemas] = useState<string[]>([]);
  const [coralAvailable, setCoralAvailable] = useState<boolean | null>(null);
  const autoRanRef = useRef(false);
  const conversationIdRef = useRef(crypto.randomUUID());
  const initialRepoKey = defaultRepo
    ? `${defaultRepo.owner}/${defaultRepo.name}`
    : repoOptions[0]
    ? `${repoOptions[0].owner}/${repoOptions[0].name}`
    : "";
  const [repoKey, setRepoKey] = useState(initialRepoKey);

  useEffect(() => {
    if (!repoKey && repoOptions.length > 0) {
      setRepoKey(`${repoOptions[0].owner}/${repoOptions[0].name}`);
    }
  }, [repoOptions, repoKey]);

  const selectedRepo = repoOptions.find(
    (repo) => `${repo.owner}/${repo.name}` === repoKey
  );
  const resolvedRepo =
    selectedRepo && repoKey
      ? selectedRepo
      : defaultRepo && repoKey === `${defaultRepo.owner}/${defaultRepo.name}`
      ? defaultRepo
      : null;

  useEffect(() => {
    void axios
      .get("/api/coral/query")
      .then((res) => setCoralAvailable(Boolean(res.data?.coral_available)))
      .catch(() => setCoralAvailable(false));
  }, []);

  useEffect(() => {
    if (autoSubmit && initialQuery && !autoRanRef.current) {
      autoRanRef.current = true;
      void handleGenerateAndRun(initialQuery);
    }
  }, [autoSubmit, initialQuery]);

  const handleGenerate = async (text: string): Promise<string | null> => {
    setError(null);
    setGenerating(true);

    try {
      const res = await axios.post("/api/coral/nl-to-sql", {
        text,
        context: resolvedRepo
          ? { owner: resolvedRepo.owner, repo: resolvedRepo.name }
          : null,
      });
      const generatedSql = String(res.data?.sql ?? "");
      setSql(generatedSql);
      setCatalogSchemas(Array.isArray(res.data?.catalog_schemas) ? res.data.catalog_schemas : []);
      setTab("sql");

      window.pendo?.trackAgent("agent_response", {
        agentId: PENDO_AGENT_ID,
        conversationId: conversationIdRef.current,
        messageId: crypto.randomUUID(),
        content: generatedSql,
        modelUsed: "gemini-3.1-flash-lite",
      });

      return generatedSql;
    } catch (err: any) {
      const detail = err.response?.data?.detail || err.response?.data?.error || err.message;
      setError(String(detail));
      return null;
    } finally {
      setGenerating(false);
    }
  };

  const handleRun = async (sqlToRun: string): Promise<void> => {
    setError(null);
    setRunning(true);
    setRows(null);

    try {
      const res = await axios.post<CoralQueryResponse>("/api/coral/query", {
        sql: sqlToRun,
      });
      setRows(res.data.rows);
      setDurationMs(res.data.duration_ms);
      setTab("results");
    } catch (err: any) {
      const detail = err.response?.data?.detail || err.response?.data?.error || err.message;
      setError(String(detail));
    } finally {
      setRunning(false);
    }
  };

  const handleGenerateAndRun = async (text: string) => {
    window.pendo?.trackAgent("prompt", {
      agentId: PENDO_AGENT_ID,
      conversationId: conversationIdRef.current,
      messageId: crypto.randomUUID(),
      content: text,
      suggestedPrompt: SUGGESTED_PROMPTS.includes(text),
    });

    const generated = await handleGenerate(text);
    if (generated) {
      await handleRun(generated);
    }
  };

  const columns = rows && rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-50/60 flex items-center gap-3">
        <Database className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm text-gray-800">Coral Explorer</h2>

        {coralAvailable === false && (
          <Badge variant="destructive" className="text-[10px] gap-1 ml-2">
            <AlertCircle className="h-3 w-3" />
            Coral disconnected
          </Badge>
        )}

        {coralAvailable === true && (
          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none text-[10px] gap-1 ml-2">
            <CheckCircle2 className="h-3 w-3" />
            Connected
          </Badge>
        )}

        {catalogSchemas.length > 0 && (
          <div className="ml-auto flex gap-1 flex-wrap">
            {catalogSchemas.map((schema) => (
              <Badge key={schema} variant="outline" className="text-[10px] font-mono">
                {schema}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b bg-white overflow-x-auto">
        {([
          { id: "nl", label: "Ask in English", icon: Sparkles },
          { id: "sql", label: "SQL", icon: Terminal },
          {
            id: "results",
            label: rows ? `Results (${rows.length})` : "Results",
            icon: Database,
          },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
              tab === id
                ? "bg-primary/10 text-primary border-primary/40"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      <div className="p-4 min-h-[280px]">
        {tab === "nl" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="text-gray-500">Repo scope:</span>
              {repoOptions.length > 0 ? (
                <select
                  value={repoKey}
                  onChange={(e) => setRepoKey(e.target.value)}
                  className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700"
                >
                  {repoOptions.map((repo) => (
                    <option key={repo.fullName} value={`${repo.owner}/${repo.name}`}>
                      {repo.fullName}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-gray-400">
                  No repositories connected
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">Ask anything across connected sources. Examples:</p>

            <div className="flex flex-wrap gap-2">
              {[
                "Show me open issues from the last 7 days",
                "Which failing tests touch the checkout route?",
                "List recent commits to authentication files",
                "How many Sentry errors hit /api/users today?",
                "Show recent Splunk error events for the checkout service",
              ].map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setNlQuery(example)}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700"
                >
                  {example}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                value={nlQuery}
                onChange={(e) => setNlQuery(e.target.value)}
                placeholder="e.g. show me recent Splunk error events for checkout"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (nlQuery.trim()) {
                      void handleGenerateAndRun(nlQuery.trim());
                    }
                  }
                }}
              />

              <Button
                onClick={() => nlQuery.trim() && void handleGenerateAndRun(nlQuery.trim())}
                disabled={generating || running || !nlQuery.trim()}
                className="gap-2 shrink-0"
              >
                {generating || running ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Ask
              </Button>
            </div>
          </div>
        )}

        {tab === "sql" && (
          <div className="space-y-3">
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-gray-100 px-3 py-2 border-b flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-gray-600">
                  Generated SQL (editable before running)
                </span>
              </div>

              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                className="w-full h-48 p-3 font-mono text-xs bg-gray-950 text-emerald-300 border-0 focus:outline-none resize-none"
                spellCheck={false}
                placeholder="-- Generated SQL will appear here..."
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setTab("nl")} className="gap-2">
                Back
              </Button>

              <Button
                onClick={() => sql.trim() && void handleRun(sql.trim())}
                disabled={running || !sql.trim()}
                className="gap-2"
              >
                {running ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run query
              </Button>
            </div>
          </div>
        )}

        {tab === "results" && (
          <div className="space-y-2">
            {durationMs !== null && rows && (
              <p className="text-[11px] text-gray-500">
                {rows.length} row{rows.length === 1 ? "" : "s"} | {durationMs}ms
              </p>
            )}

            {rows && rows.length === 0 && (
              <p className="text-sm text-gray-500">No rows returned.</p>
            )}

            {rows && rows.length > 0 && (
              <div className="overflow-auto border rounded-lg max-h-[400px]">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {columns.map((column) => (
                        <th
                          key={column}
                          className="px-3 py-2 text-left font-semibold text-gray-700 border-b"
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {rows.slice(0, 200).map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-b hover:bg-gray-50">
                        {columns.map((column) => {
                          const value = row[column];
                          const display =
                            value === null || value === undefined
                              ? "-"
                              : typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value);

                          return (
                            <td
                              key={column}
                              className="px-3 py-1.5 text-gray-800 align-top max-w-[300px] truncate"
                              title={display}
                            >
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {rows.length > 200 && (
                  <p className="px-3 py-2 text-[11px] text-gray-500 bg-gray-50 border-t">
                    Showing first 200 of {rows.length} rows.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-4 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800 flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
