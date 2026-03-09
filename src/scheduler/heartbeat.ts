/**
 * Heartbeat — periodic check-in where agents read their heartbeat.md checklist.
 *
 * The heartbeat timer fires at a configured interval (default 30m). For each
 * agent that has a heartbeat.md file, it enqueues a main-session job into
 * the scheduler queue. The agent reads the checklist, processes it, and either
 * sends a message to the user or responds with HEARTBEAT_OK (suppressed).
 *
 * Active hours gating: heartbeat is skipped entirely if the current time
 * (in the configured timezone) falls outside the active hours window.
 *
 * Heartbeat.md files are read fresh each cycle — never cached. Editing the
 * file takes effect on the next cycle, same as soul files.
 */

import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { parseInterval } from "./store";
import { isWithinActiveHours } from "../utils/timezone";
import type { JobQueue } from "./queue";

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** Internal job IDs for heartbeat runs, keyed by agentId. */
const HEARTBEAT_PREFIX = "heartbeat-";

/**
 * Get the heartbeat.md path for an agent.
 * Returns null if the file doesn't exist — agents without a heartbeat.md
 * are silently skipped.
 */
function heartbeatPath(agentId: string): string | null {
  const filePath = path.join(config.workspaceDir, "agents", agentId, "heartbeat.md");
  return fs.existsSync(filePath) ? filePath : null;
}

/**
 * Start the heartbeat timer. Called by the scheduler on startup.
 *
 * Each cycle:
 * 1. Check active hours — skip if outside window
 * 2. Scan all agents for heartbeat.md files
 * 3. For each agent with a heartbeat.md, enqueue a main-session job
 */
export function startHeartbeat(queue: JobQueue): void {
  if (!config.heartbeat.enabled) {
    console.log("[heartbeat] Disabled in config");
    return;
  }

  const intervalMs = parseInterval(config.heartbeat.every);

  heartbeatTimer = setInterval(() => {
    // Check active hours before doing anything
    const { start, end } = config.heartbeat.activeHours;
    if (!isWithinActiveHours(start, end, config.timezone)) {
      return; // outside active hours, skip this cycle
    }

    // Scan all agents for heartbeat.md files
    for (const agentId of Object.keys(config.agents)) {
      const hbPath = heartbeatPath(agentId);
      if (!hbPath) continue;

      // Read the checklist fresh each cycle (never cached)
      let checklist: string;
      try {
        checklist = fs.readFileSync(hbPath, "utf-8").trim();
      } catch (err) {
        console.error(`[heartbeat] Failed to read ${hbPath}:`, (err as Error).message);
        continue;
      }

      if (!checklist) continue;

      // Enqueue as a heartbeat job
      // The job ID is "heartbeat-{agentId}" so the runner knows to
      // check for HEARTBEAT_OK suppression
      const jobId = `${HEARTBEAT_PREFIX}${agentId}`;
      console.log(`[heartbeat] Enqueuing heartbeat for ${agentId}`);
      queue.enqueue({ jobId });
    }
  }, intervalMs);

  console.log(`[heartbeat] Started (every ${config.heartbeat.every})`);
}

/** Stop the heartbeat timer. Called by the scheduler on shutdown. */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log("[heartbeat] Stopped");
  }
}

/**
 * Check if a jobId is a heartbeat job.
 * Heartbeat jobs use the ID format "heartbeat-{agentId}".
 */
export function isHeartbeatJob(jobId: string): boolean {
  return jobId.startsWith(HEARTBEAT_PREFIX);
}

/**
 * Get the agentId from a heartbeat jobId.
 * "heartbeat-atlas" → "atlas"
 */
export function heartbeatAgentId(jobId: string): string {
  return jobId.slice(HEARTBEAT_PREFIX.length);
}

/**
 * Build the heartbeat prompt for an agent.
 * Reads heartbeat.md and wraps it with instructions for HEARTBEAT_OK suppression.
 */
export function buildHeartbeatPrompt(agentId: string): string | null {
  const hbPath = heartbeatPath(agentId);
  if (!hbPath) return null;

  try {
    const checklist = fs.readFileSync(hbPath, "utf-8").trim();
    if (!checklist) return null;

    return [
      "[Heartbeat Check-In]",
      "",
      "Review the following checklist. If ANY item produces content to deliver to the user, respond with that content.",
      "Only respond with exactly HEARTBEAT_OK if EVERY item on the checklist is clear and there is nothing at all to send.",
      "Never combine content with HEARTBEAT_OK — either deliver content OR respond HEARTBEAT_OK, never both.",
      "",
      "---",
      "",
      checklist,
    ].join("\n");
  } catch {
    return null;
  }
}
