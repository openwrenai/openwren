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

/**
 * Summarize tool input for logging — show paths/keys, not full file contents.
 */
function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  const fileTools = ["read_file", "write_file"];
  if (fileTools.includes(toolName)) {
    const path = input.path ?? input.file_path ?? "";
    return `{ path: "${path}" }`;
  }
  // For other tools, stringify but truncate
  const str = JSON.stringify(input);
  return str.length > 200 ? str.slice(0, 200) + "..." : str;
}

/**
 * Summarize tool result for logging — show path/size for file tools, truncate others.
 */
function summarizeToolResult(toolName: string, result: string): string {
  if (toolName === "read_file") {
    // Result starts with file content — just show size
    return `(${result.length} chars)`;
  }
  if (toolName === "write_file") {
    // Result is already a short confirmation like "File written: path (1234 bytes)"
    return result.slice(0, 200);
  }
  return result.slice(0, 200);
}

/** Context for the currently executing task — set by orchestrator runner. */
export interface TaskContext {
  taskId: number;
  workflowId: number;
  slug: string;
  agentId: string;
  assignedBy: string;
}

export interface RunLoopOptions {
  /** Override session file path (for isolated job sessions). */
  sessionFile?: string;
  /** Skip idle/daily resets and compaction (for job sessions). */
  skipMaintenance?: boolean;
  /** Prefix to prepend to stored assistant response (not returned in LoopResult.text). */
  storePrefix?: string;
  /** Task context — set by orchestrator runner so tools like complete_task and
   *  log_progress know which task they're acting on. Also used by delegate_task
   *  (mid-level managers) to read workflowId and set parentTask on sub-tasks. */
  taskContext?: TaskContext;
}

export interface LoopResult {
  text: string;
  compacted: boolean;
  nearThreshold: boolean;
}

