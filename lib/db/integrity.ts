import { db } from "@/db";
import { agentQueries, users } from "@/db/schema";
import { eq } from "drizzle-orm";

// Aurora DSQL does not enforce foreign keys, so the relationships that used to
// be FK constraints are enforced here in application code instead.

/**
 * Replaces the FK `repositories.user_id → users.id` / `api_keys.user_id → users.id`.
 * Confirms a users row exists before inserting a child row referencing it, so we
 * fail loudly instead of silently creating an orphan.
 */
export async function userExists(userId: number): Promise<boolean> {
  if (!Number.isInteger(userId)) return false;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId));
  return Boolean(row);
}

/**
 * Replaces the `ON DELETE CASCADE` on `agent_queries.test_case_id → test_cases.id`.
 * Call this BEFORE deleting a test case so its agent-query rows are removed first.
 *
 * There is no test-case delete route today; this is provided so a future delete
 * path can preserve the old cascade semantics in one line.
 */
export async function deleteAgentQueriesForTestCase(testCaseId: number): Promise<void> {
  await db.delete(agentQueries).where(eq(agentQueries.testCaseId, testCaseId));
}
