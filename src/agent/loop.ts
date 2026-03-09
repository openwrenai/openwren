import { config, AgentConfig } from "../config";
import { createProviderChain } from "../providers";
import type { Message } from "../providers";
import { loadSystemPrompt } from "./prompt";
import {
  loadSession,
  appendMessage,
  loadFromFile,
  appendToFile,
  withSessionLock,
  isSessionIdleExpired,
  isDailyResetDue,
  resetSession,
  compactIfNeeded,
  estimateTokens,
  injectTimestamps,
  TimestampedMessage,
  CompactionResult,
} from "./history";
import { getToolDefinitions, executeTool, ConfirmFn } from "../tools";

const MAX_ITERATIONS = config.agent?.maxIterations ?? 10;

/**
 * Cleans up model responses before saving and returning to the user.
 * 1. Strips <think>...</think> blocks (some models like qwen3.5 include reasoning)
 * 2. Strips injected timestamp prefixes that models sometimes echo back
 */
function cleanModelResponse(text: string): string {
  // Strip <think>...</think> blocks that some models include in their output
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Strip timestamp prefix the model may echo back: [Mar 5, 10:31]
  cleaned = cleaned.trimStart().replace(
    /^\[(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{2}:\d{2}\]\s*/,
    ""
  );
  return cleaned;
}

export interface RunLoopOptions {
  /** Override session file path (for isolated job sessions). */
  sessionFile?: string;
  /** Skip idle/daily resets and compaction (for job sessions). */
  skipMaintenance?: boolean;
  /** Prefix to prepend to stored assistant response (not returned in LoopResult.text). */
  storePrefix?: string;
}

export interface LoopResult {
  text: string;
  compacted: boolean;
  nearThreshold: boolean;
}

/**
 * Run one full agent turn for the given userId + agentId + message.
 * Handles session loading, locking, the ReAct loop, and session persistence.
 * Returns the reply text + compaction status flags.
 *
 * quiet=true suppresses per-skill catalog log lines. Pass true from the
 * scheduled job runner (runner.ts) to avoid noisy repetitive output on
 * frequent job fires. Interactive callers (channels) leave it false (default).
 */
export async function runAgentLoop(
  userId: string,
  agentId: string,
  agentConfig: AgentConfig,
  userMessage: string,
  confirm?: ConfirmFn,
  quiet = false,
  opts?: RunLoopOptions,
): Promise<LoopResult> {
  const lockKey = opts?.sessionFile ?? `${userId}/${agentId}`;

  return withSessionLock(lockKey, async () => {
    const provider = createProviderChain(agentId);
    const systemPrompt = loadSystemPrompt(agentId, agentConfig, quiet);
    const tools = getToolDefinitions();

    // Session I/O — either custom file (isolated jobs) or standard user/agent path
    const load = opts?.sessionFile
      ? () => loadFromFile(opts.sessionFile!)
      : () => loadSession(userId, agentId);
    const append = opts?.sessionFile
      ? (msg: Message) => appendToFile(opts.sessionFile!, msg)
      : (msg: Message) => appendMessage(userId, agentId, msg);

    // Maintenance (skip for isolated job sessions)
    if (!opts?.skipMaintenance) {
      if (isSessionIdleExpired(userId, agentId)) {
        console.log(`[loop] Session idle expired, resetting: ${userId}/${agentId}`);
        resetSession(userId, agentId);
      }

      if (isDailyResetDue(userId, agentId)) {
        console.log(`[loop] Daily reset triggered for: ${userId}/${agentId}`);
        resetSession(userId, agentId);
      }
    }

    // Load existing history, compact if needed, then append the new user message
    let messages: TimestampedMessage[] = load();
    let compactionResult: CompactionResult = { messages, compacted: false, nearThreshold: false };

    if (!opts?.skipMaintenance) {
      compactionResult = await compactIfNeeded(userId, agentId, messages, provider);
      messages = compactionResult.messages;
    }

    // Overflow check — reject if session + new message would exceed 100% of context window
    const { contextWindowTokens } = config.agent.compaction;
    const newMsgTokens = Math.ceil(userMessage.length / 4);
    const currentTokens = estimateTokens(messages);
    if (currentTokens + newMsgTokens > contextWindowTokens) {
      console.log(`[loop] Overflow rejected: session ${currentTokens} + message ${newMsgTokens} > ${contextWindowTokens}`);
      return {
        text: `Your message is too large for the current context window. Please send a shorter message.`,
        compacted: compactionResult.compacted,
        nearThreshold: false,
      };
    }

    const userMsg: TimestampedMessage = { timestamp: Date.now(), role: "user", content: userMessage };
    messages.push(userMsg);
    append(userMsg);

    // ReAct loop
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      console.log(`[loop] Iteration ${iterations}/${MAX_ITERATIONS}`);

      // Inject human-readable timestamps into a copy for the LLM — stored messages are untouched
      const llmMessages = injectTimestamps(messages, config.timezone);

      const response = await provider.chat(systemPrompt, llmMessages, tools);

      if (response.type === "error") {
        // Throw so callers can handle appropriately:
        // - Channels (Telegram/Discord/WS): catch and send a friendly error message
        // - Scheduler (runner.ts): catch, classify as transient/permanent, retry or disable
        throw new Error(response.error);
      }

      // Plain text response — we're done
      if (response.type === "text") {
        console.log(`[loop] Raw model response: ${(response.text ?? "").slice(0, 300)}`);
        const text = cleanModelResponse(response.text ?? "");
        const storedText = opts?.storePrefix ? opts.storePrefix + text : text;
        const assistantMsg: TimestampedMessage = {
          timestamp: Date.now(),
          role: "assistant",
          content: storedText,
        };
        messages.push(assistantMsg);
        append(assistantMsg);
        return {
          text, // Return raw text without prefix
          compacted: compactionResult.compacted,
          nearThreshold: compactionResult.nearThreshold,
        };
      }

      // Tool use — execute each tool call and feed results back
      if (response.type === "tool_use" && response.toolCalls?.length) {
        const assistantToolMsg: TimestampedMessage = {
          timestamp: Date.now(),
          role: "assistant",
          content: response.toolCalls.map((tc) => ({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        };
        messages.push(assistantToolMsg);
        append(assistantToolMsg);

        // Execute all tool calls in parallel and collect their results
        const toolResults = await Promise.all(
          response.toolCalls.map(async (tc) => {
            console.log(`[loop] Tool call: ${tc.name}`, tc.input);
            const result = await executeTool(tc.name, tc.input, agentId, confirm);
            console.log(`[loop] Tool result: ${tc.name} →`, result.slice(0, 100));
            return {
              type: "tool_result" as const,
              tool_use_id: tc.id,
              content: result,
            };
          })
        );

        const toolResultMsg: TimestampedMessage = {
          timestamp: Date.now(),
          role: "user",
          content: toolResults,
        };
        messages.push(toolResultMsg);
        append(toolResultMsg);

        continue;
      }
    }

    // Hit the iteration cap
    const capMsg = `I got stuck in a loop after ${MAX_ITERATIONS} iterations and couldn't complete your request. Please try rephrasing or breaking it into smaller steps.`;
    const assistantCapMsg: TimestampedMessage = { timestamp: Date.now(), role: "assistant", content: capMsg };
    messages.push(assistantCapMsg);
    append(assistantCapMsg);
    return {
      text: capMsg,
      compacted: compactionResult.compacted,
      nearThreshold: compactionResult.nearThreshold,
    };
  });
}
