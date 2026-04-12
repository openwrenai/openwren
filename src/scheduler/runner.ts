/**
 * Job runner — executes a single scheduled job.
 *
 * Resolves the agent config, creates the appropriate session (isolated or main),
 * calls the agent loop, checks for HEARTBEAT_OK suppression, delivers the
 * response to the user's channel, and logs the run to history.
 */

import { config } from "../config";
import { runAgentLoop } from "../agent/loop";
import type { RunLoopOptions } from "../agent/loop";
import { jobSessionFilePath, pruneJobSession, appendMessage } from "../agent/history";
import { deliverMessage } from "../channels";
import { bus } from "../events";
import type { ScheduledJob, RunEntry } from "./store";
import { appendRunEntry, pruneRunHistory } from "./store";

/** Sentinel value the agent returns when a heartbeat has nothing to report. */
const HEARTBEAT_OK = "HEARTBEAT_OK";

export interface RunResult {
  status: "ok" | "error";
  text: string;
  delivered: boolean;
  suppressed?: string;
  durationMs: number;
  error?: string;
  errorType?: "transient" | "permanent";
}

/**
 * Classify an error as transient (retry-worthy) or permanent (disable the job).
 *
 * Transient: rate limits, timeouts, temporary server errors.
 * Permanent: auth failures, validation errors, non-recoverable faults.
 */
export function classifyError(err: Error): "transient" | "permanent" {
  const msg = err.message.toLowerCase();

  // Transient patterns — worth retrying
  if (msg.includes("rate") || msg.includes("429")) return "transient";
  if (msg.includes("timeout") || msg.includes("timed out")) return "transient";
  if (msg.includes("overload") || msg.includes("529")) return "transient";
  if (msg.includes("5xx") || msg.includes("500") || msg.includes("502") || msg.includes("503")) return "transient";
  if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("network")) return "transient";

  // Permanent patterns — don't retry, disable the job
  if (msg.includes("auth") || msg.includes("401") || msg.includes("403")) return "permanent";
  if (msg.includes("invalid") || msg.includes("validation")) return "permanent";

  // Default to transient — better to retry than to silently disable
  return "transient";
}

/**
 * Execute a single scheduled job.
 *
 * @param jobId - The job key in schedules/jobs.json
 * @param job - The job definition
 * @param isHeartbeat - If true, the job is a heartbeat run (suppress HEARTBEAT_OK)
 * @returns RunResult with status, delivery info, and timing
 */
