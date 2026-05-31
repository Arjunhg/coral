import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { TestCasesTable, apiKeys, repositories } from "@/db/schema";
import { and, desc, eq, isNull, sql as drizzleSql } from "drizzle-orm";
import crypto from "node:crypto";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

async function authenticate(req: NextRequest): Promise<number | null> {
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const fullKey = match?.[1]?.trim();
  if (!fullKey) return null;

  const hash = crypto.createHash("sha256").update(fullKey).digest("hex");

  const [keyRow] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)));

  if (!keyRow) return null;

  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, keyRow.id));

  return keyRow.userId;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  const localUserId = await authenticate(req);
  if (!localUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { resource } = await params;
  const url = req.nextUrl;
  const page = Math.max(0, Number(url.searchParams.get("page") || 0));
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(url.searchParams.get("page_size") || PAGE_SIZE_DEFAULT))
  );

  if (resource === "test_cases") {
    const statusFilter = url.searchParams.get("status");
    const typeFilter = url.searchParams.get("type");
    const repoNameFilter = url.searchParams.get("repo_name");

    const conditions = [eq(TestCasesTable.userId, String(localUserId))];
    if (statusFilter) conditions.push(eq(TestCasesTable.status, statusFilter));
    if (typeFilter) conditions.push(eq(TestCasesTable.type, typeFilter));
    if (repoNameFilter) conditions.push(eq(TestCasesTable.repoName, repoNameFilter));

    const rows = await db
      .select({
        id: TestCasesTable.id,
        title: TestCasesTable.title,
        description: TestCasesTable.description,
        type: TestCasesTable.type,
        priority: TestCasesTable.priority,
        status: TestCasesTable.status,
        repo_owner: TestCasesTable.repoOwner,
        repo_name: TestCasesTable.repoName,
        branch: TestCasesTable.branch,
        target_route: TestCasesTable.targetRoute,
        target_files: TestCasesTable.targetFiles,
        expected_result: TestCasesTable.expectedResult,
        session_id: TestCasesTable.sessionId,
        session_url: TestCasesTable.sessionUrl,
        has_vision_analysis: drizzleSql<boolean>`${TestCasesTable.visionAnalysis} IS NOT NULL`,
        created_at: TestCasesTable.createdAt,
      })
      .from(TestCasesTable)
      .where(and(...conditions))
      .orderBy(desc(TestCasesTable.createdAt))
      .limit(pageSize)
      .offset(page * pageSize);

    return NextResponse.json({
      rows,
      page,
      page_size: pageSize,
      has_more: rows.length === pageSize,
    });
  }

  if (resource === "repositories") {
    const rows = await db
      .select({
        repo_id: repositories.repoId,
        name: repositories.name,
        full_name: repositories.fullName,
        owner: repositories.owner,
        language: repositories.language,
        default_branch: repositories.defaultBranch,
        target_domain: repositories.targetDomain,
      })
      .from(repositories)
      .where(eq(repositories.userId, localUserId))
      .limit(pageSize)
      .offset(page * pageSize);

    return NextResponse.json({
      rows,
      page,
      page_size: pageSize,
      has_more: rows.length === pageSize,
    });
  }

  return NextResponse.json({ error: "unknown_resource" }, { status: 404 });
}
