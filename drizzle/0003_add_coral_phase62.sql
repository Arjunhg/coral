CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" varchar(12) NOT NULL,
  "label" varchar(100) DEFAULT 'default',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp,
  "revoked_at" timestamp,
  CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);

DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "agent_queries" (
  "id" serial PRIMARY KEY NOT NULL,
  "test_case_id" integer,
  "run_id" varchar(64),
  "source" varchar(100) NOT NULL,
  "sql" text NOT NULL,
  "rows_returned" integer DEFAULT 0 NOT NULL,
  "duration_ms" integer DEFAULT 0 NOT NULL,
  "agent_role" varchar(50) NOT NULL,
  "status" varchar(20) DEFAULT 'ok' NOT NULL,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "agent_queries" ADD CONSTRAINT "agent_queries_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
