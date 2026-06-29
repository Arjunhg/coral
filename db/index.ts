import { drizzle } from "drizzle-orm/node-postgres";
import { AuroraDSQLPool } from "@aws/aurora-dsql-node-postgres-connector";
import * as schema from "./schema";

// Aurora DSQL connection (replaces the Neon HTTP serverless driver).
//
// The connector extends node-postgres `Pool` and mints/refreshes a short-lived
// IAM auth token for every new physical connection, so there is no static
// password and no manual token-expiry handling. Drizzle's node-postgres adapter
// talks to it exactly like a normal pg Pool — the query API (db.select/insert/…)
// is unchanged across the app.

const host = process.env.DSQL_ENDPOINT; // ‹clusterId›.dsql.‹region›.on.aws
const region = process.env.AWS_REGION; // optional; auto-derived from host if omitted

if (!host) {
  throw new Error(
    "DSQL_ENDPOINT is not set. Expected ‹clusterId›.dsql.‹region›.on.aws"
  );
}

console.log({
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
  AWS_ROLE_ARN: process.env.AWS_ROLE_ARN,
  AWS_REGION: process.env.AWS_REGION,
  DSQL_ENDPOINT: process.env.DSQL_ENDPOINT,
});

try {
  const { defaultProvider } = await import("@aws-sdk/credential-provider-node");

  const creds = await defaultProvider()();

  console.log("AWS credentials loaded:", {
    accessKey: creds.accessKeyId.slice(0, 8),
  });
} catch (e) {
  console.error("Default provider failed:", e);
}

function createPool() {
  const pool = new AuroraDSQLPool({
    host,
    region,
    port: 5432,
    database: "postgres", // DSQL exposes a single database named "postgres"
    user: "admin", // connector generates an admin IAM token automatically
    ssl: { rejectUnauthorized: true }, // TLS is required by DSQL
    max: 5, // keep small for serverless / connection cap
    idleTimeoutMillis: 20_000, // drop idle conns before DSQL silently closes them
    connectionTimeoutMillis: 10_000,
    keepAlive: true, // keep sockets warm so DSQL is less likely to drop them
    maxLifetimeSeconds: 50 * 60, // recycle before DSQL's 1h hard cap
    // Credentials come from the default AWS provider chain (env vars, IAM role,
    // or web-identity/OIDC). On Vercel with OIDC federation, resolve a role via
    // @vercel/functions and pass it explicitly instead, e.g.:
    //
    //   import { awsCredentialsProvider } from "@vercel/functions/oidc";
    //   customCredentialsProvider: awsCredentialsProvider({
    //     roleArn: process.env.AWS_ROLE_ARN!,
    //   }),
  });

  // An idle pooled connection can be closed by DSQL or the network. Without this
  // listener that 'error' event would crash the process. We log and move on —
  // pg discards the dead client and the next query opens a fresh connection.
  pool.on("error", (err) => {
    console.warn("[db] idle pool client error (discarded):", err.message);
  });

  return pool;
}

// In `next dev`, HMR re-evaluates this module on every change. Cache the pool on
// globalThis so we keep ONE pool instead of leaking a new pool (with orphaned
// connections) per reload. In production this is just a normal module singleton.
const globalForDb = globalThis as unknown as { __dsqlPool?: AuroraDSQLPool };
export const pool = globalForDb.__dsqlPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  globalForDb.__dsqlPool = pool;
}

export const db = drizzle(pool, { schema });
