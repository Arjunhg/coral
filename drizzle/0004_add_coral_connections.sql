CREATE TABLE IF NOT EXISTS "coral_connections" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "source_name" varchar(100) NOT NULL,
  "status" varchar(50) DEFAULT 'pending' NOT NULL,
  "last_verified_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "coral_connections_user_source_idx"
  ON "coral_connections" ("user_id", "source_name");
