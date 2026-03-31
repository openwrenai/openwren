import { config } from "../config";
import type {
  LLMProvider,
  LLMResponse,
  Message,
  MessageContent,
  ToolCall,
  ToolDefinition,
} from "./index";

// ---------------------------------------------------------------------------
// Ollama wire types — the shapes the REST API actually sends/receives
// ---------------------------------------------------------------------------

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

interface OllamaResponse {
  model: string;
  message: {
    role: string;
    content: string | null;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// OllamaProvider
// ---------------------------------------------------------------------------

/**
 * Ollama provider — sends messages to a locally running Ollama instance.
 * Uses the OpenAI-compatible chat API at http://localhost:11434/api/chat.
 *
 * Translates between OpenWren's internal Anthropic-style message format
 * and Ollama's OpenAI-compatible format:
 *   - System prompt → first message with role "system"
 *   - Tool definitions: input_schema → parameters
 *   - Tool calls: content blocks → tool_calls array
 *   - Tool results: role "user" with tool_result blocks → role "tool" messages
 *
 * Ollama doesn't assign IDs to tool calls — synthetic IDs (call_0, call_1, ...)
 * are generated so our internal format stays consistent.
 */
export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  private model: string;
  private baseUrl: string;

  constructor(model: string) {
    this.model = model;
    this.baseUrl = config.providers.ollama?.baseUrl ?? "http://localhost:11434";
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    try {
      const ollamaMessages = this.translateMessages(systemPrompt, messages);
      const ollamaTools = this.translateTools(tools);

      // Local models can be slow — 5-minute timeout for cold-start inference on large models.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: ollamaMessages,
          tools: ollamaTools.length > 0 ? ollamaTools : undefined,
          stream: false,
        }),
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${errorText}`);
      }

      const body = (await response.json()) as OllamaResponse;

      if (body.error) {
        throw new Error(body.error);
      }

      return this.translateResponse(body);
    } catch (err) {
      // Catch all errors (network, API, parse) — never throws.
      // ProviderChain relies on error responses to decide whether to try fallbacks.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ollama] ${this.model} error: ${message}`);
      return { type: "error", error: message };
    }
  }

  // ---------------------------------------------------------------------------
  // Translation helpers
  // ---------------------------------------------------------------------------

  /**
   * Converts our internal messages to Ollama's format.
   * System prompt becomes the first message with role "system".
   * Tool use content blocks become tool_calls on an assistant message.
   * Tool result content blocks become individual role "tool" messages.
   */
  private translateMessages(systemPrompt: string, messages: Message[]): OllamaMessage[] {
    const result: OllamaMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    for (const msg of messages) {
      // Simple string content — plain user or assistant message
      if (typeof msg.content === "string") {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }

      const blocks = msg.content as MessageContent[];

      // Assistant message with tool calls
      const toolCallBlocks = blocks.filter((b): b is import("./index").ToolCallContent => b.type === "tool-call");
      if (toolCallBlocks.length > 0) {
        result.push({
          role: "assistant",
          content: null,
          tool_calls: toolCallBlocks.map((b) => ({
            function: {
              name: b.toolName,
              arguments: b.input ?? {},
            },
          })),
        });
        continue;
      }

      // Tool result messages — one Ollama "tool" message per result
      const toolResultBlocks = blocks.filter((b): b is import("./index").ToolResultContent => b.type === "tool-result");
      if (toolResultBlocks.length > 0) {
        for (const b of toolResultBlocks) {
          result.push({ role: "tool", content: b.output.value ?? "" });
        }
        continue;
      }

      // Fallback: plain text block
      const textBlock = blocks.find((b) => b.type === "text");
      if (textBlock?.text) {
        result.push({ role: msg.role, content: textBlock.text });
      }
    }

    return result;
  }

  /**
   * Converts our ToolDefinition array (Anthropic-style input_schema)
   * to Ollama's OpenAI-compatible tool format.
   */
  private translateTools(tools: ToolDefinition[]): OllamaTool[] {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: t.input_schema.properties,
          required: t.input_schema.required,
        },
      },
    }));
  }

  /**
   * Converts Ollama's response to our internal LLMResponse format.
   * Generates synthetic IDs (call_0, call_1, ...) for tool calls
   * since Ollama doesn't assign them.
   */
  private translateResponse(body: OllamaResponse): LLMResponse {
    const { message } = body;

    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCalls: ToolCall[] = message.tool_calls.map((tc, i) => ({
        id: `call_${i}`,
        name: tc.function.name,
        input: tc.function.arguments,
      }));
      return { type: "tool_use", toolCalls };
    }

    return {
      type: "text",
      text: message.content ?? "",
    };
  }
}
