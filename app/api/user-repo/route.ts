import { db } from "@/db";
import { repositories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { userExists } from "@/lib/db/integrity";

export async function POST(req: NextRequest) {
    const { repoId, userId, name, full_name, private_, html_url, description, language, updated_at, default_branch, owner } = await req.json();

    console.log("POST /api/user-repo", { repoId, userId, name, full_name, private_, html_url, description, language, updated_at, default_branch, owner });

    // DSQL has no FK enforcement: verify the parent user exists before inserting
    // a repository that references it (replaces repositories.user_id → users.id).
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || !(await userExists(numericUserId))) {
        return NextResponse.json({ error: "user_not_found" }, { status: 400 });
    }

    //@ts-ignore
    const result = await db.insert(repositories).values({
        repoId,
        userId,
        name,
        fullName: full_name,
        private: private_ ? 1 : 0,
        htmlUrl: html_url,
        description,
        language,
        defaultBranch: default_branch,
        owner
    }).returning();

    return NextResponse.json(result[0]);


}


export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);

    const userId = searchParams.get("userId");

    const result = await db.select().from(repositories).where(
        //@ts-ignore
        eq(repositories.userId, userId)
    )

    return NextResponse.json(result);
}