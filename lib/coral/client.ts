const CORAL_SIDECAR_URL = process.env.CORAL_SIDECAR_URL;
const CORAL_SIDECAR_SECRET = process.env.CORAL_SIDECAR_SECRET;

const DEFAULT_TIMEOUT_MS = 12000;

export type CoralRow = Record<string, unknown>;

export type CoralTableSummary = {
  schema_name: string;
  table_name: string;
  description: string;
  required_filters: string;
  guide: string;
};

export type CoralColumn = {
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  is_required_filter: boolean;
  description: string;
};

export class CoralError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function ensureConfigured() {
  if (!CORAL_SIDECAR_URL || !CORAL_SIDECAR_SECRET) {
    throw new CoralError("coral_sidecar_not_configured", 500);
  }
}

async function sidecarFetch(
  path: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  ensureConfigured();
  const sidecarSecret = CORAL_SIDECAR_SECRET!;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${CORAL_SIDECAR_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Sidecar-Secret": sidecarSecret,
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new CoralError(
        body?.error || `coral_sidecar_${res.status}`,
        res.status,
        body?.detail
      );
    }
    return body;
  } catch (err: unknown) {
    if (err instanceof CoralError) {
      throw err;
    }

    if (err instanceof Error && err.name === "AbortError") {
      throw new CoralError("coral_timeout", 504, `Exceeded ${timeoutMs}ms`);
    }

    throw new CoralError(
      "coral_unreachable",
      502,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const coral = {
  async sql(sql: string, opts?: { timeoutMs?: number }): Promise<CoralRow[]> {
    const body = await sidecarFetch(
      "/sql",
      {
        method: "POST",
        body: JSON.stringify({ sql }),
      },
      opts?.timeoutMs
    );
    console.log("[coral] sql response:", body);

    return Array.isArray(body?.rows) ? body.rows : [];
  },

  async sqlOrEmpty(sql: string, opts?: { timeoutMs?: number }): Promise<CoralRow[]> {
    try {
      return await this.sql(sql, opts);
    } catch (err) {
      console.warn("[coral] query failed, returning []:", (err as Error).message);
      return [];
    }
  },

  async listCatalog(): Promise<CoralTableSummary[]> {
    const body = await sidecarFetch("/list-catalog", { method: "GET" });
    return Array.isArray(body?.tables) ? body.tables : [];
  },

  async listColumns(schema: string, table: string): Promise<CoralColumn[]> {
    const body = await sidecarFetch(
      `/list-columns?schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`,
      { method: "GET" }
    );

    return Array.isArray(body?.columns) ? body.columns : [];
  },

  async isAvailable(): Promise<boolean> {
    try {
      await sidecarFetch("/list-catalog", { method: "GET" }, 4000);
      return true;
    } catch {
      return false;
    }
  },
};

export function quote(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}
