// Use this file to apply DSQL DDL statements to your database on AWS (in simple terms this will create tables in AWS DSQL for you`). You can run this script with `node scripts/apply-dsql-ddl.mjs` after setting up your AWS credentials and environment variables.

import { Client } from "pg";
import { DsqlSigner } from "@aws-sdk/dsql-signer";

// const host = process.env.DSQL_ENDPOINT;
// const region = process.env.AWS_REGION;

const host = 'zrt2tyrdn6bmt4yiqhdqijwoui.dsql.us-east-1.on.aws';
const region = "us-east-1";

const signer = new DsqlSigner({ hostname: host, region });
const token = await signer.getDbConnectAdminAuthToken();

const client = new Client({
    host, port: 5432, database: "postgres", user: "admin", password: token, ssl: { rejectUnauthorized: true },
})

const statements = [
  `CREATE TABLE users (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (CACHE 65536) NOT NULL,
    name text,
    email text NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    credits integer NOT NULL DEFAULT 1000
  )`,
  `CREATE UNIQUE INDEX ASYNC users_email_unique ON users (email)`,

  `CREATE TABLE repositories (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (CACHE 65536) NOT NULL,
    user_id bigint NOT NULL,
    repo_id bigint NOT NULL,
    name text NOT NULL,
    full_name text NOT NULL,
    private integer NOT NULL,
    html_url text NOT NULL,
    description text,
    owner text NOT NULL,
    language text,
    default_branch text NOT NULL,
    target_domain varchar DEFAULT 'http://localhost:3000/',
    global_instruction text
  )`,

  `CREATE TABLE test_cases (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (CACHE 65536) NOT NULL,

    user_id varchar(255) NOT NULL,
    repo_id varchar(255),
    repo_name varchar(255) NOT NULL,
    repo_owner varchar(255) NOT NULL,
    branch varchar(100) DEFAULT 'main',

    title varchar(500) NOT NULL,
    description text NOT NULL,
    type varchar(100) NOT NULL,
    priority varchar(50) NOT NULL,

    target_route varchar(500),
    target_files jsonb DEFAULT '[]'::jsonb,
    expected_result text,

    browserbase_script text,
    status varchar(100) DEFAULT 'generated',

    created_at timestamp DEFAULT now(),

    logs jsonb DEFAULT '[]'::jsonb,
    session_id varchar(255),
    session_url varchar(500),
    vision_analysis text,
    failure_context jsonb DEFAULT NULL
  )`,

  `CREATE TABLE api_keys (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (CACHE 65536) NOT NULL,
    user_id bigint NOT NULL,
    key_hash text NOT NULL,
    key_prefix varchar(12) NOT NULL,
    label varchar(100) DEFAULT 'default',
    created_at timestamp NOT NULL DEFAULT now(),
    last_used_at timestamp,
    revoked_at timestamp
  )`,
  `CREATE UNIQUE INDEX ASYNC api_keys_key_hash_unique ON api_keys (key_hash)`,

  `CREATE TABLE agent_queries (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (CACHE 65536) NOT NULL,
    test_case_id bigint,
    run_id varchar(64),
    source varchar(100) NOT NULL,
    sql text NOT NULL,
    rows_returned integer NOT NULL DEFAULT 0,
    duration_ms integer NOT NULL DEFAULT 0,
    agent_role varchar(50) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'ok',
    error_message text,
    created_at timestamp NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE coral_connections (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (CACHE 65536) NOT NULL,
    user_id varchar(255) NOT NULL,
    source_name varchar(100) NOT NULL,
    status varchar(50) NOT NULL DEFAULT 'pending',
    last_verified_at timestamp,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX ASYNC coral_connections_user_source_idx
    ON coral_connections (user_id, source_name)`
];

await client.connect();
for (const [i, sql] of statements.entries()){
    await client.query(sql);
    console.log(`✓ [${i + 1}/${statements.length}] applied`);
}

await client.end();
console.log("DSQL schema ready.")