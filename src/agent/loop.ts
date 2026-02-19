import { config, AgentConfig } from "../config";
import { createProvider } from "../providers";
import type { Message } from "../providers";
import { loadSystemPrompt } from "./prompt";
import {
  loadSession,
  appendMessage,
  withSessionLock,
  isSessionIdleExpired,
  resetSession,
  compactIfNeeded,
} from "./history";
import { getToolDefinitions, executeTool, ConfirmFn } from "../tools";

const MAX_ITERATIONS = config.agent?.maxIterations ?? 10;

/**
 * Run one full agent turn for the given agentId + message.
 * Handles session loading, locking, the ReAct loop, and session persistence.
 * Returns the final text reply to send back to the user.
 */
export async function runAgentLoop(
  agentId: string,
  agentConfig: AgentConfig,
  userMessage: string,
  confirm?: ConfirmFn
): Promise<string> {
  return withSessionLock(agentConfig.sessionPrefix, async () => {
    const provider = createProvider();
    const systemPrompt = loadSystemPrompt(agentId, agentConfig);
    const tools = getToolDefinitions();

    // Idle reset — if the session has been idle too long, start fresh
    if (isSessionIdleExpired(agentConfig.sessionPrefix)) {
      console.log(`[loop] Session idle expired, resetting: ${agentConfig.sessionPrefix}`);
      resetSession(agentConfig.sessionPrefix);
    }

    // Load existing history, compact if needed, then append the new user message
    let messages: Message[] = loadSession(agentConfig.sessionPrefix);
    messages = await compactIfNeeded(agentConfig.sessionPrefix, messages, provider);
    const userMsg: Message = { role: "user", content: userMessage };
    messages.push(userMsg);
    appendMessage(agentConfig.sessionPrefix, userMsg);

    // ReAct loop
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      console.log(`[loop] Iteration ${iterations}/${MAX_ITERATIONS}`);

      const response = await provider.chat(systemPrompt, messages, tools);

      if (response.type === "error") {
        return `Sorry, I ran into an error: ${response.error}`;
      }

      // Plain text response — we're done
      if (response.type === "text") {
        const assistantMsg: Message = {
          role: "assistant",
          content: response.text ?? "",
        };
        messages.push(assistantMsg);
        appendMessage(agentConfig.sessionPrefix, assistantMsg);
        return response.text ?? "";
      }

      // Tool use — execute each tool call and feed results back
      if (response.type === "tool_use" && response.toolCalls?.length) {
        // Append the assistant's tool_use turn to history
        const assistantToolMsg: Message = {
          role: "assistant",
          content: response.toolCalls.map((tc) => ({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        };
        messages.push(assistantToolMsg);
        appendMessage(agentConfig.sessionPrefix, assistantToolMsg);

        // Execute all tool calls and collect results
        const toolResults = await Promise.all(
          response.toolCalls.map(async (tc) => {
            console.log(`[loop] Tool call: ${tc.name}`, tc.input);
            const result = await executeTool(tc.name, tc.input, confirm);
            console.log(`[loop] Tool result: ${tc.name} →`, result.slice(0, 100));
            return {
              type: "tool_result" as const,
              tool_use_id: tc.id,
              content: result,
            };
          })
        );

        // Append tool results as a user message (Anthropic's format)
        const toolResultMsg: Message = {
          role: "user",
          content: toolResults,
        };
        messages.push(toolResultMsg);
        appendMessage(agentConfig.sessionPrefix, toolResultMsg);

        // Loop again — let the model process the tool results
        continue;
      }
    }

    // Hit the iteration cap
    const capMsg = `I got stuck in a loop after ${MAX_ITERATIONS} iterations and couldn't complete your request. Please try rephrasing or breaking it into smaller steps.`;
    const assistantCapMsg: Message = { role: "assistant", content: capMsg };
    messages.push(assistantCapMsg);
    appendMessage(agentConfig.sessionPrefix, assistantCapMsg);
    return capMsg;
  });
}
