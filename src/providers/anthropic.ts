import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import type {
  LLMProvider,
  LLMResponse,
  Message,
  ToolCall,
  ToolDefinition,
} from "./index";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.model = config.providers.anthropic.model;
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8096,
        system: systemPrompt,
        messages: messages as Anthropic.MessageParam[],
        tools: tools as Anthropic.Tool[],
      });

      // Model wants to use one or more tools
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

      // Plain text response
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );

      return {
        type: "text",
        text: textBlock?.text ?? "",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[anthropic] error: ${message}`);
      return { type: "error", error: message };
    }
  }
}
