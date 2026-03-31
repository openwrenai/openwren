import * as fs from "fs";
import * as path from "path";
import { config, userSessionDir, userSessionPath, userSessionArchiveDir, agentJobSessionPath } from "../config";
import type { Message, LLMProvider } from "../providers";

// ---------------------------------------------------------------------------
// Timestamped message — stored in JSONL with UTC milliseconds
// ---------------------------------------------------------------------------

export interface TimestampedMessage extends Message {
  timestamp: number; // UTC milliseconds (Date.now())
}

// ---------------------------------------------------------------------------
// Session file paths — user-scoped layout
// ---------------------------------------------------------------------------

/**
 * Returns the directory for a user's sessions.
 * Path: {workspace}/sessions/{userId}/
 */
function sessionDir(userId: string, _agentId: string): string {
  return userSessionDir(userId);
}

/**
 * Returns the main session file path.
 * Path: {workspace}/sessions/{userId}/main.jsonl
 */
function sessionPath(userId: string, _agentId: string): string {
  return userSessionPath(userId);
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Reads the active JSONL session file and returns all valid messages.
 * Malformed lines (e.g. from a partial write on crash) are silently skipped.
 * Timestamps are preserved on loaded messages if present.
 */
export function loadSession(userId: string, agentId: string): TimestampedMessage[] {
  const filePath = sessionPath(userId, agentId);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  const messages: TimestampedMessage[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.role && parsed.content !== undefined) {
        messages.push(parsed as TimestampedMessage);
      }
    } catch {
      // Malformed line — skip silently (handles partial writes on crash)
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

/**
 * Appends a single message to the active session file.
 * Automatically adds a UTC timestamp (milliseconds) to every message.
 * Ensures the session directory exists before writing.
 */
export function appendMessage(userId: string, agentId: string, message: Message): void {
  const dir = sessionDir(userId, agentId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timestamped: TimestampedMessage = {
    timestamp: Date.now(),
    ...message,
  };
  const line = JSON.stringify(timestamped) + "\n";
  fs.appendFileSync(sessionPath(userId, agentId), line, "utf-8");
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Deletes the active session file, starting fresh.
 */
export function resetSession(userId: string, agentId: string): void {
  const filePath = sessionPath(userId, agentId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// ---------------------------------------------------------------------------
// Idle reset check
// ---------------------------------------------------------------------------

/**
 * Returns true if the session has been idle longer than config.session.idleResetMinutes.
 * Determined by the mtime of the session file.
 */
export function isSessionIdleExpired(userId: string, agentId: string): boolean {
  const idleMinutes = config.session?.idleResetMinutes;
  if (!idleMinutes) return false;

  const filePath = sessionPath(userId, agentId);
  if (!fs.existsSync(filePath)) return false;

  const { mtimeMs } = fs.statSync(filePath);
  const idleMs = idleMinutes * 60 * 1000;
  return Date.now() - mtimeMs > idleMs;
}

// ---------------------------------------------------------------------------
// Daily reset check
// ---------------------------------------------------------------------------

/**
 * Returns true if a daily reset is due for this session.
 * Checks if the last message was written before today's reset time.
 * Uses the configured timezone for "today" calculation.
 *
 * config.session.dailyResetTime = "" → disabled (returns false)
 * config.session.dailyResetTime = "04:00" → reset at 04:00 in configured timezone
 */
export function isDailyResetDue(userId: string, agentId: string): boolean {
  const resetTime = config.session?.dailyResetTime;
  if (!resetTime) return false;

  const filePath = sessionPath(userId, agentId);
  if (!fs.existsSync(filePath)) return false;

  const [hours, minutes] = resetTime.split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) return false;

  const { mtimeMs } = fs.statSync(filePath);
  const now = new Date();
  const tz = config.timezone;

  // Build today's reset time in the configured timezone
  // Use Intl to get the current date parts in the target timezone
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayStr = formatter.format(now); // "2026-02-22"
  const resetDate = new Date(`${todayStr}T${resetTime}:00`);

  // Adjust for timezone offset — convert the "local" reset time to UTC
  const tzOffset = getTimezoneOffsetMs(tz, resetDate);
  const resetUtcMs = resetDate.getTime() - tzOffset;

  // If we haven't passed today's reset time yet, use yesterday's
  const effectiveResetMs = now.getTime() >= resetUtcMs
    ? resetUtcMs
    : resetUtcMs - 24 * 60 * 60 * 1000;

  // Reset is due if the file was last modified before the effective reset time
  return mtimeMs < effectiveResetMs;
}

/**
 * Gets the UTC offset in milliseconds for a timezone at a given date.
 */
function getTimezoneOffsetMs(tz: string, date: Date): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: tz });
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}

// ---------------------------------------------------------------------------
// Session locking (mutex)
// ---------------------------------------------------------------------------

const locks = new Map<string, Promise<void>>();

export function withSessionLock<T>(
  lockKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = locks.get(lockKey) ?? Promise.resolve();

  let releaseLock!: () => void;
  const next = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  locks.set(lockKey, next);

  return previous.then(async () => {
    try {
      return await fn();
    } finally {
      releaseLock();
    }
  });
}

// ---------------------------------------------------------------------------
// Timestamp injection for LLM pre-processing
// ---------------------------------------------------------------------------

/**
 * Creates a deep copy of messages with human-readable timestamps prepended.
 * Converts UTC ms → [HH:MM] in the configured timezone.
 * Only transforms the in-memory copy — never modifies stored JSONL.
 *
 * Only injects into string content (user/assistant text messages).
 * Tool calls and tool results are left untouched.
 */
export function injectTimestamps(messages: TimestampedMessage[], timezone: string): Message[] {
  return messages.map((msg) => {
    if (!msg.timestamp || typeof msg.content !== "string") {
      // No timestamp or structured content (tool calls/results) — return as plain Message
      return { role: msg.role, content: msg.content };
    }

    const d = new Date(msg.timestamp);
    const month = d.toLocaleDateString("en-US", { timeZone: timezone, month: "short" });
    const day = d.toLocaleDateString("en-US", { timeZone: timezone, day: "numeric" });
    const time = d.toLocaleTimeString("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    return {
      role: msg.role,
      content: `[${month} ${day}, ${time}] ${msg.content}`,
    };
  });
}

// ---------------------------------------------------------------------------
// Context compaction
// ---------------------------------------------------------------------------

/**
 * Estimates token count by extracting only actual text content from messages.
 */
function estimateTokensContent(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else {
      for (const block of msg.content) {
        if (block.type === "text") chars += block.text.length;
        if (block.type === "tool-call") chars += JSON.stringify(block.input).length;
        if (block.type === "tool-result") chars += block.output.value.length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

export function estimateTokens(messages: Message[]): number {
  return estimateTokensContent(messages);
}

export interface CompactionResult {
  messages: TimestampedMessage[];
  compacted: boolean;
  nearThreshold: boolean;
}

/**
 * Archives the current main.jsonl and writes compacted messages as the new main.
 * Archive goes to sessions/{userId}/archives/main-{timestamp}.jsonl.
 */
function archiveAndWrite(userId: string, agentId: string, compactedMessages: TimestampedMessage[]): void {
  const activePath = sessionPath(userId, agentId);
  const archiveDir = userSessionArchiveDir(userId);

  // Ensure archive directory exists
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  // Move main.jsonl to timestamped archive file (UTC)
  if (fs.existsSync(activePath)) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const h = String(now.getUTCHours()).padStart(2, "0");
    const mi = String(now.getUTCMinutes()).padStart(2, "0");
    const s = String(now.getUTCSeconds()).padStart(2, "0");
    const archiveName = `main-${y}-${mo}-${d}_${h}-${mi}-${s}.jsonl`;
    const archivePath = path.join(archiveDir, archiveName);
    fs.renameSync(activePath, archivePath);
    console.log(`[compaction] Archived session to archives/${archiveName}`);
  }

  // Write new main.jsonl with compacted messages
  const content = compactedMessages.map((m) => JSON.stringify(m)).join("\n") + "\n";
  fs.writeFileSync(activePath, content, "utf-8");
}

/**
 * Checks if compaction is needed and runs it if so.
 * Archives the old session before writing the compacted summary.
 */
export async function compactIfNeeded(
  userId: string,
  agentId: string,
  messages: TimestampedMessage[],
  provider: LLMProvider
): Promise<CompactionResult> {
  const { enabled, contextWindowTokens, thresholdPercent } = config.agent.compaction;
  if (!enabled || messages.length < 4) {
    return { messages, compacted: false, nearThreshold: false };
  }

  const sessionLabel = `${userId}/${agentId}`;
  const threshold = Math.floor(contextWindowTokens * (thresholdPercent / 100));
  const warningThreshold = Math.floor(contextWindowTokens * ((thresholdPercent - 5) / 100));
  const estimated = estimateTokens(messages);

  if (estimated < warningThreshold) {
    return { messages, compacted: false, nearThreshold: false };
  }

  if (estimated < threshold) {
    console.log(`[compaction] Session ${sessionLabel} at ~${estimated} tokens — approaching threshold (${threshold}). Warning.`);
    return { messages, compacted: false, nearThreshold: true };
  }

  console.log(`[compaction] Session ${sessionLabel} at ~${estimated} tokens (threshold: ${threshold}). Compacting...`);

  const summaryPrompt = `Summarize the following conversation. Preserve: key facts about the user, decisions made, tasks completed, open items, and any important context. Be concise.

Conversation:
${messages.map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n\n")}`;

  const summaryResponse = await provider.chat(
    "You are a helpful assistant that summarizes conversations accurately and concisely.",
    [{ role: "user", content: summaryPrompt }],
    []
  );

  const summaryText = summaryResponse.type === "text" && summaryResponse.text
    ? summaryResponse.text
    : "Previous conversation summarized (summary unavailable).";

  const summaryMessage: TimestampedMessage = {
    timestamp: Date.now(),
    role: "user",
    content: `[Previous conversation summary]\n${summaryText}`,
  };

  const compactedMessages = [summaryMessage];
  archiveAndWrite(userId, agentId, compactedMessages);

  console.log(`[compaction] Done. Reduced ${messages.length} messages to 1 summary.`);

  return { messages: compactedMessages, compacted: true, nearThreshold: false };
}

// ---------------------------------------------------------------------------
// Isolated job sessions — separate session files for scheduled jobs
// ---------------------------------------------------------------------------

/**
 * Returns the file path for an isolated job session.
 * Path: {workspace}/agents/{agentId}/sessions/jobs/{jobId}.jsonl
 *
 * Scoped to agent — the job session lives under the agent that runs it.
 */
export function jobSessionFilePath(agentId: string, jobId: string): string {
  return agentJobSessionPath(agentId, jobId);
}

/**
 * Load messages from a specific file path.
 * Used for isolated job sessions where the path doesn't follow the
 * standard user/agent layout.
 */
export function loadFromFile(filePath: string): TimestampedMessage[] {
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  const messages: TimestampedMessage[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.role && parsed.content !== undefined) {
        messages.push(parsed as TimestampedMessage);
      }
    } catch {
      // Malformed line — skip silently
    }
  }

  return messages;
}

/**
 * Append a message to a specific file path.
 * Creates the parent directory if it doesn't exist.
 */
export function appendToFile(filePath: string, message: Message): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timestamped: TimestampedMessage = {
    timestamp: Date.now(),
    ...message,
  };
  fs.appendFileSync(filePath, JSON.stringify(timestamped) + "\n", "utf-8");
}

/**
 * Prune an isolated job session to keep only the last N runs.
 * A "run" is identified by a user message with string content (the job prompt).
 * Tool results (role:user with array content) don't count as run starts.
 */
export function pruneJobSession(filePath: string, maxRuns: number): void {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trimEnd().split("\n").filter(Boolean);

  // Find the line index where each run starts
  const runStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const msg = JSON.parse(lines[i]);
      if (msg.role === "user" && typeof msg.content === "string") {
        runStarts.push(i);
      }
    } catch { /* skip malformed */ }
  }

  if (runStarts.length <= maxRuns) return;

  // Keep from the (total - maxRuns)th run start onward
  const keepFrom = runStarts[runStarts.length - maxRuns];
  const pruned = lines.slice(keepFrom);
  fs.writeFileSync(filePath, pruned.join("\n") + "\n", "utf-8");
}
