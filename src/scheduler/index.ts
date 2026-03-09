/**
 * Scheduler — loads jobs on startup, creates timers, provides CRUD operations.
 *
 * This is the central coordinator for the scheduling system. It:
 * - Loads schedules/jobs.json into memory on start
 * - Creates croner/setInterval/setTimeout timers for each enabled job
 * - Enqueues jobs into the FIFO queue when timers fire
 * - Provides CRUD operations (create, update, delete, enable, disable)
 * - Persists changes back to schedules/jobs.json on every mutation
 * - Manages the heartbeat timer (delegated to heartbeat.ts)
 *
 * The scheduler is the only module that writes to schedules/jobs.json at runtime.
 * All three access paths (agent tool, CLI via REST API, future WebUI) call
 * through these functions.
 */

import { Cron } from "croner";
import { config } from "../config";
import { deliverMessage } from "../channels";
import { localToUtcMs, isWithinActiveHours } from "../utils/timezone";
import type { ScheduledJob, Schedule, JobStore } from "./store";
import {
  loadJobs,
  saveJobs,
  generateJobId,
  normalizeSchedule,
  validateSchedule,
  parseInterval,
  deleteRunHistory,
  readRunHistory,
} from "./store";
import { JobQueue } from "./queue";
import { executeJob, type RunResult } from "./runner";
import { startHeartbeat, stopHeartbeat, isHeartbeatJob, heartbeatAgentId, buildHeartbeatPrompt } from "./heartbeat";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** In-memory copy of all jobs, loaded from schedules/jobs.json on start. */
let jobs: JobStore = {};

/** Active timers keyed by jobId. Each is either a Cron instance or a NodeJS timer. */
const timers = new Map<string, Cron | ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>>();
/** Next expected fire time for every/at jobs (Cron uses its own .nextRun()). */
const nextRunTimes = new Map<string, Date>();

/** The sequential job queue. One job processes at a time. */
let queue: JobQueue;

/** Backoff retry tracking per job. */
const BACKOFF_SCHEDULE = [30_000, 60_000, 300_000]; // 30s, 1m, 5m
const retryCounters = new Map<string, number>();

// ---------------------------------------------------------------------------
// Timer management
// ---------------------------------------------------------------------------

/**
 * Create and start a timer for a job based on its schedule type.
 * The timer enqueues the jobId into the sequential queue when it fires.
 */
function createTimer(jobId: string, job: ScheduledJob): void {
  clearTimer(jobId);

  const schedule = job.schedule;

  if (schedule.cron) {
    // Cron expression — croner handles timezone natively
    const cronJob = new Cron(schedule.cron, { timezone: config.timezone }, () => {
      console.log(`[scheduler] Cron fired: "${jobId}"`);
      queue.enqueue({ jobId });
    });
    timers.set(jobId, cronJob);
    console.log(`[scheduler] Timer set for "${jobId}" (cron: ${schedule.cron}, next: ${cronJob.nextRun()?.toISOString() ?? "none"})`);

  } else if (schedule.every) {
    // Interval — setInterval with active hours gating
    const ms = parseInterval(schedule.every);
    nextRunTimes.set(jobId, new Date(Date.now() + ms));
    const timer = setInterval(() => {
      // Check active hours before firing
      if (schedule.activeHours) {
        if (!isWithinActiveHours(schedule.activeHours.start, schedule.activeHours.end, config.timezone)) {
          nextRunTimes.set(jobId, new Date(Date.now() + ms));
          return; // outside active hours, skip this cycle
        }
      }
      console.log(`[scheduler] Interval fired: "${jobId}"`);
      nextRunTimes.set(jobId, new Date(Date.now() + ms));
      queue.enqueue({ jobId });
    }, ms);
    timers.set(jobId, timer);
    console.log(`[scheduler] Timer set for "${jobId}" (every: ${schedule.every})`);

  } else if (schedule.at) {
    // One-shot — setTimeout to the target time
    const targetMs = localToUtcMs(schedule.at, config.timezone);
    const delayMs = targetMs - Date.now();

    if (delayMs <= 0) {
      console.warn(`[scheduler] Job "${jobId}" scheduled for the past (${schedule.at}) — running immediately`);
      queue.enqueue({ jobId });
      return;
    }

    nextRunTimes.set(jobId, new Date(targetMs));
    const timer = setTimeout(() => {
      console.log(`[scheduler] One-shot fired: "${jobId}"`);
      nextRunTimes.delete(jobId);
      queue.enqueue({ jobId });
    }, delayMs);
    timers.set(jobId, timer);
    console.log(`[scheduler] Timer set for "${jobId}" (at: ${schedule.at}, in ${Math.round(delayMs / 1000)}s)`);
  }
}

