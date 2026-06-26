import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { TestCasesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Browserbase } from "@browserbasehq/sdk";

const bb = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY!,
});

/**
 * GET /api/test-cases/[id]/recording
 *
 * Returns the HLS replay metadata (pages list) for a test case's Browserbase
 * session. The client uses this to discover which pageId to play back.
 *
 * The recording is fetched server-side with OUR Browserbase API key, so the
 * Scriptless end user never needs a Browserbase account.
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const testCaseId = Number(id);

        if (!testCaseId || Number.isNaN(testCaseId)) {
            return NextResponse.json(
                { error: "A valid test case id is required" },
                { status: 400 }
            );
        }

        const [testCase] = await db
            .select()
            .from(TestCasesTable)
            .where(eq(TestCasesTable.id, testCaseId));

        if (!testCase) {
            return NextResponse.json(
                { error: "Test case not found" },
                { status: 404 }
            );
        }

        if (!testCase.sessionId) {
            return NextResponse.json(
                { error: "No recording is available for this test case yet. Run the test first." },
                { status: 404 }
            );
        }

        // Fetch HLS replay metadata using the new Session Replay API.
        // bb.sessions.recording.retrieve() is deprecated — use replays instead.
        const meta = await bb.sessions.replays.retrieve(testCase.sessionId);

        if (!meta?.pages || meta.pages.length === 0) {
            return NextResponse.json(
                {
                    error:
                        "The recording is empty or has not been processed yet. Recordings can take a few seconds to become available after a run.",
                },
                { status: 404 }
            );
        }

        return NextResponse.json({
            sessionId: testCase.sessionId,
            pages: meta.pages,
            pageCount: meta.pageCount ?? meta.pages.length,
        });
    } catch (error: any) {
        console.error("Recording fetch error:", error);

        const status = error?.status === 404 ? 404 : 500;
        return NextResponse.json(
            {
                error:
                    status === 404
                        ? "Recording not found on Browserbase. The session may have expired or recording may be disabled."
                        : error?.message || "Failed to load recording",
            },
            { status }
        );
    }
}