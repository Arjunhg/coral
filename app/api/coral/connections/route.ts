import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { coralConnections } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

const CORAL_SIDECAR_URL = process.env.CORAL_SIDECAR_URL;
const CORAL_SIDECAR_SECRET = process.env.CORAL_SIDECAR_SECRET;

type SidecarConnection = {
  source_name: string;
  scope: "personal" | "inherited" | string;
  active_via: "tenant" | "shared" | null;
  status: string;
  last_verified_at: string | null;
};

function ensureSidecarConfigured() {
  if (!CORAL_SIDECAR_URL || !CORAL_SIDECAR_SECRET) {
    throw new Error("coral_sidecar_not_configured");
  }
}

async function sidecarConnectionsFetch(
  path: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  ensureSidecarConfigured();

  const res = await fetch(`${CORAL_SIDECAR_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Sidecar-Secret": CORAL_SIDECAR_SECRET!,
      ...(init?.headers || {}),
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(body?.detail || body?.error || `sidecar_${res.status}`));
  }

  return body;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const [sidecarBody, dbRows] = await Promise.all([
      sidecarConnectionsFetch(`/connections?tenant_id=${encodeURIComponent(userId)}`),
      db
        .select()
        .from(coralConnections)
        .where(eq(coralConnections.userId, userId))
        .orderBy(desc(coralConnections.updatedAt)),
    ]);

    const dbBySource = new Map(dbRows.map((row) => [row.sourceName, row]));
    const sidecarConnections = Array.isArray(sidecarBody.connections)
      ? (sidecarBody.connections as SidecarConnection[])
      : [];

    const merged = sidecarConnections.map((connection) => {
      const persisted = dbBySource.get(connection.source_name);
      return {
        source_name: connection.source_name,
        scope: connection.scope,
        active_via: connection.active_via,
        status: persisted?.status ?? connection.status,
        last_verified_at:
          persisted?.lastVerifiedAt?.toISOString() ?? connection.last_verified_at ?? null,
      };
    });

    return NextResponse.json({ connections: merged });
  } catch (error) {
    return NextResponse.json(
      {
        error: "connections_fetch_failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const source = typeof body?.source === "string" ? body.source.trim() : "";
  const vars =
    body?.vars && typeof body.vars === "object" && !Array.isArray(body.vars) ? body.vars : null;

  if (!source || !vars) {
    return NextResponse.json(
      { error: "source and vars are required" },
      { status: 400 }
    );
  }

  try {
    const sidecarBody = await sidecarConnectionsFetch("/provision", {
      method: "POST",
      body: JSON.stringify({
        tenant_id: userId,
        source,
        vars,
      }),
    });

    const verifiedAt = sidecarBody.last_verified_at
      ? new Date(String(sidecarBody.last_verified_at))
      : new Date();

    await db
      .insert(coralConnections)
      .values({
        userId,
        sourceName: source,
        status: "connected",
        lastVerifiedAt: verifiedAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [coralConnections.userId, coralConnections.sourceName],
        set: {
          status: "connected",
          lastVerifiedAt: verifiedAt,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      ok: true,
      source,
      status: "connected",
      last_verified_at: verifiedAt.toISOString(),
      configured_sources: sidecarBody.configured_sources ?? [],
    });
  } catch (error) {
    await db
      .insert(coralConnections)
      .values({
        userId,
        sourceName: source || "unknown",
        status: "failed",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [coralConnections.userId, coralConnections.sourceName],
        set: {
          status: "failed",
          updatedAt: new Date(),
        },
      });

    return NextResponse.json(
      {
        error: "provision_failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