export async function executeJob(
  jobId: string,
  job: ScheduledJob,
  isHeartbeat = false
): Promise<RunResult> {
  const startMs = Date.now();

  // Resolve agent config — bail if agent doesn't exist
  const agentConfig = config.agents[job.agent];
  if (!agentConfig) {
    const result: RunResult = {
      status: "error",
      text: "",
      delivered: false,
      durationMs: Date.now() - startMs,
      error: `Unknown agent: "${job.agent}"`,
      errorType: "permanent",
    };
    logRun(jobId, result);
    return result;
  }

  try {
    // Build prompt and loop options based on isolation mode
    let prompt: string;
    let loopOpts: RunLoopOptions | undefined;

    const usageContext = {
      source: "job" as const,
      sourceId: jobId,
      userId: job.user,
      sessionId: job.isolated ? `job:${jobId}` : "main",
    };

    if (job.isolated) {
      // Isolated: use separate job session file, no maintenance, no store prefix
      const sessionFile = jobSessionFilePath(job.agent, jobId);
      prompt = job.prompt;
      loopOpts = { sessionFile, skipMaintenance: true, channel: "scheduler", usageContext };
    } else {
      // Main session: prefix prompt for traceability, prefix response for display
      prompt = `[${job.name}] ${job.prompt}`;
      loopOpts = { storePrefix: `[${job.name}] `, channel: "scheduler", usageContext };
    }

    const loopResult = await runAgentLoop(
      job.user,
      job.agent,
      agentConfig,
      prompt,
      undefined, // No confirm callback — scheduled jobs don't get user confirmation
      true,      // quiet=true — suppresses per-skill log lines on every job fire
      loopOpts,
    );

    const rawText = loopResult.text;
    const deliveryText = `[${job.name}] ${rawText}`;
    const durationMs = Date.now() - startMs;

    // Emit bus event so WebUI picks up the job result live
    bus.emit("message_out", {
      channel: "scheduler",
      userId: job.user,
      agentId: job.agent,
      agentName: agentConfig.name,
      text: rawText,
      compacted: loopResult.compacted,
      nearThreshold: loopResult.nearThreshold,
      timestamp: Date.now(),
    });

    // Prune isolated job session if needed
    if (job.isolated) {
      pruneJobSession(
        jobSessionFilePath(job.agent, jobId),
        config.scheduler.runHistory.sessionRetention,
      );

      // Persist isolated job messages to main session for WebUI display.
      // Marked isolated: true so loadSession() filters them out before sending to LLM.
      appendMessage(job.user, job.agent, {
        role: "user",
        content: `[${job.name}] ${job.prompt}`,
        channel: "scheduler",
        isolated: true,
      });
      appendMessage(job.user, job.agent, {
        role: "assistant",
        content: rawText,
        channel: "scheduler",
        isolated: true,
      });
    }

    // Check for HEARTBEAT_OK suppression
    if (isHeartbeat && rawText.includes(HEARTBEAT_OK)) {
      const result: RunResult = {
        status: "ok",
        text: rawText,
        delivered: false,
        suppressed: HEARTBEAT_OK,
        durationMs,
      };
      logRun(jobId, result);

      bus.emit("schedule_run", {
        jobId, agentId: job.agent, agentName: agentConfig.name,
        status: "ok", suppressed: true, timestamp: Date.now(),
      });

      return result;
    }

    // Deliver to the user's channel (always with [Job Name] prefix)
    let delivered = false;
    try {
      delivered = await deliverMessage(job.channel, job.user, job.agent, deliveryText);
    } catch (deliveryErr) {
      console.error(`[scheduler] Delivery failed for job "${jobId}":`, deliveryErr);
    }

    const result: RunResult = {
      status: "ok",
      text: rawText,
      delivered,
      durationMs,
    };
    logRun(jobId, result);

    bus.emit("schedule_run", {
      jobId, agentId: job.agent, agentName: agentConfig.name,
      status: "ok", suppressed: false, timestamp: Date.now(),
    });

    return result;
  } catch (err) {
    // Catches any unhandled error from the agent loop, delivery, or pruning.
    // Classified as "transient" (retry-worthy: rate limits, timeouts, network)
    // or "permanent" (disable the job: auth failures, validation errors).
    // The caller (processJob in index.ts) uses errorType to decide whether
    // to retry with backoff or auto-disable the job.
    const error = err as Error;
    const errorType = classifyError(error);
    const durationMs = Date.now() - startMs;

    console.error(`[scheduler] Job "${jobId}" failed (${errorType}):`, error.message);

    const result: RunResult = {
      status: "error",
      text: "",
      delivered: false,
      durationMs,
      error: error.message,
      errorType,
    };

    // Log to run history JSONL for debugging and CLI `openwren schedule history`
    logRun(jobId, result);

    // Emit to event bus so WS clients (CLI status, future WebUI) can react
    bus.emit("schedule_error", {
      jobId, agentId: job.agent, agentName: agentConfig.name,
      error: error.message, errorType, timestamp: Date.now(),
    });

    return result;
  }
}

/**
 * Append a run entry to the job's history file and prune if needed.
 */
function logRun(jobId: string, result: RunResult, retry?: number): void {
  const entry: RunEntry = {
    ts: Date.now(),
    status: result.status,
    durationMs: result.durationMs,
    delivered: result.delivered,
  };

  if (result.suppressed) entry.suppressed = result.suppressed;
  if (result.error) entry.error = result.error;
  if (result.errorType) entry.errorType = result.errorType;
  if (retry !== undefined) entry.retry = retry;

  appendRunEntry(jobId, entry);
  pruneRunHistory(jobId, config.scheduler.runHistory.logRetention);
}
