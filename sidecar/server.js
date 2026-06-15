import express from "express";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const app = express();
app.use(express.json({ limit: "1mb" }));

const SHARED_SECRET = process.env.SIDECAR_SHARED_SECRET;
const CORAL_BIN = process.env.CORAL_BIN || "coral";
const CURL_BIN = process.env.CURL_BIN || "curl";
const CORAL_CONFIG_DIR = process.env.CORAL_CONFIG_DIR || "/coral-config";
const CONFIG_PATH = path.join(CORAL_CONFIG_DIR, "config.json");
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_SQL_LEN = 8000; 

function authenticate(req, res, next) {
  const got = req.headers["x-sidecar-secret"];
  if (!SHARED_SECRET || got !== SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

async function runCoral(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  try {
    const { stdout, stderr } = await exec(CORAL_BIN, args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024, // 32MB for large result sets
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return {
      ok: false,
      stderr: err.stderr?.toString() || err.message,
      stdout: err.stdout?.toString() || "",
      code: err.code,
    };
  }
}

async function runCurl(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  try {
    const { stdout, stderr } = await exec(CURL_BIN, args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return {
      ok: false,
      stderr: err.stderr?.toString() || err.message,
      stdout: err.stdout?.toString() || "",
      code: err.code,
    };
  }
}

function requireLoopback(req, res, next) {
  const remote = req.socket?.remoteAddress || "";
  const forwardedFor = String(req.headers["x-forwarded-for"] || "");
  const isLoopback =
    remote === "::1" ||
    remote === "127.0.0.1" ||
    remote === "::ffff:127.0.0.1" ||
    forwardedFor.includes("127.0.0.1") ||
    forwardedFor.includes("::1");

  if (!isLoopback) {
    return res.status(403).json({ error: "loopback_only" });
  }

  next();
}

function getSplunkProxyConfig(req) {
  const splunkHost = String(req.headers["x-splunk-host"] || "").trim().replace(/\/+$/, "");
  const splunkToken = String(req.headers["x-splunk-token"] || "").trim();

  if (!splunkHost || !splunkToken) {
    return { error: "x-splunk-host and x-splunk-token are required" };
  }

  return { splunkHost, splunkToken };
}

function normalizeSplunkEntry(entry, mapper) {
  const content = entry?.content && typeof entry.content === "object" ? entry.content : {};
  return mapper(entry, content);
}

function parseJsonOrFail(result, res, errorCode) {
  try {
    return JSON.parse(result.stdout || "{}");
  } catch (error) {
    res.status(500).json({ error: errorCode, detail: error.message });
    return null;
  }
}

function normalizeSavedSearches(payload) {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  return entries.map((entry) =>
    normalizeSplunkEntry(entry, (row, content) => ({
      name: row.name ?? null,
      id: row.id ?? null,
      updated: row.updated ?? null,
      description: content.description ?? null,
      search: content.search ?? null,
      disabled: content.disabled ?? null,
      cron_schedule: content.cron_schedule ?? null,
      actions: content.actions ?? null,
      alert_type: content.alert_type ?? null,
      alert_condition: content.alert_condition ?? null,
      alert_threshold: content.alert_threshold ?? null,
      raw_content: content,
    }))
  );
}

function normalizeFiredAlerts(payload) {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  return entries.map((entry) =>
    normalizeSplunkEntry(entry, (row, content) => ({
      name: row.name ?? null,
      id: row.id ?? null,
      updated: row.updated ?? null,
      triggered_alert_count: content.triggered_alert_count ?? null,
      raw_content: content,
    }))
  );
}

function normalizeIndexes(payload) {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  return entries.map((entry) =>
    normalizeSplunkEntry(entry, (row, content) => ({
      name: row.name ?? null,
      id: row.id ?? null,
      updated: row.updated ?? null,
      datatype: content.datatype ?? null,
      disabled: content.disabled ?? null,
      total_event_count: content.totalEventCount ?? null,
      current_db_size_mb: content.currentDBSizeMB ?? null,
      max_total_data_size_mb: content.maxTotalDataSizeMB ?? null,
      is_internal: content.isInternal ?? null,
      home_path: content.homePath_expanded ?? null,
      cold_path: content.coldPath_expanded ?? null,
      raw_content: content,
    }))
  );
}

function normalizeSearchResults(payload) {
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  return rows.map((row) => {
    const out = {};
    fields.forEach((field, index) => {
      out[field] = Array.isArray(row) ? row[index] ?? null : null;
    });
    return out;
  });
}

async function splunkCurlJson(req, res, endpoint, errorCode) {
  const config = getSplunkProxyConfig(req);
  if (config.error) {
    return res.status(400).json({ error: config.error });
  }

  const { splunkHost, splunkToken } = config;
  const result = await runCurl(
    [
      "-k",
      "-sS",
      "-H",
      `Authorization: Bearer ${splunkToken}`,
      `${splunkHost}${endpoint}`,
    ],
    DEFAULT_TIMEOUT_MS
  );

  if (!result.ok) {
    return res.status(502).json({ error: errorCode, detail: result.stderr });
  }

  return parseJsonOrFail(result, res, `${errorCode}_invalid_json`);
}

app.get("/health", async (_req, res) => {
  const result = await runCoral(["--version"], 5000);
  res.json({ ok: result.ok, version: result.stdout?.trim() });
});

app.post("/sql", authenticate, async (req, res) => {
  const { sql } = req.body ?? {};
  if (typeof sql !== "string" || sql.length === 0) {
    return res.status(400).json({ error: "sql is required" });
  }
  if (sql.length > MAX_SQL_LEN) {
    return res.status(400).json({ error: "sql too long" });
  }
  const result = await runCoral(["sql", "--format", "json", sql]);
  if (!result.ok) {
    return res.status(422).json({ error: "coral_query_failed", detail: result.stderr });
  }
  try {
    const rows = JSON.parse(result.stdout || "[]");
    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: "invalid_coral_output", detail: e.message });
  }
});

app.get("/list-catalog", authenticate, async (_req, res) => {
  const result = await runCoral([
    "sql",
    "--format",
    "json",
    `SELECT schema_name,
            table_name,
            description,
            required_filters,
            guide,
            relation_type
     FROM (
       SELECT schema_name,
              table_name,
              description,
              required_filters,
              guide,
              'table' AS relation_type
       FROM coral.tables
       UNION ALL
       SELECT tf.schema_name,
              tf.function_name AS table_name,
              tf.description,
              COALESCE(string_agg(CASE WHEN f.is_required THEN f.filter_name END, ', ' ORDER BY f.filter_name), '') AS required_filters,
              CASE
                WHEN tf.kind = 'search' THEN 'Call as a table function: schema.function(arg => ''value'').'
                ELSE 'Call as a table function with named arguments.'
              END AS guide,
              'table_function' AS relation_type
       FROM coral.table_functions tf
       LEFT JOIN coral.filters f
         ON f.schema_name = tf.schema_name
        AND f.table_name = tf.function_name
       GROUP BY tf.schema_name, tf.function_name, tf.description, tf.kind
     ) catalog
     ORDER BY schema_name, table_name`,
  ]);
  if (!result.ok) {
    return res.status(422).json({ error: "catalog_failed", detail: result.stderr });
  }
  res.json({ tables: JSON.parse(result.stdout || "[]") });
});

app.get("/list-columns", authenticate, async (req, res) => {
  const { schema, table } = req.query;
  if (!schema || !table) return res.status(400).json({ error: "schema and table required" });
  const result = await runCoral([
    "sql",
    "--format",
    "json",
    `SELECT column_name, data_type, is_nullable, is_required_filter, description
     FROM (
       SELECT column_name,
              data_type,
              is_nullable,
              is_required_filter,
              description,
              ordinal_position
       FROM coral.columns
       WHERE schema_name = '${String(schema).replace(/'/g, "''")}'
         AND table_name = '${String(table).replace(/'/g, "''")}'
       UNION ALL
       SELECT filter_name AS column_name,
              data_type,
              true AS is_nullable,
              is_required AS is_required_filter,
              description,
              1000000 AS ordinal_position
       FROM coral.filters
       WHERE schema_name = '${String(schema).replace(/'/g, "''")}'
         AND table_name = '${String(table).replace(/'/g, "''")}'
     ) relation_fields
     ORDER BY ordinal_position, column_name`,
  ]);
  if (!result.ok) {
    return res.status(422).json({ error: "columns_failed", detail: result.stderr });
  }
  res.json({ columns: JSON.parse(result.stdout || "[]") });
});

app.get("/debug/volume", authenticate, async (_req, res) => {
  try {
    if (!fs.existsSync(CORAL_CONFIG_DIR)) {
      return res.status(404).json({ error: "Volume directory does not exist" });
    }
    const files = fs.readdirSync(CORAL_CONFIG_DIR);
    res.json({ volumePath: CORAL_CONFIG_DIR, files });
  } catch (err) {
    res.status(500).json({ error: "Failed to read volume", detail: err.message });
  }
});

app.get("/splunk-proxy/indexes", requireLoopback, async (req, res) => {
  const payload = await splunkCurlJson(
    req,
    res,
    "/services/data/indexes?output_mode=json&count=100",
    "splunk_indexes_failed"
  );
  if (!payload) return;
  res.json({ rows: normalizeIndexes(payload) });
});

app.get("/splunk-proxy/saved-searches", requireLoopback, async (req, res) => {
  const payload = await splunkCurlJson(
    req,
    res,
    "/services/saved/searches?output_mode=json&count=100",
    "splunk_saved_searches_failed"
  );
  if (!payload) return;
  res.json({ rows: normalizeSavedSearches(payload) });
});

app.get("/splunk-proxy/fired-alerts", requireLoopback, async (req, res) => {
  const payload = await splunkCurlJson(
    req,
    res,
    "/services/alerts/fired_alerts?output_mode=json&count=100",
    "splunk_fired_alerts_failed"
  );
  if (!payload) return;
  res.json({ rows: normalizeFiredAlerts(payload) });
});

app.get("/splunk-proxy/search-results", requireLoopback, async (req, res) => {
  const config = getSplunkProxyConfig(req);
  if (config.error) {
    return res.status(400).json({ error: config.error });
  }

  const search = String(req.query.search || "").trim();
  if (!search) {
    return res.status(400).json({ error: "search is required" });
  }

  const { splunkHost, splunkToken } = config;
  const result = await runCurl(
    [
      "-k",
      "-sS",
      "-H",
      `Authorization: Bearer ${splunkToken}`,
      "-X",
      "POST",
      `${splunkHost}/services/search/jobs/export`,
      "-d",
      "output_mode=json_rows",
      "-d",
      `search=${search}`,
    ],
    DEFAULT_TIMEOUT_MS
  );

  if (!result.ok) {
    return res.status(502).json({ error: "splunk_search_results_failed", detail: result.stderr });
  }

  const payload = parseJsonOrFail(result, res, "splunk_search_results_invalid_json");
  if (!payload) return;
  res.json({ rows: normalizeSearchResults(payload) });
});

// Ensure the volume directory and config file exist before starting the server.
try {
  if (!fs.existsSync(CORAL_CONFIG_DIR)) {
    fs.mkdirSync(CORAL_CONFIG_DIR, { recursive: true });
    console.log(`Created volume directory at ${CORAL_CONFIG_DIR}`);
  }

  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = { initializedAt: new Date().toISOString(), version: "1.0.0" };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    console.log(`Initialized default config template at ${CONFIG_PATH}`);
  }
} catch (error) {
  console.error("Failed to initialize volume paths:", error);
}

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Coral sidecar listening on ${PORT}`));
