import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenAI } from "@google/genai";
import { coral, CoralColumn, CoralError, withCoralTenant } from "@/lib/coral/client";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const cachedCatalogByTenant = new Map<
  string,
  { tables: Array<Record<string, unknown>>; fetchedAt: number }
>();
const CATALOG_TTL_MS = 5 * 60 * 1000;

async function getCatalog(tenantId: string) {
  const now = Date.now();
  const cachedCatalog = cachedCatalogByTenant.get(tenantId);
  if (cachedCatalog && now - cachedCatalog.fetchedAt < CATALOG_TTL_MS) {
    return cachedCatalog.tables;
  }

  const tables = await withCoralTenant(tenantId, () => coral.listCatalog());
  cachedCatalogByTenant.set(tenantId, {
    tables: tables as Array<Record<string, unknown>>,
    fetchedAt: now,
  });
  return tables as Array<Record<string, unknown>>;
}

const cachedColumnsByKey = new Map<
  string,
  { columns: CoralColumn[]; fetchedAt: number }
>();
const COLUMNS_TTL_MS = 5 * 60 * 1000;

async function getColumns(
  tenantId: string,
  schema: string,
  table: string
): Promise<CoralColumn[]> {
  const key = `${tenantId}:${schema}.${table}`;
  const now = Date.now();
  const cached = cachedColumnsByKey.get(key);
  if (cached && now - cached.fetchedAt < COLUMNS_TTL_MS) {
    return cached.columns;
  }

  const columns = await withCoralTenant(tenantId, () =>
    coral.listColumns(schema, table)
  );
  cachedColumnsByKey.set(key, { columns, fetchedAt: now });
  return columns;
}

// Stage A: ask the model which catalog tables are relevant, so we only fetch
// columns for a handful instead of dumping columns for hundreds of tables
// (GitHub alone exposes 360+). Returns validated {schema, table} refs.
async function selectRelevantTables(
  question: string,
  catalogBlock: string,
  catalog: Array<Record<string, unknown>>
): Promise<Array<{ schema: string; table: string }>> {
  const selectionPrompt = `From the table list below, pick ONLY the tables needed to answer the question.
Output a JSON array of objects like [{"schema":"github","table":"issues"}]. Max 6 entries. Output JSON only, no prose, no code fences.

Tables:
${catalogBlock}

Question: ${question}

JSON:`;

  let raw = "";
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: selectionPrompt,
    });
    raw = (response.text || "").trim();
  } catch {
    return [];
  }

  raw = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  // Only keep refs that actually exist in the catalog.
  const valid = new Set(
    catalog.map((t) => `${String(t.schema_name)}.${String(t.table_name)}`)
  );
  const seen = new Set<string>();
  const refs: Array<{ schema: string; table: string }> = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const schema = String((entry as Record<string, unknown>).schema ?? "").trim();
    const table = String((entry as Record<string, unknown>).table ?? "").trim();
    const key = `${schema}.${table}`;
    if (schema && table && valid.has(key) && !seen.has(key)) {
      seen.add(key);
      refs.push({ schema, table });
    }
    if (refs.length >= 8) break;
  }
  return refs;
}

function formatColumnsForPrompt(
  selected: Array<{
    schema: string;
    table: string;
    relationType: string;
    columns: CoralColumn[];
  }>
) {
  return selected
    .map(({ schema, table, relationType, columns }) => {
      const cols = columns
        .map((col) => {
          const flag = col.is_required_filter
            ? relationType === "table_function"
              ? " [required arg]"
              : " [required filter]"
            : "";
          return `${col.column_name} (${col.data_type})${flag}`;
        })
        .join(", ");
      const kind = relationType === "table_function" ? "table function" : "table";
      return `- ${schema}.${table} (${kind}): ${cols || "no columns reported"}`;
    })
    .join("\n");
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
    catalog = await getCatalog(userId);
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

  // Two-stage grounding: pick the relevant tables, then fetch their real
  // columns so the model never invents a column (e.g. created_at on a search
  // table function that does not expose it).
  let columnsBlock = "";
  try {
    const refs = await selectRelevantTables(text.trim(), catalogBlock, catalog);
    if (refs.length > 0) {
      const catalogByKey = new Map(
        catalog.map((t) => [`${String(t.schema_name)}.${String(t.table_name)}`, t])
      );
      const fetched = await Promise.allSettled(
        refs.map(async (ref) => {
          const columns = await getColumns(userId, ref.schema, ref.table);
          const meta = catalogByKey.get(`${ref.schema}.${ref.table}`);
          return {
            schema: ref.schema,
            table: ref.table,
            relationType: String(meta?.relation_type ?? "table"),
            columns,
          };
        })
      );
      const selected = fetched
        .filter(
          (r): r is PromiseFulfilledResult<{
            schema: string;
            table: string;
            relationType: string;
            columns: CoralColumn[];
          }> => r.status === "fulfilled" && r.value.columns.length > 0
        )
        .map((r) => r.value);
      if (selected.length > 0) {
        columnsBlock = formatColumnsForPrompt(selected);
      }
    }
  } catch {
    // Non-fatal: fall back to table-only grounding if column lookup fails.
    columnsBlock = "";
  }

  const columnsSection = columnsBlock
    ? `Verified columns for the tables most relevant to this question (use ONLY these columns for these tables; do NOT reference any column not listed here):
${columnsBlock}

`
    : "";

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

${columnsSection}Rules:
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
12. CRITICAL: Only reference columns that appear in the "Verified columns" section for that exact table. Never use a column that is not listed there. If a column you want (for example created_at, body, or description) is NOT listed for a table, do not SELECT, filter, or ORDER BY it — choose a listed column or drop that clause.
13. When you need columns like created_at, updated_at, body, or description, prefer a base table (relation type "table", e.g. github.issues) over a search-style table function (e.g. github.search_issues), because search functions usually expose only title/url/state/number and have no timestamp column.
14. In a UNION ALL, every branch must SELECT the same number of columns in the same order; if one source lacks a column another has (e.g. a timestamp), select NULL for it in the branch that lacks it so the column lists line up.

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
