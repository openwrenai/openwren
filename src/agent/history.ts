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
 * Counts everything including JSON scaffolding (braces, quotes, role/content keys).
 * Kept as a reference — use estimateTokensContent() for a more accurate estimate.
 */
function estimateTokensJson(messages: Message[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

/**
 * Estimates token count by extracting only actual text content from messages.
 * Skips JSON scaffolding (braces, quotes, role/content keys) that Anthropic
 * doesn't tokenize, giving a more accurate estimate than estimateTokensJson().
 *
 * Handles both plain string content and MessageContent[] arrays (tool calls,
 * tool results, text blocks).
 */
function estimateTokensContent(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else {
      for (const block of msg.content) {
        if (block.text) chars += block.text.length;                        // text block
        if (block.input) chars += JSON.stringify(block.input).length;      // tool call args (structured, must stringify)
        if (block.content) chars += block.content.length;                  // tool result
      }
    }
  }
  return Math.ceil(chars / 4);
}

// Active estimator — swap to estimateTokensJson() if Anthropic counts JSON scaffolding too
export function estimateTokens(messages: Message[]): number {
  return estimateTokensContent(messages);
}

export interface CompactionResult {
  messages: Message[];
  compacted: boolean;       // true if compaction just ran
  nearThreshold: boolean;   // true if session is within 5% of compaction threshold
}

/**
 * Checks if compaction is needed and runs it if so.
 * Called at the start of every agent turn, before sending messages to the LLM.
 *
 * Three tiers (derived from thresholdPercent in config):
 * - Below (threshold - 5)%: no action
 * - Between (threshold - 5)% and threshold%: warning flag (nearThreshold)
 * - Above threshold%: compact all messages into a single summary
 *
 * Returns CompactionResult with messages + status flags for the channel layer.
 */
export async function compactIfNeeded(
  sessionKey: string,
  messages: Message[],
  provider: LLMProvider
): Promise<CompactionResult> {
  const { enabled, contextWindowTokens, thresholdPercent } = config.agent.compaction;
  if (!enabled || messages.length < 4) {
    return { messages, compacted: false, nearThreshold: false };
  }

  const threshold = Math.floor(contextWindowTokens * (thresholdPercent / 100));
  const warningThreshold = Math.floor(contextWindowTokens * ((thresholdPercent - 5) / 100));
  const estimated = estimateTokens(messages);

  if (estimated < warningThreshold) {
    return { messages, compacted: false, nearThreshold: false };
  }

  if (estimated < threshold) {
    console.log(`[compaction] Session ${sessionKey} at ~${estimated} tokens — approaching threshold (${threshold}). Warning.`);
    return { messages, compacted: false, nearThreshold: true };
  }

  console.log(`[compaction] Session ${sessionKey} at ~${estimated} tokens (threshold: ${threshold}). Compacting...`);

  // Summarize 100% of messages — session is replaced with a single summary.
  // The summary is assigned to role:user and will be merged with the next
  // incoming user message by Anthropic before being sent to the model.
  const summaryPrompt = `Summarize the following conversation. Preserve: key facts about the user, decisions made, tasks completed, open items, and any important context. Be concise.

Conversation:
${messages.map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n\n")}`;

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

  const compactedMessages = [summaryMessage];
  overwriteSession(sessionKey, compactedMessages);

  console.log(`[compaction] Done. Reduced ${messages.length} messages to 1 summary.`);

  return { messages: compactedMessages, compacted: true, nearThreshold: false };
}
