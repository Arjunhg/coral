import { db } from "@/db";
import { TestCasesTable, users } from "@/db/schema";
import { and, desc, eq, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

export async function GET(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const searchparams = new URL(req.url).searchParams;
    const repoId = searchparams.get('repoId');

    if (!repoId) {
        return NextResponse.json({ error: 'repoId is required' }, { status: 400 })
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

    const result = await db
        .select()
        .from(TestCasesTable)
        .where(and(eq(TestCasesTable.repoId, repoId), or(...userFilters)))
        .orderBy(desc(TestCasesTable?.id))

    return NextResponse.json(result)
}