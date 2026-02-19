export interface Message {
  role: "user" | "assistant";
  content: string | MessageContent[];
}

export interface MessageContent {
  type: "text" | "tool_use" | "tool_result";
  // text
  text?: string;
  // tool_use
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result
  tool_use_id?: string;
  content?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LLMResponse {
  type: "text" | "tool_use" | "error";
  // type: text
  text?: string;
  // type: tool_use
  toolCalls?: ToolCall[];
  // type: error
  error?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMProvider {
  name: string;
  chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse>;
}

// Factory — returns the provider configured in config.json
import { config } from "../config";
import { AnthropicProvider } from "./anthropic";

export function createProvider(): LLMProvider {
  switch (config.defaultProvider) {
    case "anthropic":
      return new AnthropicProvider();
    case "ollama":
      throw new Error("Ollama provider not yet implemented (Phase 4)");
    default:
      throw new Error(`Unknown provider: ${config.defaultProvider}`);
  }
}
