import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { coral, CoralError } from "@/lib/coral/client";

const MAX_SQL_LEN = 4000;
const DENY_PATTERNS = [
  /\binsert\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bdrop\b/i,
  /\btruncate\b/i,
  /\balter\b/i,
  /\bcreate\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
];

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: { sql?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sql = (payload.sql || "").trim();

  if (!sql) {
    return NextResponse.json({ error: "sql is required" }, { status: 400 });
  }

  if (sql.length > MAX_SQL_LEN) {
    return NextResponse.json({ error: "sql_too_long" }, { status: 400 });
  }

  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(sql)) {
      return NextResponse.json(
        {
          error: "read_only_violation",
          detail: "Only SELECT queries are allowed",
        },
        { status: 400 }
      );
    }
  }

  try {
    const t0 = performance.now();
    const rows = await coral.sql(sql, { timeoutMs: 15000 });
    const ms = Math.round(performance.now() - t0);

    return NextResponse.json({ rows, count: rows.length, duration_ms: ms });
  } catch (err: unknown) {
    if (err instanceof CoralError) {
      return NextResponse.json(
        { error: err.message, detail: err.detail },
        { status: err.status === 504 ? 504 : 422 }
      );
    }

    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function GET() {
  const available = await coral.isAvailable();
  return NextResponse.json({ coral_available: available });
}