/** Cancel a timer for a job. */
function clearTimer(jobId: string): void {
  const timer = timers.get(jobId);
  if (!timer) return;

  if (timer instanceof Cron) {
    timer.stop();
  } else {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
    clearInterval(timer as ReturnType<typeof setInterval>);
  }
  timers.delete(jobId);
  nextRunTimes.delete(jobId);
}

// ---------------------------------------------------------------------------
// Job processor — called by the queue for each job
// ---------------------------------------------------------------------------

async function processJob(jobId: string): Promise<void> {
  // Handle heartbeat jobs — they aren't stored in schedules/jobs.json
  if (isHeartbeatJob(jobId)) {
    await processHeartbeat(jobId);
    return;
  }

  const job = jobs[jobId];
  if (!job || !job.enabled) return;

  const result = await executeJob(jobId, job);

  if (result.status === "ok") {
    // Reset retry counter on success
    retryCounters.delete(jobId);

    // Handle one-shot jobs
    if (job.schedule.at) {
      if (job.deleteAfterRun) {
        await deleteJob(jobId);
        console.log(`[scheduler] One-shot job "${jobId}" completed and deleted`);
      } else {
        job.enabled = false;
        job.completedAt = new Date().toISOString();
        saveJobs(jobs);
        clearTimer(jobId);
        console.log(`[scheduler] One-shot job "${jobId}" completed and disabled`);
      }
    }
  } else if (result.errorType === "permanent") {
    // Permanent error — disable the job
    job.enabled = false;
    saveJobs(jobs);
    clearTimer(jobId);
    console.error(`[scheduler] Job "${jobId}" permanently disabled: ${result.error}`);
    deliverMessage(job.channel, job.user, job.agent,
      `[${job.name}] ⚠ Job failed and was disabled: ${result.error}`
    ).catch(() => {}); // best-effort, don't fail the handler if delivery fails too
  } else {
    // Transient error — retry with backoff
    const retryCount = (retryCounters.get(jobId) ?? 0) + 1;
    retryCounters.set(jobId, retryCount);

    // One-shot jobs get max 3 retries
    if (job.schedule.at && retryCount > 3) {
      job.enabled = false;
      saveJobs(jobs);
      clearTimer(jobId);
      console.error(`[scheduler] One-shot job "${jobId}" disabled after ${retryCount} attempts`);
      deliverMessage(job.channel, job.user, job.agent,
        `[${job.name}] ⚠ Job failed after ${retryCount} attempts and was disabled: ${result.error}`
      ).catch(() => {}); // best-effort
      return;
    }

    // Schedule retry with exponential backoff
    const backoffIdx = Math.min(retryCount - 1, BACKOFF_SCHEDULE.length - 1);
    const delayMs = BACKOFF_SCHEDULE[backoffIdx];
    console.log(`[scheduler] Retrying "${jobId}" in ${delayMs / 1000}s (attempt ${retryCount})`);
    queue.enqueue({ jobId, delayMs });
  }
}

// ---------------------------------------------------------------------------
// Heartbeat processor
// ---------------------------------------------------------------------------

/**
 * Process a heartbeat job. Builds a synthetic ScheduledJob from the
 * heartbeat.md content and runs it as a main-session job.
 */
