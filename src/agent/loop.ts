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
import { recordUsage } from "../usage";
import type { UsageContext } from "../usage";

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
  /** Origin channel — stored on user messages for display (webui, telegram, discord, scheduler). */
  channel?: string;
  /** Skip idle/daily resets and compaction (for job sessions). */
  skipMaintenance?: boolean;
  /** Prefix to prepend to stored assistant response (not returned in LoopResult.text). */
  storePrefix?: string;
  /** Task context — set by orchestrator runner so tools like complete_task and
   *  log_progress know which task they're acting on. Also used by delegate_task
   *  (mid-level managers) to read workflowId and set parentTask on sub-tasks. */
  taskContext?: TaskContext;
  /** Usage tracking context — identifies what triggered this loop run. */
  usageContext?: UsageContext;
  /**
   * Stream callback — enables token-by-token streaming for the WebUI.
   *
   * When provided (and the provider supports chatStream), the agent loop uses
   * streaming instead of the blocking chat() call. Each text delta from the LLM
   * triggers this callback. The WS channel passes a callback that sends each
   * delta directly to the requesting client: sendTo(client, 'token', {text}).
   *
   * When absent (Telegram, Discord, scheduler, orchestrator), the loop uses
   * the non-streaming chat() path and returns the full response at once.
   */
  streamCallback?: (delta: string) => void;
  /**
   * Tool use callback — called when a tool call starts, before execution.
   * Fires in BOTH streaming and non-streaming paths so tool events are
   * emitted regardless of whether text is streamed.
   */
  onToolUse?: (toolCallId: string, toolName: string, args: Record<string, unknown>) => void;
  /**
   * Tool result callback — called after a tool finishes executing.
   * Fires in BOTH streaming and non-streaming paths.
   */
  onToolResult?: (toolCallId: string, toolName: string, result: string) => void;
}

export interface LoopResult {
  text: string;
  compacted: boolean;
  nearThreshold: boolean;
  usage?: { inputTokens: number; outputTokens: number };
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

    const userMsg: TimestampedMessage = {
      timestamp: Date.now(),
      role: "user",
      content: userMessage,
      ...(opts?.channel ? { channel: opts.channel } : {}),
    };
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
    /** Build usage object and record to usage files if context is provided. */
    function finalizeUsage(): { inputTokens: number; outputTokens: number } | undefined {
      if (totalIn === 0 && totalOut === 0) return undefined;
      const usage = { inputTokens: totalIn, outputTokens: totalOut };

      if (opts?.usageContext) {
        const ctx = opts.usageContext;
        recordUsage({
          ts: Date.now(),
          agent: agentId,
          provider: lastProvider || "unknown",
          model: lastModel || "unknown",
          in: totalIn,
          out: totalOut,
          source: ctx.source,
          sourceId: ctx.sourceId ?? null,
          workflowId: ctx.workflowId ?? null,
          userId: ctx.userId,
          sessionId: ctx.sessionId ?? "main",
        });
      }

      return usage;
    }

    let iterations = 0;
    let totalIn = 0;
    let totalOut = 0;
    let lastProvider = "";
    let lastModel = "";

    // Streaming guard: both conditions must be true:
    // 1. The caller provided a streamCallback (only WebUI WS channel does)
    // 2. The provider implements chatStream (all AI SDK providers do)
    // When either is false, we skip straight to the non-streaming chat() path.
    const useStreaming = !!opts?.streamCallback && !!provider.chatStream;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      console.log(`[loop:${agentId}] Iteration ${iterations}/${MAX_ITERATIONS}`);

      // Inject human-readable timestamps into a copy for the LLM — stored messages are untouched
      const llmMessages = injectTimestamps(messages, config.timezone);

