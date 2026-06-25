import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenAI } from "@google/genai";
import { analyzeScreenshot } from "@/lib/inference/analyzeScreenshot";
import { db } from "@/db";
import { TestCasesTable, repositories, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { Browserbase } from "@browserbasehq/sdk";
import { chromium, Page } from "playwright-core";
import { coral, quote, withCoralTenant } from "@/lib/coral/client";
import { tracedSql } from "@/lib/coral/traced-client";
import { newRunId } from "@/lib/coral/trace-logger";
import { pendoTrackServer } from "@/lib/pendo/track";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!,
});

const bb = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY!,
});

async function capturePageScreenshot(page: {
    screenshot: (options?: {
        type?: "jpeg" | "png";
        quality?: number;
        fullPage?: boolean;
    }) => Promise<Buffer>;
}): Promise<string | null> {
    try {
        const buffer = await page.screenshot({
            type: "jpeg",
            quality: 72,
            fullPage: false,
        });
        return `data:image/jpeg;base64,${buffer.toString("base64")}`;
    } catch {
        return null;
    }
}

async function readGithubFile({
    owner,
    repo,
    path,
    branch,
    githubToken,
}: {
    owner: string;
    repo: string;
    path: string;
    branch: string;
    githubToken: string;
}) {
    const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
        {
            headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: "application/vnd.github+json",
            },
        }
    );

    if (!res.ok) {
        return null;
    }

    const data = await res.json();

    if (!data.content) {
        return null;
    }

    const decodedContent = Buffer.from(data.content, "base64").toString("utf-8");

    return {
        path,
        content: decodedContent.slice(0, 5000),
    };
}

type FailureContextItem = {
    kind: "issue" | "commit" | "sentry" | "linear" | "splunk";
    source: string;
    title: string;
    url: string | null;
    timestamp: string | null;
    metadata?: Record<string, unknown>;
};

type FailureContext = {
    items: FailureContextItem[];
    queries_run: { source: string; sql: string; rows: number; ms: number }[];
    coral_available: boolean;
};

const columnCache = new Map<string, Set<string>>();

async function getColumnSet(schema: string, table: string): Promise<Set<string>> {
    const key = `${schema}.${table}`;
    const cached = columnCache.get(key);
    if (cached) return cached;

    try {
        const columns = await coral.listColumns(schema, table);
        const set = new Set(columns.map((col) => col.column_name));
        columnCache.set(key, set);
        return set;
    } catch {
        return new Set();
    }
}

function resolveColumn(columns: Set<string>, candidates: string[]): string | null {
    for (const candidate of candidates) {
        if (columns.has(candidate)) return candidate;
    }
    return null;
}

function selectOrNull(column: string | null, alias: string): string {
    return column ? `${column} AS ${alias}` : `NULL AS ${alias}`;
}

