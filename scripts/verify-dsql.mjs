// Standalone DSQL verification — proves IAM auth (OIDC/creds) + TLS + driver +
// identity-column schema all work, without needing Clerk or the Next server.
//
//   $env:DSQL_ENDPOINT="‹clusterId›.dsql.us-east-1.on.aws"; $env:AWS_REGION="us-east-1"
//   node scripts/verify-dsql.mjs
//
// Uses the same AWS credentials/role your app uses.

import { AuroraDSQLPool } from "@aws/aurora-dsql-node-postgres-connector";

const host = process.env.DSQL_ENDPOINT;
const region = process.env.AWS_REGION;

if (!host) {
  console.error("Set DSQL_ENDPOINT (‹clusterId›.dsql.‹region›.on.aws)");
  process.exit(1);
}

const pool = new AuroraDSQLPool({
  host,
  region,
  port: 5432,
  database: "postgres",
  user: "admin",
  ssl: { rejectUnauthorized: true },
  max: 2,
});

const email = `dsql-verify+${Date.now()}@example.com`;

try {
  // 1. Connectivity + IAM token + TLS
  const ping = await pool.query("SELECT 1 AS ok");
  console.log("✓ connected; SELECT 1 →", ping.rows[0].ok);

  // 2. INSERT exercises the GENERATED ALWAYS AS IDENTITY (CACHE 65536) PK + defaults
  const ins = await pool.query(
    "INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email, credits, created_at",
    [email, "DSQL Verify"]
  );
  const row = ins.rows[0];
  console.log(`✓ insert OK; identity id=${row.id}, default credits=${row.credits}`);

  // 3. Read back
  const sel = await pool.query("SELECT id, email FROM users WHERE email = $1", [email]);
  console.log(`✓ select round-trip found ${sel.rowCount} row`);

  // 4. Cleanup
  await pool.query("DELETE FROM users WHERE id = $1", [row.id]);
  console.log("✓ cleanup deleted the test row");

  console.log("\nAll checks passed — DSQL connectivity, IAM auth, and schema are good.");
} catch (e) {
  console.error("✗ verification FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