      // -----------------------------------------------------------------------
      // Streaming path — uses chatStream() (fullStream) to get text deltas
      // and tool calls from a single LLM call. Text deltas are forwarded to
      // the streamCallback in real-time. Tool calls are collected and executed
      // the same way as the non-streaming path.
      // -----------------------------------------------------------------------
      if (useStreaming) {
        const textChunks: string[] = [];
        const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
        let streamFailed = false;

        // Try streaming — if it fails (e.g. provider doesn't support stream:true
        // with tools, like llmgateway/mistral), we set streamFailed=true and fall
        // through to the non-streaming chat() path below. The user sees a wall of
        // text instead of streaming, but the request still succeeds.
        try {
          for await (const part of provider.chatStream!(systemPrompt, llmMessages, tools)) {
            if (part.type === "text") {
              textChunks.push(part.text);
              opts!.streamCallback!(part.text);
            } else if (part.type === "tool-call") {
              toolCalls.push({ id: part.toolCallId, name: part.toolName, input: part.args });
            } else if (part.type === "finish") {
              totalIn += part.usage.inputTokens;
              totalOut += part.usage.outputTokens;
              lastProvider = provider.name.split("/")[0];
              lastModel = provider.name.split("/")[1];
            }
          }
        } catch (streamErr) {
          // Graceful degradation — log the error and fall through to chat()
        const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        console.warn(`[loop:${agentId}] Streaming failed, falling back to chat(): ${msg}`);
        streamFailed = true;
        }

        // Stream succeeded — process the collected results
        if (!streamFailed) {

        // ---- Tool calls from stream — execute and loop again ----
        if (toolCalls.length > 0) {
          const assistantToolMsg: TimestampedMessage = {
            timestamp: Date.now(),
            role: "assistant",
            content: toolCalls.map((tc) => ({
              type: "tool-call" as const,
              toolCallId: tc.id,
              toolName: tc.name,
              input: tc.input,
            })),
          };
          messages.push(assistantToolMsg);
          append(assistantToolMsg);

          const toolResults = await Promise.all(
            toolCalls.map(async (tc) => {
              console.log(`[loop:${agentId}] Tool call: ${tc.name}`, summarizeToolInput(tc.name, tc.input));
              // Notify the WS client that a tool call is starting (shows spinner card)
              opts?.onToolUse?.(tc.id, tc.name, tc.input);
              const execResult = await executeTool(tc.name, tc.input, agentId, confirm, opts?.taskContext);
              console.log(`[loop:${agentId}] Tool result: ${tc.name} →`, summarizeToolResult(tc.name, execResult));
              // Notify the WS client that the tool finished (swaps spinner for checkmark)
              opts?.onToolResult?.(tc.id, tc.name, execResult);
              return {
                type: "tool-result" as const,
                toolCallId: tc.id,
                toolName: tc.name,
                output: { type: "text" as const, value: execResult },
              };
            })
          );

          const toolResultMsg: TimestampedMessage = {
            timestamp: Date.now(),
            role: "tool" as const,
            content: toolResults,
          };
          messages.push(toolResultMsg);
          append(toolResultMsg);

          const taskCompleted = toolCalls.some((tc) => tc.name === "complete_task");
          if (taskCompleted) {
            const summary = toolCalls.find((tc) => tc.name === "complete_task")?.input?.summary ?? "";
            return {
              text: String(summary),
              compacted: compactionResult.compacted,
              nearThreshold: false,
              usage: finalizeUsage(),
            };
          }

          continue;
        }

        // ---- Text response from stream — loop ends ----
        const fullText = textChunks.join("");
        const text = cleanModelResponse(fullText);
        const storedText = opts?.storePrefix ? opts.storePrefix + text : text;
        const assistantMsg: TimestampedMessage = {
            timestamp: Date.now(),
          role: "assistant",
          content: storedText,
          ...(opts?.channel === "scheduler" ? { channel: "scheduler" } : {}),
          };
        messages.push(assistantMsg);
        append(assistantMsg);
        return {
            text,
          compacted: compactionResult.compacted,
          nearThreshold: compactionResult.nearThreshold,
          usage: finalizeUsage(),
          };
        } // end if (!streamFailed)
      } // end if (useStreaming)

      // -----------------------------------------------------------------------
      // Non-streaming path — original chat() call.
      // Used by: Telegram, Discord, scheduler, orchestrator, and as a fallback
      // when streaming fails (streamFailed=true above).
      // -----------------------------------------------------------------------

      // ---- LLM call ----
      // Sends: system prompt + full conversation history + tool definitions.
      // Returns one of: { type: "text", text } | { type: "tool_use", toolCalls } | { type: "error", error }
      const response = await provider.chat(systemPrompt, llmMessages, tools);

      // Accumulate token usage across iterations and track which provider actually responded
      if (response.usage) {
        totalIn += response.usage.inputTokens;
        totalOut += response.usage.outputTokens;
      }
      if (response.provider) lastProvider = response.provider;
      if (response.model) lastModel = response.model;

      if (response.type === "error") {
        throw new Error(response.error);
      }

      // ---- Text response — loop ends ----
      if (response.type === "text") {
        console.log(`[loop:${agentId}] Raw model response: ${(response.text ?? "").slice(0, 300)}`);
        const text = cleanModelResponse(response.text ?? "");
        const storedText = opts?.storePrefix ? opts.storePrefix + text : text;
        const assistantMsg: TimestampedMessage = {
          timestamp: Date.now(),
          role: "assistant",
          content: storedText,
          ...(opts?.channel === "scheduler" ? { channel: "scheduler" } : {}),
        };
        messages.push(assistantMsg);
        append(assistantMsg);
        return {
          text,
          compacted: compactionResult.compacted,
          nearThreshold: compactionResult.nearThreshold,
          usage: finalizeUsage(),
        };
      }

      // ---- Tool use — execute and loop again ----
      if (response.type === "tool_use" && response.toolCalls?.length) {
        const assistantToolMsg: TimestampedMessage = {
          timestamp: Date.now(),
          role: "assistant",
          content: response.toolCalls.map((tc) => ({
            type: "tool-call" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.input,
          })),
        };
        messages.push(assistantToolMsg);
        append(assistantToolMsg);

        const toolResults = await Promise.all(
          response.toolCalls.map(async (tc) => {
            console.log(`[loop:${agentId}] Tool call: ${tc.name}`, summarizeToolInput(tc.name, tc.input));
            // Notify the WS client that a tool call is starting (no-op when callbacks are undefined)
            opts?.onToolUse?.(tc.id, tc.name, tc.input);
            const execResult = await executeTool(tc.name, tc.input, agentId, confirm, opts?.taskContext);
            console.log(`[loop:${agentId}] Tool result: ${tc.name} →`, summarizeToolResult(tc.name, execResult));
            // Notify the WS client that the tool finished (no-op when callbacks are undefined)
            opts?.onToolResult?.(tc.id, tc.name, execResult);
            return {
              type: "tool-result" as const,
              toolCallId: tc.id,
              toolName: tc.name,
              output: { type: "text" as const, value: execResult },
            };
          })
        );

        const toolResultMsg: TimestampedMessage = {
          timestamp: Date.now(),
          role: "tool" as const,
          content: toolResults,
        };
        messages.push(toolResultMsg);
        append(toolResultMsg);

        const taskCompleted = response.toolCalls.some((tc) => tc.name === "complete_task");
        if (taskCompleted) {
          const summary = response.toolCalls.find((tc) => tc.name === "complete_task")?.input?.summary ?? "";
          return {
            text: String(summary),
            compacted: compactionResult.compacted,
            nearThreshold: false,
            usage: finalizeUsage(),
          };
        }

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
      usage: finalizeUsage(),
    };
  });
}
