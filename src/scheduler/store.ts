import * as fs from "fs";
import * as path from "path";
import { config } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schedule definition — exactly one of cron, every, or at must be set. */
export interface Schedule {
  cron?: string;
  every?: string;
  at?: string;
  /** Active hours window for "every" schedules. Ignored for cron/at. */
  activeHours?: { start: string; end: string };
}

/** A scheduled job as stored in schedules/jobs.json. */
export interface ScheduledJob {
  name: string;
  agent: string;
  schedule: Schedule;
  prompt: string;
  channel: string;
  user: string;
  isolated: boolean;
  enabled: boolean;
  deleteAfterRun: boolean;
  createdBy: string;
  createdAt: string;
  /** Set when a one-shot job completes. */
  completedAt?: string;
}

/** All jobs keyed by jobId. */
export type JobStore = Record<string, ScheduledJob>;

/** A single run history entry appended to {jobId}.jsonl */
export interface RunEntry {
  ts: number;
  status: "ok" | "error";
  durationMs: number;
  tokens: number;
  delivered: boolean;
  suppressed?: string;
  error?: string;
  errorType?: "transient" | "permanent";
  retry?: number;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function schedulesPath(): string {
  return path.join(config.workspaceDir, "schedules", "jobs.json");
}

function runsDir(): string {
  return path.join(config.workspaceDir, "schedules", "runs");
}

function runHistoryPath(jobId: string): string {
  return path.join(runsDir(), `${jobId}.jsonl`);
}

// ---------------------------------------------------------------------------
// normalizeAtValue — strip timezone suffixes from "at" schedule values
// ---------------------------------------------------------------------------

/**
 * Strips timezone suffixes (Z, +HH:MM, -HH:MM) from an ISO 8601 datetime string.
 *
 * Why: All "at" values are interpreted in the user's configured timezone from
 * openwren.json. A timezone suffix would cause misinterpretation — e.g. "Z"
 * means UTC, but the user intends their local time. Since the timezone comes
 * from config, there is no reason for a suffix to be present.
 *
 * This runs on all input paths (agent tool, CLI, REST API) before storing,
 * so users never get surprised regardless of what format they paste in.
 *
 * Examples:
 *   "2026-03-15T09:00:00Z"       → "2026-03-15T09:00:00"
 *   "2026-03-15T09:00:00+02:00"  → "2026-03-15T09:00:00"
 *   "2026-03-15T09:00:00-05:30"  → "2026-03-15T09:00:00"
 *   "2026-03-15T09:00:00"        → "2026-03-15T09:00:00" (no change)
 */
export function normalizeAtValue(value: string): string {
  // Strip trailing Z
  if (value.endsWith("Z")) {
    return value.slice(0, -1);
  }
  // Strip trailing +HH:MM or -HH:MM offset
  const offsetMatch = value.match(/[+-]\d{2}:\d{2}$/);
  if (offsetMatch) {
    return value.slice(0, offsetMatch.index);
  }
  return value;
}

/**
 * Normalizes the schedule object before storing. Currently only affects "at"
 * values — strips timezone suffixes so all times are interpreted in the
 * user's configured timezone.
 */
export function normalizeSchedule(schedule: Schedule): Schedule {
  if (schedule.at) {
    return { ...schedule, at: normalizeAtValue(schedule.at) };
  }
  return schedule;
}

// ---------------------------------------------------------------------------
// generateJobId — slugify name + deduplicate against existing IDs
// ---------------------------------------------------------------------------

/**
 * Creates a URL-safe job ID from a human-readable name.
 * Slugifies the name (lowercase, hyphens, no special chars) and appends
 * a numeric suffix if the ID already exists in the store.
 *
 * Examples:
 *   "Morning Briefing" + {} → "morning-briefing"
 *   "Morning Briefing" + {"morning-briefing": ...} → "morning-briefing-2"
 *   "Morning Briefing" + {"morning-briefing": ..., "morning-briefing-2": ...} → "morning-briefing-3"
 */
export function generateJobId(name: string, existingIds: Set<string>): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-") // replace non-alphanumeric runs with hyphens
    .replace(/^-+|-+$/g, "");    // trim leading/trailing hyphens

  if (!base) return `job-${Date.now()}`; // fallback for empty/weird names

  if (!existingIds.has(base)) return base;

