import { generateText, streamText, smoothStream, tool, jsonSchema } from "ai";
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
  StreamPart,
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
  // chatStream() — streaming LLM call for interactive channels (WebUI)
  //
  // Uses AI SDK's fullStream instead of textStream. fullStream yields BOTH
  // text deltas AND tool calls from a single streaming request. This avoids
  // needing two LLM calls (one to check if it's text vs tool, another to stream).
  //
  // The agent loop consumes these StreamPart events to:
  //   - Forward text deltas to the WS client in real-time via streamCallback
  //   - Collect tool calls and execute them (then loop again)
  //   - Accumulate usage stats from the finish event
  //
  // AI SDK field name gotchas (differ from what you'd expect):
  //   - text-delta uses .text (not .textDelta)
  //   - tool-call uses .input (not .args) for tool arguments
  //   - finish uses .totalUsage (not .usage) for accumulated token counts
  //   - errors arrive as stream parts (type: 'error'), not thrown exceptions
  // ---------------------------------------------------------------------------

  async *chatStream(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[]
  ): AsyncIterable<StreamPart> {
    const languageModel = this.resolveModel();
    const sdkTools = this.translateTools(tools);

    const result = streamText({
      model: languageModel,
      system: systemPrompt,
      messages: messages as ModelMessage[],
      tools: sdkTools,
        experimental_transform: smoothStream({ chunking: "word" }),
    });

    // Iterate the full stream — yields text-delta, tool-call, finish, error, and other
    // event types. We only care about the four listed below; others are silently skipped.
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        // AI SDK field: part.text (not part.textDelta)
        yield { type: "text", text: part.text };
      } else if (part.type === "tool-call") {
        // AI SDK field: part.input (not part.args) — the parsed tool arguments
        yield {
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: (part.input ?? {}) as Record<string, unknown>,
        };
      } else if (part.type === "finish") {
        // AI SDK field: part.totalUsage (not part.usage) — accumulated across all steps
        yield {
          type: "finish",
          usage: {
            inputTokens: part.totalUsage?.inputTokens ?? 0,
            outputTokens: part.totalUsage?.outputTokens ?? 0,
          },
        };
      } else if (part.type === "error") {
        // AI SDK emits errors as stream parts, not thrown exceptions.
        // Re-throw so the agent loop's try/catch can handle it and fall back
        // to the non-streaming chat() path.
        const err = (part as any).error;
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Stream error: ${msg}`);
      }
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
