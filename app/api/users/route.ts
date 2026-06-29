import { db } from "@/db";
import { users } from "@/db/schema";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { withOccRetry } from "@/lib/db/retry";

const UNIQUE_VIOLATION = "23505";

export async function POST(req: NextRequest) {
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress ?? '';

    try {
        // Get-or-create is a read-then-write race under DSQL's optimistic
        // concurrency. withOccRetry retries on OCC conflicts; the inner catch
        // handles the case where a concurrent request created the row first.
        const result = await withOccRetry(async () => {
            const existing = await db.select().from(users).where(eq(users.email, email));
            if (existing.length > 0) {
                return existing[0];
            }

            try {
                const [created] = await db.insert(users).values({
                    email,
                    name: user?.fullName ?? 'New User'
                }).returning();
                return created;
            } catch (e: any) {
                // Another request won the race and inserted the same email.
                if (e?.code === UNIQUE_VIOLATION) {
                    const [again] = await db.select().from(users).where(eq(users.email, email));
                    if (again) return again;
                }
                throw e;
            }
        });

        return NextResponse.json({ user: result })
    }
    catch (e) {
        console.log("Error Creating User: ", e)
        return NextResponse.json({ error: "Failed to create new user" }, { status: 500 })
    }
}