/**
 * Run one full agent turn: receive a message, think, use tools, respond.
 *
 * This is the core entry point that all callers use to interact with an agent:
 * - Channel adapters (Telegram, Discord, WS) call this when a user sends a message
 * - Scheduler runner (scheduler/runner.ts) calls this for cron jobs and heartbeats
 * - Orchestrator runner (orchestrator/runner.ts) calls this for delegated tasks
 *
 * Flow:
 * 1. Acquires a per-session lock (prevents concurrent writes to the same session file)
 * 2. Loads session history from JSONL, runs maintenance (compaction, idle/daily reset)
 * 3. Appends the user message to session
 * 4. Enters the ReAct loop: LLM call → tool use → LLM call → ... → text response
 * 5. Appends the assistant response to session and returns it
 *
 * @param userId      - Config-level user ID (e.g. "owner"). Used for session path resolution.
 *                      Orchestrator tasks use "system" since they're not tied to a user session.
 * @param agentId     - Agent config key (e.g. "atlas", "researcher"). Determines soul.md,
 *                      tool permissions, memory scope, and model selection.
 * @param agentConfig - The agent's config object (name, model overrides, role).
 * @param userMessage - The message to process (user text, job prompt, or task prompt).
 * @param confirm     - Optional callback for user approval of privileged operations.
 *                      Provided by interactive channels, undefined for jobs and tasks.
 * @param quiet       - When true, suppresses per-skill catalog log lines. Used by scheduler
 *                      and orchestrator runners to avoid log spam on frequent/parallel runs.
 * @param opts        - Optional overrides for session handling:
 *                      sessionFile: custom JSONL path (jobs, tasks use isolated sessions)
 *                      skipMaintenance: skip compaction/idle/daily resets (for isolated sessions)
 *                      storePrefix: prefix prepended to stored response (e.g. "[Job Name] ")
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
    const systemPrompt = loadSystemPrompt(agentId, agentConfig, quiet, opts?.taskContext);
    const tools = getToolDefinitions(agentId, !!opts?.taskContext);

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
        console.log(`[loop:${agentId}] Session idle expired, resetting: ${userId}/${agentId}`);
        resetSession(userId, agentId);
      }

      if (isDailyResetDue(userId, agentId)) {
        console.log(`[loop:${agentId}] Daily reset triggered for: ${userId}/${agentId}`);
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
      console.log(`[loop:${agentId}] Overflow rejected: session ${currentTokens} + message ${newMsgTokens} > ${contextWindowTokens}`);
      return {
        text: `Your message is too large for the current context window. Please send a shorter message.`,
        compacted: compactionResult.compacted,
        nearThreshold: false,
      };
    }

    const userMsg: TimestampedMessage = { timestamp: Date.now(), role: "user", content: userMessage };
    messages.push(userMsg);
    append(userMsg);

    // -----------------------------------------------------------------------
    // ReAct loop — the core think → act → observe cycle.
    //
    // Each iteration: send full conversation to LLM, get a response.
    // Three possible outcomes per iteration:
    //   "text"     → LLM replied with words. Save and return. Loop ends.
    //   "tool_use" → LLM wants to call tools. Execute them, save results,
    //                loop again so the LLM can see what the tools returned.
    //   "error"    → LLM API error. Throw for the caller to handle.
    //
    // The loop continues until the LLM produces a text response or we
    // hit MAX_ITERATIONS (safety cap to prevent runaway tool loops).
    // -----------------------------------------------------------------------
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      console.log(`[loop:${agentId}] Iteration ${iterations}/${MAX_ITERATIONS}`);

      // Inject human-readable timestamps into a copy for the LLM — stored messages are untouched
      const llmMessages = injectTimestamps(messages, config.timezone);

      // ---- LLM call ----
      // Sends: system prompt + full conversation history + tool definitions.
      // Returns one of: { type: "text", text } | { type: "tool_use", toolCalls } | { type: "error", error }
      const response = await provider.chat(systemPrompt, llmMessages, tools);

      if (response.type === "error") {
        // Throw so callers can handle appropriately:
        // - Channels (Telegram/Discord/WS): catch and send a friendly error message
        // - Scheduler (runner.ts): catch, classify as transient/permanent, retry or disable
        // - Orchestrator (runner.ts): catch, mark task as failed, emit task_failed
        throw new Error(response.error);
      }

      // ---- Text response — loop ends ----
      // The LLM decided to reply with words instead of calling a tool.
      // This is the only successful exit from the loop.
      if (response.type === "text") {
        console.log(`[loop:${agentId}] Raw model response: ${(response.text ?? "").slice(0, 300)}`);
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

      // ---- Tool use — execute and loop again ----
      // The LLM returned one or more tool_use blocks. Each block has:
      //   id: unique ID (LLM-generated, echoed back in tool_result)
      //   name: which tool to call (e.g. "read_file", "shell_exec")
      //   input: arguments the LLM generated based on the tool's input_schema
      if (response.type === "tool_use" && response.toolCalls?.length) {
        // Save the LLM's tool_use blocks to session history — the LLM needs to
        // see its own requests in the conversation on the next iteration
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

        // Execute all tool calls and collect results.
        // Each tool returns a string — the result the LLM will see on the next iteration.
        const toolResults = await Promise.all(
          response.toolCalls.map(async (tc) => {
            console.log(`[loop:${agentId}] Tool call: ${tc.name}`, summarizeToolInput(tc.name, tc.input));
            const result = await executeTool(tc.name, tc.input, agentId, confirm, opts?.taskContext);
            console.log(`[loop:${agentId}] Tool result: ${tc.name} →`, summarizeToolResult(tc.name, result));
            return {
              type: "tool_result" as const,
              tool_use_id: tc.id,  // Echoes back the LLM's ID so it can match request → response
              content: result,
            };
          })
        );

        // Save tool results to session history as a "user" message — this is the
        // Anthropic API convention: tool results are sent in the user role
        const toolResultMsg: TimestampedMessage = {
          timestamp: Date.now(),
          role: "user",
          content: toolResults,
        };
        messages.push(toolResultMsg);
        append(toolResultMsg);

        // If complete_task was called, the task is done — break immediately.
        // No need to send results back to the LLM for another iteration that
        // would just produce a useless text summary nobody reads.
        const taskCompleted = response.toolCalls.some((tc) => tc.name === "complete_task");
        if (taskCompleted) {
          const summary = response.toolCalls.find((tc) => tc.name === "complete_task")?.input?.summary ?? "";
          return {
            text: String(summary),
            compacted: compactionResult.compacted,
            nearThreshold: false,
          };
        }

        // Loop again — LLM will see the tool results and either call more tools or respond
        continue;
      }
    }

    // Hit the iteration cap — safety exit to prevent infinite tool loops
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
