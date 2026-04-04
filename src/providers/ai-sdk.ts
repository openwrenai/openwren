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
import type { ModelMessage, SystemModelMessage } from "@ai-sdk/provider-utils";
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
      const useCache = this.shouldInjectCache(systemPrompt);
      const sdkTools = this.translateTools(tools, useCache);

      console.log(`[ai-sdk] ${this.provider}/${this.model} — calling generateText${useCache ? " (cache)" : ""}`);
      const result = await generateText({
        model: languageModel,
        system: useCache ? this.cacheSystemPrompt(systemPrompt) : systemPrompt,
        messages: (useCache ? this.cacheMessages(messages) : messages) as ModelMessage[],
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
    const useCache = this.shouldInjectCache(systemPrompt);
    const sdkTools = this.translateTools(tools, useCache);

    const result = streamText({
      model: languageModel,
      system: useCache ? this.cacheSystemPrompt(systemPrompt) : systemPrompt,
      messages: (useCache ? this.cacheMessages(messages) : messages) as ModelMessage[],
      tools: sdkTools,
    });

    for await (const delta of result.textStream) {
      yield delta;
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt caching — Anthropic-only, injects cache_control markers
  // ---------------------------------------------------------------------------

  /** True when the model is Claude (direct Anthropic or via llmgateway). */
  private isClaudeModel(): boolean {
    return this.provider === "anthropic" || this.model.startsWith("claude");
  }

  /** Check if cache injection should fire — Claude model + prompt above minimum cacheable size. */
  private shouldInjectCache(systemPrompt: string): boolean {
    if (!this.isClaudeModel()) return false;
    // Minimum cacheable prefix: 1,024 tokens for Sonnet, 4,096 for Haiku 4.5 / Opus
    const estimatedTokens = Math.ceil(systemPrompt.length / 4);
    const minTokens = this.model.includes("haiku") || this.model.includes("opus") ? 4096 : 1024;
    return estimatedTokens >= minTokens;
  }

  /** Wrap system prompt with 1h cache TTL (stable for entire session). */
  private cacheSystemPrompt(systemPrompt: string): SystemModelMessage {
    return {
      role: "system",
      content: systemPrompt,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
    };
  }

  /** Clone messages and mark the second-to-last with 5min cache (stable prefix boundary). */
  private cacheMessages(messages: Message[]): unknown[] {
    if (messages.length < 2) return messages;
    const cached: unknown[] = [...messages];
    const idx = messages.length - 2;
    cached[idx] = Object.assign({}, messages[idx], {
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    });
    return cached;
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

  private translateTools(tools: ToolDefinition[], cacheLastTool = false): ToolSet {
    const result: ToolSet = {};
    for (let i = 0; i < tools.length; i++) {
      const t = tools[i];
      const isLast = cacheLastTool && i === tools.length - 1;
      result[t.name] = tool({
        description: t.description,
        inputSchema: jsonSchema(t.input_schema),
        ...(isLast ? {
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
        } : {}),
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
    usage: {
      inputTokens?: number;
      outputTokens?: number;
      inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
    };
  }): LLMResponse {
    const cachedInputTokens = result.usage?.inputTokenDetails?.cacheReadTokens ?? 0;
    const usage = {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
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
        provider: this.provider,
        model: this.model,
      };
    }

    return {
      type: "text",
      text: result.text ?? "",
      usage,
      provider: this.provider,
      model: this.model,
    };
  }
}
