import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { TestCasesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
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

  const allTests = await db
    .select()
    .from(TestCasesTable)
    .where(eq(TestCasesTable.repoId, String(repoId)));

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
SELECT html_url, message, committed_at
FROM github.commits
WHERE owner = ${quote(String(repoOwner))}
AND repo = ${quote(String(repoName))}
AND committed_at >= ${quote(since)}
ORDER BY committed_at DESC
LIMIT 50
`.trim();

  const commits = await tracedSql(commitSql, {
    runId,
    source: "github.commits",
    agentRole: "smart_run",
    timeoutMs: 15000,
  });

  if (commits.length > 0) {
    coralUsed = true;
    const filePathRegex = /([a-zA-Z0-9_./-]+\.(tsx?|jsx?|py|rb|go|rs|java|css|scss|html))/g;
    for (const commit of commits) {
      const message = String(commit.message ?? "");
      const matches = message.match(filePathRegex) || [];
      for (const match of matches) {
        recentFiles.add(match);
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

  const tests: PrioritizedTest[] = prioritized.map((item) => ({
    id: item.testCase.id,
    title: item.testCase.title,
    score: item.score,
    reason:
      item.overlap.length > 0
        ? `Targets recently changed files: ${item.overlap.slice(0, 2).join(", ")}`
        : "Recently failed test",
  }));

  return NextResponse.json({
    tests,
    rationale: coralUsed
      ? `Coral identified ${recentFiles.size} likely file signals from recent commits in the last ${withinDays} days.`
      : "Coral did not return recent commit signals; prioritized recently failed tests.",
    coral_used: coralUsed,
  });
}
