import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity({ cache: 65536 }),
  name: text("name"),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  credits: integer("credits").default(1000).notNull(),
});


export const repositories = pgTable("repositories", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity( { cache: 65536 }),
  userId: integer("user_id").notNull(),
  repoId: integer("repo_id").notNull(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  private: integer("private").notNull(),
  htmlUrl: text("html_url").notNull(),
  description: text("description"),
  owner: text("owner").notNull(),
  language: text("language"),
  defaultBranch: text("default_branch").notNull(),
  targetDomain: varchar("target_domain").default('http://localhost:3000/'),
  gloablInstruction: text("global_instruction"),
})



export const TestCasesTable = pgTable("test_cases", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity({ cache: 65536 }),

  // User / project details
  userId: varchar("user_id", { length: 255 }).notNull(),
  repoId: varchar("repo_id", { length: 255 }),
  repoName: varchar("repo_name", { length: 255 }).notNull(),
  repoOwner: varchar("repo_owner", { length: 255 }).notNull(),
  branch: varchar("branch", { length: 100 }).default("main"),

  // Main test case data
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description").notNull(),
  type: varchar("type", { length: 100 }).notNull(),
  priority: varchar("priority", { length: 50 }).notNull(),

  // Important metadata for second step: Browserbase script generation
  targetRoute: varchar("target_route", { length: 500 }),
  targetFiles: jsonb("target_files").$type<string[]>().default([]),
  expectedResult: text("expected_result"),

  // Later update these fields
  browserbaseScript: text("browserbase_script"),
  status: varchar("status", { length: 100 }).default("generated"),

  createdAt: timestamp("created_at").defaultNow(),


  logs: jsonb("logs").$type<string[]>().default([]),
  sessionId: varchar("session_id", { length: 255 }),
  sessionUrl: varchar("session_url", { length: 500 }),
  visionAnalysis: text("vision_analysis"),
  failureContext: jsonb("failure_context").$type<{
    items: Array<{
      kind: string;
      source: string;
      title: string;
      url: string | null;
      timestamp: string | null;
      metadata?: Record<string, unknown>;
    }>;
    queries_run: Array<{ source: string; sql: string; rows: number; ms: number }>;
    coral_available: boolean;
  } | null>().default(null),
});

export const apiKeys = pgTable("api_keys", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity({ cache: 65536 }),
  userId: integer("user_id").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
  label: varchar("label", { length: 100 }).default("default"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
});

export const agentQueries = pgTable("agent_queries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity({ cache: 65536 }),
  testCaseId: integer("test_case_id"),
  runId: varchar("run_id", { length: 64 }),
  source: varchar("source", { length: 100 }).notNull(),
  sql: text("sql").notNull(),
  rowsReturned: integer("rows_returned").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  agentRole: varchar("agent_role", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("ok"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const coralConnections = pgTable(
  "coral_connections",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity({ cache: 65536 }),
    userId: varchar("user_id", { length: 255 }).notNull(),
    sourceName: varchar("source_name", { length: 100 }).notNull(),
    status: varchar("status", { length: 50 }).notNull().default("pending"),
    lastVerifiedAt: timestamp("last_verified_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userSourceUnique: uniqueIndex("coral_connections_user_source_idx").on(
      table.userId,
      table.sourceName
    ),
  })
);


export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
