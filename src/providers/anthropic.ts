import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import type {
  LLMProvider,
  LLMResponse,
  Message,
  ToolCall,
  ToolDefinition,
} from "./index";

/**
 * Anthropic Claude provider — sends messages to the Anthropic Messages API.
 * API key comes from config.providers.anthropic.apiKey (global credential).
 * Model is passed in at construction time (e.g. "claude-sonnet-4-6").
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private model: string;

  /** Creates an Anthropic client with the configured API key and the given model name. */
  constructor(model: string) {
    this.client = new Anthropic({
      apiKey: config.providers.anthropic.apiKey,
    });
    this.model = model;
  }

  /**
   * Sends a conversation to the Anthropic Messages API and returns a normalized LLMResponse.
   *
   * Takes the system prompt (from the agent's soul file), the full conversation history,
   * and the list of available tools. Returns one of:
   * - { type: "text" }     — model gave a final text answer
   * - { type: "tool_use" } — model wants to call tools (loop should execute and continue)
   * - { type: "error" }    — API call failed (never throws — errors are always returned)
   */
  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    try {
      // Call the Anthropic Messages API with the full conversation context
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8096,
        system: systemPrompt,
        messages: messages as Anthropic.MessageParam[],
        tools: tools as Anthropic.Tool[],
      });

      // Model wants to use one or more tools — extract tool calls from the response blocks
      if (response.stop_reason === "tool_use") {
        const toolCalls: ToolCall[] = response.content
          .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
          .map((block) => ({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          }));

        return { type: "tool_use", toolCalls };
      }

      // Plain text response — find the text block in the response content
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );

      return {
        type: "text",
        text: textBlock?.text ?? "",
      };
    } catch (err) {
      // Catch all API errors (rate limits, network failures, etc.) and return as error response.
      // Never throws — the ProviderChain relies on this to decide whether to try fallbacks.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[anthropic] ${this.model} error: ${message}`);
      return { type: "error", error: message };
    }
  }
}
