import { config, AgentConfig } from "../config";
import { createProviderChain } from "../providers";
import type { Message } from "../providers";
import { loadSystemPrompt } from "./prompt";
import {
  loadSession,
  appendMessage,
  withSessionLock,
  isSessionIdleExpired,
  isDailyResetDue,
  resetSession,
  compactIfNeeded,
  estimateTokens,
  injectTimestamps,
  TimestampedMessage,
} from "./history";
import { getToolDefinitions, executeTool, ConfirmFn } from "../tools";

const MAX_ITERATIONS = config.agent?.maxIterations ?? 10;

export interface LoopResult {
  text: string;
  compacted: boolean;
  nearThreshold: boolean;
}

/**
 * Run one full agent turn for the given userId + agentId + message.
 * Handles session loading, locking, the ReAct loop, and session persistence.
 * Returns the reply text + compaction status flags.
 */
export async function runAgentLoop(
  userId: string,
  agentId: string,
  agentConfig: AgentConfig,
  userMessage: string,
  confirm?: ConfirmFn
): Promise<LoopResult> {
  return withSessionLock(userId, agentId, async () => {
    const provider = createProviderChain(agentId);
    const systemPrompt = loadSystemPrompt(agentId, agentConfig);
    const tools = getToolDefinitions();

    // Idle reset — if the session has been idle too long, start fresh
    if (isSessionIdleExpired(userId, agentId)) {
      console.log(`[loop] Session idle expired, resetting: ${userId}/${agentId}`);
      resetSession(userId, agentId);
    }

    // Daily reset — if we've crossed the daily reset boundary, start fresh
    if (isDailyResetDue(userId, agentId)) {
      console.log(`[loop] Daily reset triggered for: ${userId}/${agentId}`);
      resetSession(userId, agentId);
    }

    // Load existing history, compact if needed, then append the new user message
    let messages: TimestampedMessage[] = loadSession(userId, agentId);
    const compactionResult = await compactIfNeeded(userId, agentId, messages, provider);
    messages = compactionResult.messages;

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
    appendMessage(userId, agentId, userMsg);

    // ReAct loop
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      console.log(`[loop] Iteration ${iterations}/${MAX_ITERATIONS}`);

      // Inject human-readable timestamps into a copy for the LLM — stored messages are untouched
      const llmMessages = injectTimestamps(messages, config.timezone);

      const response = await provider.chat(systemPrompt, llmMessages, tools);

      if (response.type === "error") {
        return {
          text: `Sorry, I ran into an error: ${response.error}`,
          compacted: compactionResult.compacted,
          nearThreshold: compactionResult.nearThreshold,
        };
      }

      // Plain text response — we're done
      if (response.type === "text") {
        const assistantMsg: TimestampedMessage = {
          timestamp: Date.now(),
          role: "assistant",
          content: response.text ?? "",
        };
        messages.push(assistantMsg);
        appendMessage(userId, agentId, assistantMsg);
        return {
          text: response.text ?? "",
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
        appendMessage(userId, agentId, assistantToolMsg);

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
        appendMessage(userId, agentId, toolResultMsg);

        continue;
      }
    }

    // Hit the iteration cap
    const capMsg = `I got stuck in a loop after ${MAX_ITERATIONS} iterations and couldn't complete your request. Please try rephrasing or breaking it into smaller steps.`;
    const assistantCapMsg: TimestampedMessage = { timestamp: Date.now(), role: "assistant", content: capMsg };
    messages.push(assistantCapMsg);
    appendMessage(userId, agentId, assistantCapMsg);
    return {
      text: capMsg,
      compacted: compactionResult.compacted,
      nearThreshold: compactionResult.nearThreshold,
    };
  });
}
