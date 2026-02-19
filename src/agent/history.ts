import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import type { Message, LLMProvider } from "../providers";

// ---------------------------------------------------------------------------
// Session file path
// ---------------------------------------------------------------------------

function sessionPath(sessionKey: string): string {
  // sessionKey may contain ":" (e.g. "agent:main") — replace with "-" for filename
  const safeKey = sessionKey.replace(/:/g, "-");
  return path.join(config.workspaceDir, "sessions", `${safeKey}.jsonl`);
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Reads a JSONL session file and returns all valid messages.
 * Malformed lines (e.g. from a partial write on crash) are silently skipped.
 */
export function loadSession(sessionKey: string): Message[] {
  const filePath = sessionPath(sessionKey);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  const messages: Message[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.role && parsed.content !== undefined) {
        messages.push(parsed as Message);
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
 * Appends a single message to the session file.
 * Append-only — never rewrites the whole file (except during compaction).
 */
export function appendMessage(sessionKey: string, message: Message): void {
  const filePath = sessionPath(sessionKey);
  const line = JSON.stringify(message) + "\n";
  fs.appendFileSync(filePath, line, "utf-8");
}

// ---------------------------------------------------------------------------
// Overwrite (used by compaction only)
// ---------------------------------------------------------------------------

/**
 * Overwrites the entire session file with the given messages.
 * Only called during compaction — not during normal operation.
 */
export function overwriteSession(sessionKey: string, messages: Message[]): void {
  const filePath = sessionPath(sessionKey);
  const content = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Deletes the session file, starting fresh.
 */
export function resetSession(sessionKey: string): void {
  const filePath = sessionPath(sessionKey);
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
export function isSessionIdleExpired(sessionKey: string): boolean {
  const idleMinutes = config.session?.idleResetMinutes;
  if (!idleMinutes) return false;

  const filePath = sessionPath(sessionKey);
  if (!fs.existsSync(filePath)) return false;

  const { mtimeMs } = fs.statSync(filePath);
  const idleMs = idleMinutes * 60 * 1000;
  return Date.now() - mtimeMs > idleMs;
}

// ---------------------------------------------------------------------------
// Session locking (mutex)
// ---------------------------------------------------------------------------

/**
 * Per-session promise chain used as a mutex.
 * Any agent turn that wants to use a session chains onto the previous promise,
 * ensuring turns are serialized and never interleave reads/writes.
 */
const locks = new Map<string, Promise<void>>();

export function withSessionLock<T>(
  sessionKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = locks.get(sessionKey) ?? Promise.resolve();

  let releaseLock!: () => void;
  const next = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  locks.set(sessionKey, next);

  return previous.then(async () => {
    try {
      return await fn();
    } finally {
      releaseLock();
    }
  });
}

// ---------------------------------------------------------------------------
// Context compaction
// ---------------------------------------------------------------------------

/**
 * Estimates token count from raw JSON string length.
 * character count / 4 is a good enough approximation — fast, zero deps.
 */
function estimateTokens(messages: Message[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

/**
 * Checks if compaction is needed and runs it if so.
 * Called at the start of every agent turn, before sending messages to the LLM.
 *
 * Algorithm:
 * 1. Estimate token count of current messages
 * 2. If below threshold, return messages unchanged
 * 3. If above threshold:
 *    - Split messages in half — old and recent
 *    - Ask LLM to summarize the old half
 *    - Replace old half with a single synthetic summary message
 *    - Overwrite the session file
 * 4. Return the compacted messages
 */
export async function compactIfNeeded(
  sessionKey: string,
  messages: Message[],
  provider: LLMProvider
): Promise<Message[]> {
  const { enabled, contextWindowTokens, thresholdPercent } = config.agent.compaction;
  if (!enabled || messages.length < 4) return messages;

  const threshold = Math.floor(contextWindowTokens * (thresholdPercent / 100));
  const estimated = estimateTokens(messages);

  if (estimated < threshold) return messages;

  console.log(`[compaction] Session ${sessionKey} at ~${estimated} tokens (threshold: ${threshold}). Compacting...`);

  // Split in half — keep the recent half verbatim
  const splitAt = Math.floor(messages.length / 2);
  const oldMessages = messages.slice(0, splitAt);
  const recentMessages = messages.slice(splitAt);

  // Ask the LLM to summarize the old half
  const summaryPrompt = `The following is the first half of a conversation that needs to be summarized to save context space.
Write a concise summary that preserves: key facts about the user, decisions made, tasks completed, open items, and any important context.
Be thorough but concise — this summary will replace the original messages.

Conversation to summarize:
${oldMessages.map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n\n")}`;

  const summaryResponse = await provider.chat(
    "You are a helpful assistant that summarizes conversations accurately and concisely.",
    [{ role: "user", content: summaryPrompt }],
    [] // no tools needed for summarization
  );

  const summaryText = summaryResponse.type === "text" && summaryResponse.text
    ? summaryResponse.text
    : "Previous conversation summarized (summary unavailable).";

  const summaryMessage: Message = {
    role: "user",
    content: `[Previous conversation summary]\n${summaryText}`,
  };

  const compactedMessages = [summaryMessage, ...recentMessages];
  overwriteSession(sessionKey, compactedMessages);

  console.log(`[compaction] Done. Reduced from ${messages.length} to ${compactedMessages.length} messages.`);

  return compactedMessages;
}
