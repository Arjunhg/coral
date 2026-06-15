import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenAI } from "@google/genai";
import { coral, CoralError } from "@/lib/coral/client";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

let cachedCatalog: { tables: Array<Record<string, unknown>>; fetchedAt: number } | null = null;
const CATALOG_TTL_MS = 5 * 60 * 1000;

async function getCatalog() {
  const now = Date.now();
  if (cachedCatalog && now - cachedCatalog.fetchedAt < CATALOG_TTL_MS) {
    return cachedCatalog.tables;
  }

  const tables = await coral.listCatalog();
  cachedCatalog = { tables: tables as Array<Record<string, unknown>>, fetchedAt: now };
  return cachedCatalog.tables;
}

function formatCatalogForPrompt(tables: Array<Record<string, unknown>>) {
  const bySchema: Record<string, Array<Record<string, unknown>>> = {};

  for (const table of tables) {
    const schemaName = String(table.schema_name ?? "unknown");
    (bySchema[schemaName] ||= []).push(table);
  }

  return Object.entries(bySchema)
    .map(([schema, list]) => {
      const lines = list.map((table) => {
        const required = String(table.required_filters ?? "").trim();
        const requiredHint = required ? ` (REQUIRED FILTERS: ${required})` : "";
        const tableName = String(table.table_name ?? "unknown_table");
        const description = String(table.description ?? "No description");
        const relationType = String(table.relation_type ?? "table");
        const callHint =
          relationType === "table_function"
            ? " (TABLE FUNCTION: call in FROM using named args)"
            : "";
        return `- ${schema}.${tableName}${callHint}${requiredHint}: ${description}`;
      });
      return `Schema "${schema}":\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { text, context } = await req.json().catch(() => ({ text: null, context: null }));
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const contextOwner =
    context && typeof context.owner === "string" ? context.owner.trim() : "";
  const contextRepo =
    context && typeof context.repo === "string" ? context.repo.trim() : "";

  let catalog: Array<Record<string, unknown>> = [];
  try {
    catalog = await getCatalog();
  } catch (err) {
    return NextResponse.json(
      {
        error: "catalog_unavailable",
        detail: err instanceof CoralError ? err.detail : undefined,
      },
      { status: 503 }
    );
  }

  if (catalog.length === 0) {
    return NextResponse.json(
      { error: "no_sources", detail: "No Coral sources are configured." },
      { status: 412 }
    );
  }

  const catalogBlock = formatCatalogForPrompt(catalog);

  const contextBlock =
    contextOwner && contextRepo
      ? `Default repository context:
- owner = '${contextOwner}'
- repo = '${contextRepo}'
If the user asks about commits/issues/PRs without specifying a repo, use the defaults above for required filters.`
      : "No default repository context is available.";

  const prompt = `You are a SQL generation assistant for Coral, a read-only federated SQL engine.

Convert the user's natural-language question into ONE valid SELECT statement.

${contextBlock}

Available tables (use ONLY these, do NOT invent table names):
${catalogBlock}

Rules:
1. Output ONLY raw SQL. No markdown fences, commentary, or explanations.
2. SELECT only. Never INSERT/UPDATE/DELETE/DROP/CREATE/ALTER.
3. If a table lists REQUIRED FILTERS, include them in the WHERE clause as equality predicates.
4. Use ILIKE for substring searches.
5. Use UNION ALL when the user asks for items across sources, with a literal kind column.
6. Default LIMIT to 25 unless the user specifies a number.
7. Quote string literals with single quotes; escape internal quotes by doubling.
8. Use fully qualified table names (schema.table).
9. For table functions, call them in the FROM clause using named arguments, for example: SELECT * FROM schema.function(arg_name => 'value').
10. For splunk.search_results, pass a full Splunk SPL string in the search argument. When the user asks for logs or events, build a bounded SPL search and include "| fields _time host source sourcetype _raw index splunk_server | head 25" inside that string.
11. If the question cannot be answered with these tables, output exactly: -- CANNOT_ANSWER

User question: ${text.trim()}

SQL:`;

  let generatedSql = "";
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: prompt,
    });
    generatedSql = (response.text || "").trim();
  } catch (err) {
    return NextResponse.json(
      {
        error: "generation_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  generatedSql = generatedSql
    .replace(/^```sql\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/, "")
    .trim();

  if (generatedSql === "-- CANNOT_ANSWER") {
    const wantsCommits = /\bcommit(s)?\b/i.test(text);
    const hasCommitsTable = catalog.some(
      (table) =>
        String(table.schema_name) === "github" && String(table.table_name) === "commits"
    );

    if (wantsCommits && hasCommitsTable && contextOwner && contextRepo) {
      generatedSql = `SELECT * FROM github.commits WHERE owner = '${contextOwner}' AND repo = '${contextRepo}' LIMIT 25`;
    }
  }

  if (generatedSql === "-- CANNOT_ANSWER" || !generatedSql) {
    return NextResponse.json(
      {
        error: "not_answerable",
        detail: "The question cannot be answered with the connected sources.",
        suggestion: "Try asking about tests, GitHub issues, commits, Splunk logs, or any connected source.",
      },
      { status: 422 }
    );
  }

  const denyPattern = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke)\b/i;
  if (denyPattern.test(generatedSql)) {
    return NextResponse.json(
      { error: "unsafe_generation", detail: "Generated SQL contained forbidden keywords." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    sql: generatedSql,
    catalog_size: catalog.length,
    catalog_schemas: [...new Set(catalog.map((table) => String(table.schema_name ?? "unknown")))],
  });
}
