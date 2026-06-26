import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { TestCasesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Browserbase } from "@browserbasehq/sdk";

const bb = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY!,
});

/**
 * GET /api/test-cases/[id]/recording/[pageId]
 *
 * Proxies the Browserbase HLS playlist (.m3u8) for a specific page of a
 * session replay. The HLS player on the client loads this URL as the stream
 * source. Segment URLs inside the playlist are signed CDN URLs that the
 * browser fetches directly (valid for 6 hours).
 *
 * This proxy approach means end-users never need Browserbase credentials.
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string; pageId: string }> }
) {
    try {
        const { id, pageId } = await params;
        const testCaseId = Number(id);

        if (!testCaseId || Number.isNaN(testCaseId)) {
            return new Response("A valid test case id is required", { status: 400 });
        }

        const [testCase] = await db
            .select()
            .from(TestCasesTable)
            .where(eq(TestCasesTable.id, testCaseId));

        if (!testCase) {
            return new Response("Test case not found", { status: 404 });
        }

        if (!testCase.sessionId) {
            return new Response("No session associated with this test case", { status: 404 });
        }

        // Fetch the HLS playlist for this page from Browserbase using our API key.
        const playlist = await bb.sessions.replays.retrievePage(
            testCase.sessionId,
            pageId
        );

        const m3u8 = await playlist.text();

        if (!m3u8 || m3u8.trim().length === 0) {
            return new Response("Replay playlist is empty", { status: 404 });
        }

        return new Response(m3u8, {
            status: 200,
            headers: {
                "Content-Type": "application/vnd.apple.mpegurl",
                // Allow hls.js to load this from the same origin
                "Cache-Control": "no-store",
            },
        });
    } catch (error: any) {
        console.error("HLS playlist proxy error:", error);
        const status = error?.status === 404 ? 404 : 500;
        return new Response(
            error?.message || "Failed to load replay playlist",
            { status }
        );
    }
}