import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/db";
import { TestCasesTable, users } from "@/db/schema";
import { and, eq, or } from "drizzle-orm";
import { quote } from "@/lib/coral/client";
import { tracedSql } from "@/lib/coral/traced-client";
import { newRunId } from "@/lib/coral/trace-logger";

type PrioritizedTest = {
  id: number;
  title: string;
  score: number;
  reason: string;
};

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { repoId, repoOwner, repoName, withinDays = 7 } = await req.json();
  if (!repoId || !repoOwner || !repoName) {
    return NextResponse.json(
      { error: "repoId, repoOwner, repoName required" },
      { status: 400 }
    );
  }

  const cu = await currentUser();
  const email = cu?.primaryEmailAddress?.emailAddress;
  let localUserId: number | null = null;
  if (email) {
    const [localUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    localUserId = localUser?.id ?? null;
  }

  const userFilters = [eq(TestCasesTable.userId, userId)];
  if (localUserId !== null) {
    userFilters.push(eq(TestCasesTable.userId, String(localUserId)));
  }

  const allTests = await db
    .select()
    .from(TestCasesTable)
    .where(and(eq(TestCasesTable.repoId, String(repoId)), or(...userFilters)));

  if (allTests.length === 0) {
    return NextResponse.json({ tests: [], rationale: "No test cases for this repo." });
  }

  const runId = newRunId();
  const recentFiles = new Set<string>();
  let coralUsed = false;

  const since = new Date(
    Date.now() - Number(withinDays) * 24 * 60 * 60 * 1000
  ).toISOString();

  const commitSql = `
SELECT
  html_url,
  commit__message AS message,
  COALESCE(commit__author__date, commit__committer__date) AS committed_at,
  files
FROM github.commits
WHERE owner = ${quote(String(repoOwner))}
AND repo = ${quote(String(repoName))}
AND COALESCE(commit__author__date, commit__committer__date) >= ${quote(since)}
ORDER BY COALESCE(commit__author__date, commit__committer__date) DESC
LIMIT 50
`.trim();

  const commits = await tracedSql(commitSql, {
    runId,
    source: "github.commits",
    agentRole: "smart_run",
    timeoutMs: 15000,
  });
  const hadCommits = commits.length > 0;

  if (hadCommits) {
    coralUsed = true;
    const filePathRegex = /([a-zA-Z0-9_./-]+\.(tsx?|jsx?|py|rb|go|rs|java|css|scss|html|md|json))/g;

    const pushFile = (value: string) => {
      if (value) {
        recentFiles.add(value);
      }
    };

    const pushFromUnknown = (value: unknown) => {
      if (!value) return;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return;
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
          try {
            const parsed = JSON.parse(trimmed);
            pushFromUnknown(parsed);
            return;
          } catch {
            // Fall through to regex scan
          }
        }

        const matches = trimmed.match(filePathRegex) || [];
        for (const match of matches) {
          pushFile(match);
        }
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") {
            pushFile(item);
          } else if (item && typeof item === "object") {
            const filename = (item as { filename?: string }).filename;
            const path = (item as { path?: string }).path;
            if (typeof filename === "string") pushFile(filename);
            if (typeof path === "string") pushFile(path);
          }
        }
        return;
      }

      if (typeof value === "object") {
        const filename = (value as { filename?: string }).filename;
        const path = (value as { path?: string }).path;
        if (typeof filename === "string") pushFile(filename);
        if (typeof path === "string") pushFile(path);
      }
    };

    for (const commit of commits) {
      pushFromUnknown(commit.files);
      pushFromUnknown(commit.message);
    }
  }

  if (hadCommits && recentFiles.size === 0) {
    const candidateFiles = new Set<string>();
    for (const testCase of allTests) {
      const files = (testCase.targetFiles as string[]) || [];
      for (const file of files) {
        if (typeof file === "string" && file.trim()) {
          candidateFiles.add(file.trim());
        }
      }
    }

    const fileList = [...candidateFiles].slice(0, 25);
    for (const file of fileList) {
      const fileSql = `
SELECT sha
FROM github.commits
WHERE owner = ${quote(String(repoOwner))}
AND repo = ${quote(String(repoName))}
AND path = ${quote(file)}
AND COALESCE(commit__author__date, commit__committer__date) >= ${quote(since)}
LIMIT 1
      `.trim();

      const hits = await tracedSql(fileSql, {
        runId,
        source: "github.commits.path",
        agentRole: "smart_run",
        timeoutMs: 10000,
      });

      if (hits.length > 0) {
        recentFiles.add(file);
      }
    }
  }

  const scored = allTests.map((testCase) => {
    const files = (testCase.targetFiles as string[]) || [];
    const overlap = files.filter((file) =>
      [...recentFiles].some(
        (recentFile) => file.includes(recentFile) || recentFile.includes(file)
      )
    );

    const wasRecentlyFailed = testCase.status === "failed";
    let score = 0;
    if (overlap.length > 0) score += 10 + overlap.length;
    if (wasRecentlyFailed) score += 5;

    return { testCase, score, overlap };
  });

  let prioritized = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  if (prioritized.length === 0) {
    prioritized = scored
      .filter((item) => item.testCase.status === "failed")
      .sort((a, b) => b.testCase.id - a.testCase.id)
      .slice(0, 10)
      .map((item) => ({ ...item, score: 5 }));
  }

  if (prioritized.length === 0) {
    prioritized = scored
      .sort((a, b) => {
        const aTime = a.testCase.createdAt
          ? new Date(a.testCase.createdAt).getTime()
          : 0;
        const bTime = b.testCase.createdAt
          ? new Date(b.testCase.createdAt).getTime()
          : 0;
        if (bTime !== aTime) return bTime - aTime;
        return b.testCase.id - a.testCase.id;
      })
      .slice(0, 10)
      .map((item) => ({ ...item, score: 2 }));
  }

  const tests: PrioritizedTest[] = prioritized.map((item) => ({
    id: item.testCase.id,
    title: item.testCase.title,
    score: item.score,
    reason:
      item.overlap.length > 0
        ? `Targets recently changed files: ${item.overlap.slice(0, 2).join(", ")}`
        : item.testCase.status === "failed"
        ? "Recently failed test"
        : "Recent test case (no file-level signals)",
  }));

  return NextResponse.json({
    tests,
    rationale: coralUsed
      ? recentFiles.size > 0
        ? `Coral identified ${recentFiles.size} likely file signals from recent commits in the last ${withinDays} days.`
        : `Coral found recent commits but no file-level signals in the last ${withinDays} days; prioritized recent/failed tests instead.`
      : "Coral did not return recent commit signals; prioritized recently failed tests.",
    coral_used: coralUsed,
  });
}