async function processHeartbeat(jobId: string): Promise<void> {
  const agentId = heartbeatAgentId(jobId);
  const agentConfig = config.agents[agentId];
  if (!agentConfig) return;

  const prompt = buildHeartbeatPrompt(agentId);
  if (!prompt) return;

  // Build a synthetic job for the runner
  const firstUserId = Object.keys(config.users)[0] ?? "owner";

  // Find the first channel this agent is bound to for delivery
  let channel = "telegram"; // default
  for (const [channelName, bindings] of Object.entries(config.bindings)) {
    if (bindings[agentId]) {
      channel = channelName;
      break;
    }
  }

  const syntheticJob: ScheduledJob = {
    name: `Heartbeat: ${agentConfig.name}`,
    agent: agentId,
    schedule: { every: config.heartbeat.every },
    prompt,
    channel,
    user: firstUserId,
    isolated: false, // heartbeat runs in main session
    enabled: true,
    deleteAfterRun: false,
    createdBy: "heartbeat",
    createdAt: "",
  };

  const result = await executeJob(jobId, syntheticJob, true);

  if (result.status === "error") {
    console.error(`[heartbeat] Agent ${agentId} failed:`, result.error);
  } else if (result.suppressed) {
    console.log(`[heartbeat] Agent ${agentId}: nothing to report`);
  } else {
    console.log(`[heartbeat] Agent ${agentId}: message delivered=${result.delivered}`);
  }
}

// ---------------------------------------------------------------------------
// Public API — CRUD operations
// ---------------------------------------------------------------------------

/**
 * Start the scheduler. Loads jobs from disk, creates timers for all enabled
 * jobs, and starts the heartbeat timer.
 */
export function startScheduler(): void {
  if (!config.scheduler.enabled) {
    console.log("[scheduler] Disabled in config");
    return;
  }

  jobs = loadJobs();
  queue = new JobQueue(processJob);

  const jobCount = Object.keys(jobs).length;
  const enabledCount = Object.values(jobs).filter((j) => j.enabled).length;
  console.log(`[scheduler] Loaded ${jobCount} jobs (${enabledCount} enabled)`);

  // Create timers for all enabled jobs — invalid schedules are logged and
  // disabled rather than crashing the process (e.g. a job saved before
  // validation was added, or a manually edited schedules/jobs.json)
  for (const [jobId, job] of Object.entries(jobs)) {
    if (job.enabled) {
      try {
        createTimer(jobId, job);
      } catch (err) {
        console.error(`[scheduler] Skipping "${jobId}": ${(err as Error).message} — disabling job`);
        job.enabled = false;
      }
    }
  }
  saveJobs(jobs);

  // Start heartbeat
  startHeartbeat(queue);

  console.log("[scheduler] Started");
}

/** Stop the scheduler. Cancels all timers and the heartbeat. */
export function stopScheduler(): void {
  for (const jobId of timers.keys()) {
    clearTimer(jobId);
  }
  stopHeartbeat();
  console.log("[scheduler] Stopped");
}

/** Create a new job. Returns the generated jobId. */
export function createJob(input: {
  name: string;
  agent: string;
  schedule: Schedule;
  prompt: string;
  channel: string;
  user?: string;
  isolated?: boolean;
  deleteAfterRun?: boolean;
  createdBy?: string;
}): string {
  // Validate schedule format before persisting — prevents broken jobs from
  // being saved to schedules/jobs.json (e.g. "5min" instead of "5m")
  const normalizedSchedule = normalizeSchedule(input.schedule);
  validateSchedule(normalizedSchedule);

  const existingIds = new Set(Object.keys(jobs));
  const jobId = generateJobId(input.name, existingIds);

  const job: ScheduledJob = {
    name: input.name,
    agent: input.agent,
    schedule: normalizedSchedule,
    prompt: input.prompt,
    channel: input.channel,
    user: input.user ?? Object.keys(config.users)[0] ?? "owner",
    isolated: input.isolated ?? true,
    enabled: true,
    deleteAfterRun: input.deleteAfterRun ?? false,
    createdBy: input.createdBy ?? "system",
    createdAt: new Date().toISOString(),
  };

  jobs[jobId] = job;
  saveJobs(jobs);
  createTimer(jobId, job);

  console.log(`[scheduler] Created job "${jobId}" (${input.name})`);
  return jobId;
}

