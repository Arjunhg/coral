import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import crypto from "node:crypto";
import { pendoTrackServer } from "@/lib/pendo/track";

function generateApiKey(): { full: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const full = `sk_${raw}`;
  const prefix = full.slice(0, 12);
  const hash = crypto.createHash("sha256").update(full).digest("hex");
  return { full, prefix, hash };
}

async function resolveLocalUserId(): Promise<number | null> {
  const cu = await currentUser();
  const email = cu?.primaryEmailAddress?.emailAddress;
  if (!email) return null;

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return user?.id ?? null;
}

export async function POST(_req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const localUserId = await resolveLocalUserId();
  if (!localUserId) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  const { full, prefix, hash } = generateApiKey();
  await db.insert(apiKeys).values({
    userId: localUserId,
    keyHash: hash,
    keyPrefix: prefix,
    label: "coral-source",
  });

  await pendoTrackServer("api_key_generated", {
    key_prefix: prefix,
    label: "coral-source",
  }, userId);

  return NextResponse.json({
    key: full,
    prefix,
    note: "Copy this key now. It will not be shown again.",
  });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const localUserId = await resolveLocalUserId();
  if (!localUserId) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  const keys = await db
    .select({
      id: apiKeys.id,
      prefix: apiKeys.keyPrefix,
      label: apiKeys.label,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, localUserId), isNull(apiKeys.revokedAt)));

  return NextResponse.json({ keys });
}
