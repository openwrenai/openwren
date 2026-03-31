import { generateText, streamText, tool, jsonSchema } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createGroq } from "@ai-sdk/groq";
import { createXai } from "@ai-sdk/xai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import type { ModelMessage } from "@ai-sdk/provider-utils";
import type {
  LLMProvider,
  LLMResponse,
  Message,
  ToolDefinition,
} from "./index";

// ---------------------------------------------------------------------------
// Credentials — resolved by the factory from config, passed in at construction
// ---------------------------------------------------------------------------

export interface AiSdkCreds {
  apiKey?: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// AiSdkProvider — universal LLM provider backed by Vercel AI SDK
// ---------------------------------------------------------------------------

/**
 * Routes all LLM calls through the Vercel AI SDK (`ai` package).
 * Internal message format matches AI SDK's ModelMessage — no translation needed.
 * Calls generateText()/streamText() and maps the response back to LLMResponse.
 *
 * Supports: anthropic, openai, google, mistral, groq, xai, deepseek, ollama, llmgateway.
 * Credentials are passed explicitly — the SDK never reads process.env.
 */
export class AiSdkProvider implements LLMProvider {
  readonly name: string;
  private provider: string;
  private model: string;
  private creds: AiSdkCreds;

  constructor(provider: string, model: string, creds: AiSdkCreds) {
    this.name = `${provider}/${model}`;
    this.provider = provider;
    this.model = model;
    this.creds = creds;
  }

  // ---------------------------------------------------------------------------
  // chat() — non-streaming, used by the agent loop
  // ---------------------------------------------------------------------------

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    try {
      const languageModel = this.resolveModel();
      const sdkTools = this.translateTools(tools);

      console.log(`[ai-sdk] ${this.provider}/${this.model} — calling generateText`);
      const result = await generateText({
        model: languageModel,
        system: systemPrompt,
        messages: messages as ModelMessage[],
        tools: sdkTools,
      });

      return this.translateResponse(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ai-sdk] ${this.provider}/${this.model} error: ${message}`);
      return { type: "error", error: message };
    }
  }

  // ---------------------------------------------------------------------------
  // chatStream() — streaming, used by interactive channels and WebUI
  // ---------------------------------------------------------------------------

  async *chatStream(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[]
  ): AsyncIterable<string> {
    const languageModel = this.resolveModel();
    const sdkTools = this.translateTools(tools);

    const result = streamText({
      model: languageModel,
      system: systemPrompt,
      messages: messages as ModelMessage[],
      tools: sdkTools,
    });

    for await (const delta of result.textStream) {
      yield delta;
    }
  }

  // ---------------------------------------------------------------------------
  // Model resolution — maps provider name to AI SDK factory
  // ---------------------------------------------------------------------------

  private resolveModel(): LanguageModel {
    switch (this.provider) {
      case "anthropic":
        return createAnthropic({ apiKey: this.creds.apiKey })(this.model);
      case "openai":
        return createOpenAI({ apiKey: this.creds.apiKey })(this.model);
      case "google":
        return createGoogleGenerativeAI({ apiKey: this.creds.apiKey })(this.model);
      case "mistral":
        return createMistral({ apiKey: this.creds.apiKey })(this.model);
      case "groq":
        return createGroq({ apiKey: this.creds.apiKey })(this.model);
      case "xai":
        return createXai({ apiKey: this.creds.apiKey })(this.model);
      case "deepseek":
        return createDeepSeek({ apiKey: this.creds.apiKey })(this.model);
      case "ollama":
        return createOpenAI({
          baseURL: (this.creds.baseUrl ?? "http://localhost:11434") + "/v1",
          apiKey: "ollama",
        })(this.model);
      case "llmgateway":
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- model ID union not exported from SDK
        return createLLMGateway({ apiKey: this.creds.apiKey })(this.model as any);
      default:
        throw new Error(`Unknown AI SDK provider: "${this.provider}"`);
    }
  }

  // ---------------------------------------------------------------------------
  // Tool translation — our ToolDefinition[] → AI SDK tool objects
  // ---------------------------------------------------------------------------

  private translateTools(tools: ToolDefinition[]): ToolSet {
    const result: ToolSet = {};
    for (const t of tools) {
      result[t.name] = tool({
        description: t.description,
        inputSchema: jsonSchema(t.input_schema),
      });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Response translation — AI SDK result → our LLMResponse
  // ---------------------------------------------------------------------------

  private translateResponse(result: {
    text: string;
    toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
    usage: { inputTokens?: number; outputTokens?: number };
  }): LLMResponse {
    const usage = {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    };

    if (result.toolCalls && result.toolCalls.length > 0) {
      return {
        type: "tool_use",
        toolCalls: result.toolCalls.map((tc) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          input: (tc.input ?? {}) as Record<string, unknown>,
        })),
        usage,
      };
    }

    return {
      type: "text",
      text: result.text ?? "",
      usage,
    };
  }
}