/** Update an existing job's fields. Recreates the timer if schedule changed. */
export function updateJob(jobId: string, updates: Partial<ScheduledJob>): boolean {
  const job = jobs[jobId];
  if (!job) return false;

  const scheduleChanged = updates.schedule !== undefined;

  // Normalize and validate schedule if it's being updated
  if (updates.schedule) {
    updates.schedule = normalizeSchedule(updates.schedule);
    validateSchedule(updates.schedule);
  }

  Object.assign(job, updates);
  saveJobs(jobs);

  // Recreate timer if schedule or enabled state changed
  if (scheduleChanged || updates.enabled !== undefined) {
    clearTimer(jobId);
    if (job.enabled) {
      createTimer(jobId, job);
    }
  }

  console.log(`[scheduler] Updated job "${jobId}"`);
  return true;
}

/** Delete a job and its run history. */
export async function deleteJob(jobId: string): Promise<boolean> {
  if (!jobs[jobId]) return false;

  clearTimer(jobId);
  delete jobs[jobId];
  saveJobs(jobs);
  deleteRunHistory(jobId);
  retryCounters.delete(jobId);

  console.log(`[scheduler] Deleted job "${jobId}"`);
  return true;
}

/** Enable a disabled job and start its timer. */
export function enableJob(jobId: string): boolean {
  const job = jobs[jobId];
  if (!job) return false;

  job.enabled = true;
  delete job.completedAt;
  saveJobs(jobs);
  createTimer(jobId, job);

  console.log(`[scheduler] Enabled job "${jobId}"`);
  return true;
}

/** Disable a job and cancel its timer. */
export function disableJob(jobId: string): boolean {
  const job = jobs[jobId];
  if (!job) return false;

  job.enabled = false;
  saveJobs(jobs);
  clearTimer(jobId);

  console.log(`[scheduler] Disabled job "${jobId}"`);
  return true;
}

/** List all jobs with their next run times. */
export function listJobs(): Array<{
  jobId: string;
  job: ScheduledJob;
  nextRun: string | null;
}> {
  return Object.entries(jobs).map(([jobId, job]) => {
    let nextRun: string | null = null;

    if (job.enabled) {
      const timer = timers.get(jobId);
      if (timer instanceof Cron) {
        const next = timer.nextRun();
        nextRun = next ? next.toISOString() : null;
      } else {
        const next = nextRunTimes.get(jobId);
        nextRun = next ? next.toISOString() : null;
      }
    }

    return { jobId, job, nextRun };
  });
}

/** Get a single job by ID. */
export function getJob(jobId: string): ScheduledJob | undefined {
  return jobs[jobId];
}

/** Get run history for a job. */
export function getRunHistory(jobId: string, limit = 50) {
  return readRunHistory(jobId, limit);
}

/** Trigger a job immediately (bypass its schedule). */
export function triggerJob(jobId: string): boolean {
  const job = jobs[jobId];
  if (!job) return false;

  console.log(`[scheduler] Manual trigger: "${jobId}"`);
  queue.enqueue({ jobId });
  return true;
}

/** Get scheduler status for the status command. */
export function getSchedulerStatus() {
  const jobList = Object.entries(jobs);
  const enabled = jobList.filter(([, j]) => j.enabled).length;

  let nextRunJob: string | null = null;
  let nextRunTime: Date | null = null;

  for (const [jobId] of jobList) {
    const timer = timers.get(jobId);
    let next: Date | null | undefined;
    if (timer instanceof Cron) {
      next = timer.nextRun();
    } else {
      next = nextRunTimes.get(jobId) ?? null;
    }
    if (next && (!nextRunTime || next < nextRunTime)) {
      nextRunTime = next;
      nextRunJob = jobId;
    }
  }

  return {
    enabled: config.scheduler.enabled,
    jobs: { total: jobList.length, enabled },
    nextRun: nextRunTime ? { jobId: nextRunJob, time: nextRunTime.toISOString() } : null,
    queuePending: queue?.pending ?? 0,
    queueProcessing: queue?.isProcessing ?? false,
  };
}
