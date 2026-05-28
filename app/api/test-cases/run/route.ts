import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { analyzeScreenshot } from "@/lib/featherless/analyzeScreenshot";
import { db } from "@/db";
import { TestCasesTable, repositories, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { Browserbase } from "@browserbasehq/sdk";
import { chromium, Page } from "playwright-core";

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

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { testCaseId, baseUrl, mode = "generate", customPrompt = "" } = body;

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

            let visionAnalysis: string | null = null;
            if (page) {
                const screenshotUrl = await capturePageScreenshot(page);
                if (screenshotUrl) {
                    logs.push("[SYSTEM] Captured failure screenshot, running vision analysis...");
                    try {
                        visionAnalysis = await analyzeScreenshot(
                            screenshotUrl,
                            `${testCase.title}: ${testCase.description}. Expected: ${testCase.expectedResult ?? "N/A"}`
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
            }

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
}