  let i = 2;
  while (existingIds.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// ---------------------------------------------------------------------------
// Read/write schedules/jobs.json
// ---------------------------------------------------------------------------

/** Load all jobs from schedules/jobs.json. Returns empty store if file missing. */
export function loadJobs(): JobStore {
  const filePath = schedulesPath();
  if (!fs.existsSync(filePath)) return {};

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as JobStore;
  } catch (err) {
    console.error(`[scheduler] Failed to parse schedules/jobs.json: ${(err as Error).message}`);
    return {};
  }
}

/** Persist the full job store to schedules/jobs.json. */
export function saveJobs(jobs: JobStore): void {
  const filePath = schedulesPath();
  fs.writeFileSync(filePath, JSON.stringify(jobs, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Run history — append-only JSONL per job, auto-pruned
// ---------------------------------------------------------------------------

/** Append a run entry to the job's history file. */
export function appendRunEntry(jobId: string, entry: RunEntry): void {
  const filePath = runHistoryPath(jobId);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Prune run history to keep only the last N lines.
 * Called after appending to prevent unbounded growth.
 */
export function pruneRunHistory(jobId: string, maxLines: number): void {
  const filePath = runHistoryPath(jobId);
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trimEnd().split("\n");

  if (lines.length <= maxLines) return;

  const pruned = lines.slice(lines.length - maxLines);
  fs.writeFileSync(filePath, pruned.join("\n") + "\n", "utf-8");
}

/** Read the last N run entries for a job. Returns newest-last. */
export function readRunHistory(jobId: string, limit = 50): RunEntry[] {
  const filePath = runHistoryPath(jobId);
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trimEnd().split("\n").filter(Boolean);
    const entries = lines.slice(-limit).map((line) => JSON.parse(line) as RunEntry);
    return entries;
  } catch (err) {
    console.error(`[scheduler] Failed to read run history for ${jobId}: ${(err as Error).message}`);
    return [];
  }
}

/** Delete the run history file for a job. Called when a job is deleted. */
export function deleteRunHistory(jobId: string): void {
  const filePath = runHistoryPath(jobId);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore — file may already be gone
  }
}

// ---------------------------------------------------------------------------
// Schedule validation — called before persisting to catch bad formats early
// ---------------------------------------------------------------------------

/**
 * Validates a schedule object before it is stored.
 * Throws a descriptive error if the schedule is invalid.
 * Must be called before saveJobs() to prevent broken jobs from being persisted.
 */
export function validateSchedule(schedule: Schedule): void {
  const keys = [schedule.cron, schedule.every, schedule.at].filter(Boolean);
  if (keys.length === 0) {
    throw new Error('Schedule must have exactly one of: cron, every, at');
  }
  if (keys.length > 1) {
    throw new Error('Schedule must have only one of: cron, every, at');
  }

  if (schedule.every) {
    // This throws with a descriptive message if the format is wrong
    parseInterval(schedule.every);
  }

  if (schedule.at) {
    // Validate ISO-like format: YYYY-MM-DDTHH:MM:SS (after normalization strips tz suffix)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(schedule.at)) {
      throw new Error(
        `Invalid "at" value: "${schedule.at}". Expected format: YYYY-MM-DDTHH:MM:SS`
      );
    }
  }

  if (schedule.cron) {
    // Basic sanity check: cron should have 5 or 6 space-separated fields
    const fields = schedule.cron.trim().split(/\s+/);
    if (fields.length < 5 || fields.length > 6) {
      throw new Error(
        `Invalid cron expression: "${schedule.cron}". Expected 5-6 fields (e.g. "0 8 * * *")`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Interval parsing — converts "30m", "2h", "1d" to milliseconds
// ---------------------------------------------------------------------------

/**
 * Parses a human-friendly interval string into milliseconds.
 * Supported units: m (minutes), h (hours), d (days).
 * No weeks/months/years — use cron expressions for those.
 *
 * Examples:
 *   "30m" → 1_800_000
 *   "2h"  → 7_200_000
 *   "1d"  → 86_400_000
 */
export function parseInterval(str: string): number {
  const match = str.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error(
      `Invalid interval: "${str}". Use format like "30m", "2h", or "1d".`
    );
  }
  const n = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "m") return n * 60_000;
  if (unit === "h") return n * 3_600_000;
  return n * 86_400_000; // d
}