function quoteSplunkPhrase(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildRepoFilters(columns: Set<string>, owner: string, repo: string) {
    const ownerCol = resolveColumn(columns, [
        "owner",
        "repo_owner",
        "repository_owner",
        "org",
        "organization",
    ]);
    const repoCol = resolveColumn(columns, ["repo", "repository", "repository_name"]);
    const filters: string[] = [];
    if (ownerCol) filters.push(`${ownerCol} = ${quote(owner)}`);
    if (repoCol) filters.push(`${repoCol} = ${quote(repo)}`);
    return { filters, ownerCol, repoCol };
}

async function fetchFailureContext(testCase: {
    id: number;
    repoOwner: string;
    repoName: string;
    targetRoute?: string | null;
    targetFiles?: string[] | null;
    title: string;
    description: string;
}, runId: string): Promise<FailureContext> {
    const ctx: FailureContext = { items: [], queries_run: [], coral_available: false };

    // 1. Get catalog to see which sources the user has configured
    let availableSchemas: Set<string>;
    try {
        const catalog = await coral.listCatalog();
        availableSchemas = new Set(catalog.map((table) => table.schema_name));
        ctx.coral_available = true;
    } catch {
        return ctx;
    }

    const githubIssuesCols = availableSchemas.has("github")
        ? await getColumnSet("github", "issues")
        : new Set<string>();
    const githubCommitsCols = availableSchemas.has("github")
        ? await getColumnSet("github", "commits")
        : new Set<string>();
    const linearIssuesCols = availableSchemas.has("linear")
        ? await getColumnSet("linear", "issues")
        : new Set<string>();

    const owner = testCase.repoOwner;
    const repo = testCase.repoName;
    const route = testCase.targetRoute || "";
    const routeKeyword = route.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
    const titleKeyword = testCase.title.split(" ").slice(0, 3).join(" ").trim();
    const signal = routeKeyword || titleKeyword || "error";

    // 2. GitHub issues — recent issues touching the route/title
    if (availableSchemas.has("github")) {
        const titleCol = resolveColumn(githubIssuesCols, ["title"]);
        const bodyCol = resolveColumn(githubIssuesCols, ["body", "body_text", "description"]);
        const stateCol = resolveColumn(githubIssuesCols, ["state", "state_name", "state_type"]);
        const createdCol = resolveColumn(githubIssuesCols, ["created_at", "updated_at"]);
        const urlCol = resolveColumn(githubIssuesCols, ["html_url", "url"]);
        const repoFilters = buildRepoFilters(githubIssuesCols, owner, repo).filters;

        const issueFilters: string[] = [...repoFilters];
        if (stateCol) {
            issueFilters.push(`LOWER(${stateCol}) = 'open'`);
        }

        const signalFilters: string[] = [];
        if (titleCol) signalFilters.push(`${titleCol} ILIKE ${quote(`%${signal}%`)}`);
        if (bodyCol) signalFilters.push(`${bodyCol} ILIKE ${quote(`%${signal}%`)}`);
        if (signalFilters.length > 0) {
            issueFilters.push(`(${signalFilters.join(" OR ")})`);
        }

        const issueWhere = issueFilters.length > 0 ? `WHERE ${issueFilters.join(" AND ")}` : "";
        const issueOrderBy = createdCol || titleCol;
        const issueSql = `
            SELECT 'github' AS source,
                ${selectOrNull(titleCol, "title")},
                ${selectOrNull(urlCol, "html_url")},
                ${selectOrNull(stateCol, "state")},
                ${selectOrNull(createdCol, "created_at")}
            FROM github.issues
            ${issueWhere}
            ${issueOrderBy ? `ORDER BY ${issueOrderBy} DESC` : ""}
            LIMIT 5
        `.trim();

        const issueT0 = performance.now();
        const issues = await tracedSql(issueSql, {
            testCaseId: testCase.id,
            runId,
            source: "github.issues",
            agentRole: "failure_enricher",
        });
        ctx.queries_run.push({
            source: "github.issues",
            sql: issueSql,
            rows: issues.length,
            ms: Math.round(performance.now() - issueT0),
        });

        for (const issue of issues) {
            ctx.items.push({
                kind: "issue",
                source: "github",
                title: String(issue.title ?? ""),
                url: issue.html_url ? String(issue.html_url) : null,
                timestamp: issue.created_at ? String(issue.created_at) : null,
                metadata: { state: issue.state },
            });
        }

        // 3. GitHub commits — recent commits touching the test's target files
        const files = Array.isArray(testCase.targetFiles) ? testCase.targetFiles : [];
        if (files.length > 0) {
            const { filters, ownerCol, repoCol } = buildRepoFilters(
                githubCommitsCols,
                owner,
                repo
            );
            if (ownerCol && repoCol) {
                const messageCol = resolveColumn(githubCommitsCols, [
                    "message",
                    "commit_message",
                ]);
                const commitUrlCol = resolveColumn(githubCommitsCols, ["html_url", "url"]);
                const committedCol = resolveColumn(githubCommitsCols, [
                    "committed_at",
                    "commit_date",
                ]);
                const authorCol = resolveColumn(githubCommitsCols, [
                    "author_login",
                    "author",
                ]);

                const commitSql = `
                    SELECT 'github' AS source,
                        ${selectOrNull(messageCol, "message")},
                        ${selectOrNull(commitUrlCol, "html_url")},
                        ${selectOrNull(committedCol, "committed_at")},
                        ${selectOrNull(authorCol, "author_login")}
                    FROM github.commits
                    WHERE ${filters.join(" AND ")}
                    ${committedCol ? `ORDER BY ${committedCol} DESC` : ""}
                    LIMIT 10
                `.trim();

                const commitT0 = performance.now();
                const commits = await tracedSql(commitSql, {
                    testCaseId: testCase.id,
                    runId,
                    source: "github.commits",
                    agentRole: "failure_enricher",
                });
                ctx.queries_run.push({
                    source: "github.commits",
                    sql: commitSql,
                    rows: commits.length,
                    ms: Math.round(performance.now() - commitT0),
                });

                // Heuristic filter on the client side since not all Coral GitHub specs
                // expose `files_changed`. Pick most recent 3.
                for (const commit of commits.slice(0, 3)) {
                    const url = commit.html_url ? String(commit.html_url) : null;
                    let title = String(commit.message ?? "").split("\n")[0].slice(0, 100);
                    if (!title) {
                        const sha = url?.split("/commit/")[1]?.slice(0, 7);
                        title = sha ? `Commit ${sha}` : "Recent commit";
                    }

                    let authorLogin: string | null = null;
                    let authorUrl: string | null = null;
                    const authorRaw = commit.author_login;
                    if (typeof authorRaw === "string") {
                        try {
                            const parsed = JSON.parse(authorRaw);
                            if (parsed && typeof parsed === "object") {
                                authorLogin = typeof parsed.login === "string" ? parsed.login : null;
                                authorUrl = typeof parsed.html_url === "string" ? parsed.html_url : null;
                            }
                        } catch {
                            authorLogin = authorRaw;
                        }
                    } else if (authorRaw) {
                        authorLogin = String(authorRaw);
                    }

                    ctx.items.push({
                        kind: "commit",
                        source: "github",
                        title,
                        url,
                        timestamp: commit.committed_at ? String(commit.committed_at) : null,
                        metadata: {
                            author: authorLogin,
                            author_url: authorUrl,
                        },
                    });
                }
            }
        }
    }

    // 4. Sentry — recent errors on this route
    if (availableSchemas.has("sentry") && routeKeyword) {
        const sentrySql = `
            SELECT 'sentry' AS source, title, permalink, last_seen, count
            FROM sentry.issues
            WHERE message ILIKE ${quote(`%${routeKeyword}%`)}
            OR title ILIKE ${quote(`%${routeKeyword}%`)}
            ORDER BY last_seen DESC
            LIMIT 5
        `.trim();

        const sentryT0 = performance.now();
        const sentryRows = await tracedSql(sentrySql, {
            testCaseId: testCase.id,
            runId,
            source: "sentry.issues",
            agentRole: "failure_enricher",
        });
        ctx.queries_run.push({
            source: "sentry.issues",
            sql: sentrySql,
            rows: sentryRows.length,
            ms: Math.round(performance.now() - sentryT0),
        });

        for (const row of sentryRows) {
            ctx.items.push({
                kind: "sentry",
                source: "sentry",
                title: String(row.title ?? ""),
                url: row.permalink ? String(row.permalink) : null,
                timestamp: row.last_seen ? String(row.last_seen) : null,
                metadata: { count: row.count },
            });
        }
    }

    // 5. Linear — open issues related to the route/title
    if (availableSchemas.has("linear")) {
        const linearSignal = routeKeyword || titleKeyword;
        if (linearSignal) {
            const linearTitleCol = resolveColumn(linearIssuesCols, ["title", "name"]);
            const linearDescCol = resolveColumn(linearIssuesCols, [
                "description",
                "description_text",
            ]);
            const linearStateCol = resolveColumn(linearIssuesCols, [
                "state",
                "state_name",
                "state_type",
            ]);
            const linearUpdatedCol = resolveColumn(linearIssuesCols, [
                "updated_at",
                "created_at",
            ]);
            const linearUrlCol = resolveColumn(linearIssuesCols, ["url", "html_url"]);

            const linearFilters: string[] = [];
            const linearSignalFilters: string[] = [];
            if (linearTitleCol) {
                linearSignalFilters.push(
                    `${linearTitleCol} ILIKE ${quote(`%${linearSignal}%`)}`
                );
            }
            if (linearDescCol) {
                linearSignalFilters.push(
                    `${linearDescCol} ILIKE ${quote(`%${linearSignal}%`)}`
                );
            }
            if (linearSignalFilters.length > 0) {
                linearFilters.push(`(${linearSignalFilters.join(" OR ")})`);
            }
            if (linearStateCol) {
                linearFilters.push(
                    `LOWER(${linearStateCol}) NOT IN ('done', 'cancelled', 'completed')`
                );
            }

            const linearWhere =
                linearFilters.length > 0 ? `WHERE ${linearFilters.join(" AND ")}` : "";
            const linearSql = `
                SELECT 'linear' AS source,
                    ${selectOrNull(linearTitleCol, "title")},
                    ${selectOrNull(linearUrlCol, "url")},
                    ${selectOrNull(linearStateCol, "state")},
                    ${selectOrNull(linearUpdatedCol, "updated_at")}
                FROM linear.issues
                ${linearWhere}
                ${linearUpdatedCol ? `ORDER BY ${linearUpdatedCol} DESC` : ""}
                LIMIT 5
            `.trim();

            const linearT0 = performance.now();
            const linearRows = await tracedSql(linearSql, {
                testCaseId: testCase.id,
                runId,
                source: "linear.issues",
                agentRole: "failure_enricher",
            });
            ctx.queries_run.push({
                source: "linear.issues",
                sql: linearSql,
                rows: linearRows.length,
                ms: Math.round(performance.now() - linearT0),
            });

            for (const row of linearRows) {
                ctx.items.push({
                    kind: "linear",
                    source: "linear",
                    title: String(row.title ?? ""),
                    url: row.url ? String(row.url) : null,
                    timestamp: row.updated_at ? String(row.updated_at) : null,
                    metadata: { state: row.state },
                });
            }
        }
    }

    // 6. Splunk — recent error or failure events around the repo/route signal
    if (availableSchemas.has("splunk")) {
        const splunkTerms = [repo, routeKeyword, titleKeyword]
            .map((term) => term?.trim())
            .filter((term): term is string => Boolean(term))
            .slice(0, 3);
        const signalClause =
            splunkTerms.length > 0
                ? splunkTerms.map((term) => quoteSplunkPhrase(term)).join(" OR ")
                : quoteSplunkPhrase("error");
        const splunkSearch =
            `search index=* (${signalClause}) (error OR exception OR fail OR failed OR fatal) ` +
            `earliest=-60m latest=now | fields _time host source sourcetype _raw index splunk_server | head 5`;
        const splunkSql = `
            SELECT _time, host, source, sourcetype, _raw, index, splunk_server
            FROM splunk.search_results(search => ${quote(splunkSearch)})
            LIMIT 5
        `.trim();

        const splunkT0 = performance.now();
        const splunkRows = await tracedSql(splunkSql, {
            testCaseId: testCase.id,
            runId,
            source: "splunk.search_results",
            agentRole: "failure_enricher",
        });
        ctx.queries_run.push({
            source: "splunk.search_results",
            sql: splunkSql,
            rows: splunkRows.length,
            ms: Math.round(performance.now() - splunkT0),
        });

        for (const row of splunkRows) {
            const rawMessage = String(row._raw ?? "").replace(/\s+/g, " ").trim();
            ctx.items.push({
                kind: "splunk",
                source: "splunk",
                title: rawMessage.slice(0, 220) || "Splunk log event",
                url: null,
                timestamp: row._time ? String(row._time) : null,
                metadata: {
                    host: row.host,
                    index: row.index,
                    source: row.source,
                    sourcetype: row.sourcetype,
                    splunk_server: row.splunk_server,
                },
            });
        }
    }

    return ctx;
}

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    return withCoralTenant(userId, async () => {
    try {
        const body = await req.json();
        const { testCaseId, baseUrl, mode = "generate", customPrompt = "" } = body;
        const runId = newRunId();

        if (!testCaseId || !baseUrl) {
            return NextResponse.json(
                { error: "testCaseId and baseUrl are required" },
                { status: 400 }
            );
        }

        // 1. Fetch test case from DB
        const [testCase] = await db
            .select()
            .from(TestCasesTable)
            .where(eq(TestCasesTable.id, testCaseId));

        if (!testCase) {
            return NextResponse.json({ error: "Test case not found" }, { status: 404 });
        }

        // Fetch user and check credits
        const [user] = await db.select().from(users).where(eq(users.id, Number(testCase.userId)));
        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }
        if (user.credits < 100) {
            return NextResponse.json(
                { error: "Insufficient credits to run test case. Minimum 100 required." },
                { status: 402 }
            );
        }

        // Fetch repository settings for global instructions
        let repoRecord = null;
        if (testCase.repoId) {
            const [r] = await db
                .select()
                .from(repositories)
                .where(eq(repositories.repoId, parseInt(testCase.repoId)));
            repoRecord = r;
        }
        if (!repoRecord) {
            const [r] = await db
                .select()
                .from(repositories)
                .where(eq(repositories.fullName, `${testCase.repoOwner}/${testCase.repoName}`));
            repoRecord = r;
        }

        let scriptText = testCase.browserbaseScript;
        const forceRegenerate = mode === "generate" || !scriptText;
        let creditDeduction = 70; // Default flat rate for execution

        // 2. Generate script using Gemini if forced, or if no script is cached
        if (forceRegenerate) {
            const cookiesStore = await cookies();
            const githubToken = cookiesStore.get("gh_token")?.value;

            if (!githubToken) {
                return NextResponse.json(
                    { error: "GitHub authentication token is missing or expired" },
                    { status: 401 }
                );
            }

            // Fetch target files context
            const targetFiles = testCase.targetFiles || [];
            let repoContext = "";

            if (targetFiles.length > 0) {
                const fileContents = await Promise.all(
                    targetFiles.map((path) =>
                        readGithubFile({
                            owner: testCase.repoOwner,
                            repo: testCase.repoName,
                            branch: testCase.branch || "main",
                            path,
                            githubToken,
                        })
                    )
                );

                const validFiles = fileContents.filter(Boolean);
                repoContext = validFiles
                    .map(
                        (file: any) => `
                            File Path: ${file.path}

                            File Content:
                            ${file.content}
                            `
                    )
                    .join("\n\n----------------------\n\n");
            }

            // Build global instructions and runtime prompts
            const globalIns = repoRecord?.gloablInstruction
                ? `\n[GLOBAL PROJECT INSTRUCTIONS] (Follow strictly):\n${repoRecord.gloablInstruction}\n`
                : "";

            const tempIns = customPrompt
                ? `\n[ADDITIONAL RUNTIME INSTRUCTIONS] (Follow strictly):\n${customPrompt}\n`
                : "";

            // Prompt Gemini for Playwright code string
            const prompt = `
You are an expert QA automation engineer.
Your task is to write a Playwright Node.js script body that executes a test case on an application running at URL: "${baseUrl}".

Test Case Details:
- Title: ${testCase.title}
- Description: ${testCase.description}
- Target Route: ${testCase.targetRoute || "/"}
- Expected Result: ${testCase.expectedResult}
${globalIns}
${tempIns}

Source File Context for Reference (Read this to extract exact tags, component text, input fields, and class names):
${repoContext || "No source file context available for this test case."}

Write only the JavaScript code that executes within an async function context.

The following variables are pre-injected into your runtime environment:
1. 'page': The Playwright Page object.
2. 'console': The custom console object to output log messages.

IMPORTANT:
- Do NOT assume Node.js 'assert' is available.
- Do NOT import assert or any other module.
- At the top of the generated script, always define this custom assert helper:

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

Rules for your code:
1. DO NOT import playwright, browserbase, assert, or any other modules.
2. At the top of the script (after assert), define these helpers and use them:

async function firstVisibleLocator(page, candidates, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const spec of candidates) {
      const loc = typeof spec === 'string' ? page.locator(spec).first() : spec;
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) return loc;
    }
    await page.waitForTimeout(400);
  }
  throw new Error('No visible element matched: ' + candidates.map(c => typeof c === 'string' ? c : '[locator]').join(', '));
}

async function fillFirstVisible(page, candidates, value) {
  const loc = await firstVisibleLocator(page, candidates);
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.fill(value, { timeout: 10000 });
  return loc;
}

async function resilientClick(loc, opts) {
  const timeout = (opts && opts.timeout) || 8000;
  try {
    await loc.click({ timeout });
  } catch (e1) {
    try {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ force: true, timeout: Math.min(timeout, 5000) });
    } catch (e2) {
      await loc.evaluate((n) => n.click());
    }
  }
}

3. Navigate to the target route using:
   \`await page.goto('${baseUrl}${testCase.targetRoute || ""}', { waitUntil: 'domcontentloaded', timeout: 20000 })\`
   then \`await page.waitForTimeout(1500)\`.
4. AUTH / PROTECTED ROUTES: If the target route looks protected (e.g. /dashboard, /settings, /admin, /profile):
   - After navigation, check if you are on a login/sign-in page (URL or visible "Sign in"/"Log in" button).
   - If login is required and no credentials exist in global instructions, log clearly and assert the login UI is visible instead of waiting 30s for dashboard-only fields.
   - Never block on a single \`input[name="..."]\` for 30000ms — use fillFirstVisible with multiple candidates from source context (name, placeholder, label, role).
5. Carefully analyze the Source File Context for EXACT and FALLBACK selectors (placeholder, label, role, text).
6. Apply extreme selector resilience:
   - Prefer getByRole, getByLabel, getByPlaceholder over brittle name= attributes when the repo shows labels.
   - Use fillFirstVisible / firstVisibleLocator instead of raw locator.fill on one selector.
   - Per-selector visibility checks should use short timeouts (under 2s), not 30s defaults.
6b. CLICKS AND FORMS (critical):
   - NEVER use \`page.locator('button[type="submit"]').first()\` or any unscoped \`button[type="submit"]\` — pages often have multiple submit buttons (e.g. "Add molecule" vs "Sign in"); you MUST click the button that belongs to the same form/card as the email/password fields.
   - For auth flows: build a scoped container first, e.g. \`const auth = page.locator('form').filter({ has: page.getByLabel(/email|e-mail/i) }).or(page.getByRole('dialog')).first()\` (adapt from source context), then use \`auth.getByRole('button', { name: /sign in|log in|submit/i })\` or exact button text from the repo.
   - If Playwright reports "intercepts pointer events" or overlay blocking: call \`resilientClick(loc)\` instead of plain \`click()\`; optionally \`await page.keyboard.press('Escape')\` once to dismiss overlays before clicking.
7. Introduce generous settling times:
   - Add \`await page.waitForTimeout(1000)\` after major actions (clicks, inputs, typing, form submissions) to allow React, Next.js, or server state updates to propagate and elements to render.
8. Use lenient, substring-based assertions:
   - Do NOT use strict case-sensitive equality matches on text contents.
   - Instead, search for presence or substring content in a relaxed, case-insensitive way. E.g.:
     \`const bodyText = await page.innerText('body');\`
     \`assert(bodyText.toLowerCase().includes('${testCase?.expectedResult?.toLowerCase().replace(/'/g, "\\'")}'), 'Expected result state not matched');\`
   - Or assert visibility of key success elements instead of exact string matching.
9. Print descriptive logs at each step using \`console.log()\` to make debugging a breeze for the user.
10. Return ONLY the raw JavaScript executable code.
11. DO NOT wrap the code in markdown code blocks like \`\`\`javascript or \`\`\`.
12. DO NOT include any explanation.
13. Just return the executable code.
`;

            const response = await ai.models.generateContent({
                model: "gemini-3.1-flash-lite",
                contents: prompt,
            });

            const tokensUsed = response.usageMetadata?.totalTokenCount || 0;
            if (tokensUsed > 0) {
                creditDeduction = Math.min(100, 70 + Math.floor(tokensUsed / 100));
            }

            let generatedCode = response.text || "";
            // Clean up any stray markdown wrappers just in case
            generatedCode = generatedCode.replace(/^```javascript\s*/i, "");
            generatedCode = generatedCode.replace(/^```js\s*/i, "");
            generatedCode = generatedCode.replace(/```$/, "");
            generatedCode = generatedCode.trim();

            if (!generatedCode) {
                return NextResponse.json(
                    { error: "Gemini failed to generate an automation script" },
                    { status: 500 }
                );
            }

            scriptText = generatedCode;

            // Save the generated script immediately to database
            await db
                .update(TestCasesTable)
                .set({
                    browserbaseScript: scriptText,
                    status: "running",
                })
                .where(eq(TestCasesTable.id, testCase.id));
        } else {
            // 3. Mark database status as running
            await db
                .update(TestCasesTable)
                .set({ status: "running" })
                .where(eq(TestCasesTable.id, testCase.id));
        }

        const logs: string[] = [];
        const customConsole = {
            log: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
            error: (...args: any[]) => logs.push(`[ERROR] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
            warn: (...args: any[]) => logs.push(`[WARN] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
        };

        let session: any = null;
        let browser: any = null;
        let page: Page | null = null;

        try {
            // 4. Create Browserbase Session
            session = await bb.sessions.create({
                projectId: process.env.BROWSERBASE_PROJECT_ID!,
            });

            logs.push(`[SYSTEM] Browserbase session created successfully with ID: ${session.id}`);

            browser = await chromium.connectOverCDP(session.connectUrl);
            const context = browser.contexts()[0];
            page = context.pages()[0] ?? null;
            if (!page) {
                throw new Error("Browserbase did not return an active page");
            }

            // 6. Listen to Browser Console Events
            page.on("console", (msg: any) => {
                logs.push(`[BROWSER] [${msg.type().toUpperCase()}] ${msg.text()}`);
            });

            logs.push(`[SYSTEM] Connected to Browserbase cloud browser, executing script...`);

            // 7. Compile and run script
            const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
            const runFn = new AsyncFunction("page", "assert", "console", scriptText);

            // Mock assertion helper for runtime container if script assumes assert is global
            const assertHelper = (condition: boolean, message?: string) => {
                if (!condition) {
                    throw new Error(message || "Assertion failed");
                }
            };

            await runFn(page, assertHelper, customConsole);

            logs.push(`[SYSTEM] Script execution completed successfully without errors.`);

            // 8. Clean up session and browser
            await page.close().catch(() => { });
            await browser.close().catch(() => { });

            // 9. Update DB Status to passed
            await db
                .update(TestCasesTable)
                .set({
                    status: "passed",
                    browserbaseScript: scriptText,
                    logs: logs,
                    sessionId: session.id,
                    sessionUrl: `https://www.browserbase.com/sessions/${session.id}`,
                    visionAnalysis: null,
                    failureContext: null,
                })
                .where(eq(TestCasesTable.id, testCase.id));

            // 10. Deduct credits
            const newCredits = user.credits - creditDeduction;
            await db.update(users).set({ credits: newCredits }).where(eq(users.id, user.id));

            return NextResponse.json({
                success: true,
                status: "passed",
                sessionId: session.id,
                sessionUrl: `https://www.browserbase.com/sessions/${session.id}`,
                logs,
                browserbaseScript: scriptText,
                credits: newCredits,
            });
        } catch (execError: any) {
            console.error("Script execution error:", execError);
            logs.push(`[SYSTEM ERROR] Script execution failed: ${execError.message || String(execError)}`);

            logs.push("[SYSTEM] Querying Coral for related context...");
            const coralCtxPromise = fetchFailureContext({
                id: testCase.id,
                repoOwner: testCase.repoOwner,
                repoName: testCase.repoName,
                targetRoute: testCase.targetRoute,
                targetFiles: testCase.targetFiles as string[] | null | undefined,
                title: testCase.title,
                description: testCase.description,
            }, runId);

            let visionAnalysis: string | null = null;
            let failureContext: FailureContext = { items: [], queries_run: [], coral_available: false };
            if (page) {
                const screenshotUrl = await capturePageScreenshot(page);
                failureContext = await coralCtxPromise;

                if (failureContext.coral_available) {
                    logs.push(
                        `[SYSTEM] Coral returned ${failureContext.items.length} related items across ${failureContext.queries_run.length} queries.`
                    );
                    for (const query of failureContext.queries_run) {
                        logs.push(`[CORAL] ${query.source}: ${query.rows} rows in ${query.ms}ms`);
                    }
                } else {
                    logs.push("[SYSTEM] Coral unavailable or no sources configured; skipping context enrichment.");
                }

                if (screenshotUrl) {
                    logs.push("[SYSTEM] Captured failure screenshot, running vision analysis...");
                    try {
                        visionAnalysis = await analyzeScreenshot(
                            screenshotUrl,
                            `${testCase.title}: ${testCase.description}. Expected: ${testCase.expectedResult ?? "N/A"}`,
                            failureContext.items
                        );
                        logs.push("[SYSTEM] Vision analysis completed.");
                        if (visionAnalysis) {
                            logs.push("[SYSTEM] --- Vision analysis result ---");
                            logs.push(visionAnalysis);
                            logs.push("[SYSTEM] --- End vision analysis ---");
                        }
                    } catch (visionError: unknown) {
                        const visionMsg =
                            visionError instanceof Error
                                ? visionError.message
                                : String(visionError);
                        logs.push(`[SYSTEM] Vision analysis skipped: ${visionMsg}`);
                    }
                }
            } else {
                failureContext = await coralCtxPromise;
            }

            await pendoTrackServer("failure_context_enriched", {
                test_case_id: testCase.id,
                coral_available: failureContext.coral_available,
                context_items_count: failureContext.items.length,
                queries_run_count: failureContext.queries_run.length,
                has_github_issues: failureContext.items.some(i => i.kind === "issue"),
                has_github_commits: failureContext.items.some(i => i.kind === "commit"),
                has_sentry_errors: failureContext.items.some(i => i.kind === "sentry"),
                has_linear_issues: failureContext.items.some(i => i.kind === "linear"),
                has_splunk_events: failureContext.items.some(i => i.kind === "splunk"),
                has_vision_analysis: Boolean(visionAnalysis),
            }, userId);

            // Clean up session and browser if still active
            if (browser) {
                await browser.close().catch(() => { });
            }

            // 10. Update DB Status to failed
            await db
                .update(TestCasesTable)
                .set({
                    status: "failed",
                    browserbaseScript: scriptText,
                    logs: logs,
                    sessionId: session?.id || null,
                    sessionUrl: session ? `https://www.browserbase.com/sessions/${session.id}` : null,
                    visionAnalysis,
                    failureContext,
                })
                .where(eq(TestCasesTable.id, testCase.id));

            // 11. Deduct credits (we still charge for failed executions as resources were used)
            const newCredits = user.credits - creditDeduction;
            await db.update(users).set({ credits: newCredits }).where(eq(users.id, user.id));

            return NextResponse.json({
                success: false,
                status: "failed",
                error: execError.message || String(execError),
                sessionId: session?.id,
                sessionUrl: session ? `https://www.browserbase.com/sessions/${session.id}` : null,
                visionAnalysis,
                failureContext,
                logs,
                browserbaseScript: scriptText,
                credits: newCredits,
            });
        }
    } catch (error: any) {
        console.error("API endpoint error:", error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || "An unexpected error occurred",
            },
            { status: 500 }
        );
    }
    });
}
