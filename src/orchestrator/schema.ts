import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// workflows — top-level operation (e.g. "daily lead pipeline")
// One row per run. Started by a manager agent, may recur daily.
// ---------------------------------------------------------------------------

export const workflows = sqliteTable("workflows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  managerAgentId: text("manager_agent_id").notNull(),
  status: text("status").notNull().default("running"),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
  summary: text("summary"),
  sessionPath: text("session_path"),
  metadata: text("metadata"),
});

// ---------------------------------------------------------------------------
// tasks — unit of work assigned to an agent within a workflow
// ---------------------------------------------------------------------------

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  workflowId: integer("workflow_id").notNull().references(() => workflows.id),
  agentId: text("agent_id").notNull(),
  assignedBy: text("assigned_by").notNull(),
  parentTask: integer("parent_task"),
  prompt: text("prompt").notNull(),
  status: text("status").notNull().default("queued"),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  resultSummary: text("result_summary"),
  deliverables: text("deliverables"),
  error: text("error"),
  sessionPath: text("session_path"),
}, (table) => [
  index("idx_tasks_workflow").on(table.workflowId),
]);

// ---------------------------------------------------------------------------
// task_deps — dependency graph. Task B can't start until task A completes.
// ---------------------------------------------------------------------------

export const taskDeps = sqliteTable("task_deps", {
  taskId: integer("task_id").notNull().references(() => tasks.id),
  dependsOn: integer("depends_on").notNull().references(() => tasks.id),
}, (table) => [
  index("idx_taskdeps_task").on(table.taskId),
  index("idx_taskdeps_depends").on(table.dependsOn),
]);

// ---------------------------------------------------------------------------
// task_log — progress entries. Agents write as they work. Append-only.
// ---------------------------------------------------------------------------

export const taskLog = sqliteTable("task_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull().references(() => tasks.id),
  agentId: text("agent_id").notNull(),
  timestamp: integer("timestamp").notNull(),
  entry: text("entry").notNull(),
}, (table) => [
  index("idx_tasklog_task").on(table.taskId),
]);
