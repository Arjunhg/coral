import { isOCCError } from "@aws/aurora-dsql-node-postgres-connector";

// Aurora DSQL uses optimistic concurrency control at Repeatable Read isolation.
// When two transactions touch the same data, one commits and the other is
// aborted with a serialization/OCC error (SQLSTATE 40001 / DSQL "OC0xx"). The
// correct response is to retry the whole unit of work.
//
// `isOCCError` is the official detector shipped by the AWS connector, so we rely
// on it instead of hand-matching SQLSTATE codes.
//
// IMPORTANT: `fn` may run more than once, so it must be idempotent — no external
// side effects (emails, queue messages, payment calls) that must not repeat.

export async function withOccRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 50;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1 && isOCCError(err)) {
        // exponential backoff with jitter
        const delay = baseDelayMs * 2 ** i + Math.floor(Math.random() * baseDelayMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
