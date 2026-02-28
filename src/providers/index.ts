import { config } from "../config";
import { AnthropicProvider } from "./anthropic";

// ---------------------------------------------------------------------------
// Message types — the common format used between the agent loop and providers
// ---------------------------------------------------------------------------

/** A single message in a conversation. Content is either plain text or structured blocks (tool use/results). */
export interface Message {
  role: "user" | "assistant";
  content: string | MessageContent[];
}

/** A structured content block inside a message — can be text, a tool call, or a tool result. */
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

// ---------------------------------------------------------------------------
// Tool types — how tools are defined and called
// ---------------------------------------------------------------------------

/** Describes a tool the LLM can call. Sent with every chat request so the model knows what's available. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** A single tool call from the LLM — includes the provider-assigned ID, tool name, and input arguments. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// LLM response — what a provider returns after a chat() call
// ---------------------------------------------------------------------------

/**
 * The result of a single LLM API call. One of three types:
 * - "text"     — the model returned a plain text response (final answer)
 * - "tool_use" — the model wants to call one or more tools (loop continues)
 * - "error"    — the API call failed (network error, rate limit, etc.)
 */
export interface LLMResponse {
  type: "text" | "tool_use" | "error";
  text?: string;
  toolCalls?: ToolCall[];
  error?: string;
}

// ---------------------------------------------------------------------------
// LLMProvider — interface that all providers (Anthropic, Ollama, etc.) implement
// ---------------------------------------------------------------------------

/**
 * Common interface for LLM backends. Each provider (Anthropic, Ollama, etc.)
 * implements this so the agent loop doesn't know or care which backend it's talking to.
 */
export interface LLMProvider {
  name: string;
  chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// Provider spec parsing — handles the "provider/model" string format
// ---------------------------------------------------------------------------

/** A parsed "provider/model" spec, e.g. { provider: "anthropic", model: "claude-sonnet-4-6" } */
export interface ProviderSpec {
  provider: string;
  model: string;
}

/**
 * Parses a "provider/model" string into its two parts.
 * Example: "anthropic/claude-sonnet-4-6" → { provider: "anthropic", model: "claude-sonnet-4-6" }
 * Throws if the format is invalid (missing slash).
 */
export function parseProviderSpec(spec: string): ProviderSpec {
  const trimmed = spec.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    throw new Error(
      `Invalid provider/model format: "${spec}". Expected "provider/model" (e.g. "anthropic/claude-sonnet-4-6")`
    );
  }
  return {
    provider: trimmed.slice(0, slashIndex),
    model: trimmed.slice(slashIndex + 1),
  };
}

/**
 * Parses a comma-separated fallback chain into an array of ProviderSpecs.
 * Example: "anthropic/claude-haiku-3-5, ollama/llama3.2" → [{ provider: "anthropic", model: "claude-haiku-3-5" }, ...]
 * Returns empty array if input is empty or undefined.
 */
export function parseFallbackChain(chain: string | undefined): ProviderSpec[] {
  if (!chain || !chain.trim()) return [];
  return chain.split(",").map((s) => parseProviderSpec(s));
}

// ---------------------------------------------------------------------------
// Model chain resolution — figures out which providers to try for a given agent
// ---------------------------------------------------------------------------

/**
 * Builds the ordered list of providers to try for a given agent.
 *
 * Inheritance rule:
 * - Agent without `model` → inherits defaultModel + defaultFallback (full global chain)
 * - Agent with `model` but no `fallback` → uses only that model, no fallbacks
 * - Agent with `model` AND `fallback` → uses its own complete chain
 */
export function resolveModelChain(agentId: string): ProviderSpec[] {
  const agentConfig = config.agents[agentId];

  // Agent has its own model — use agent-specific chain
  if (agentConfig?.model) {
    const primary = parseProviderSpec(agentConfig.model);
    const fallbacks = parseFallbackChain(agentConfig.fallback);
    return [primary, ...fallbacks];
  }

  // No agent override — inherit global defaults
  const primary = parseProviderSpec(config.defaultModel);
  const fallbacks = parseFallbackChain(config.defaultFallback);
  return [primary, ...fallbacks];
}

// ---------------------------------------------------------------------------
// Provider factory — creates a provider instance from a parsed spec
// ---------------------------------------------------------------------------

/**
 * Creates a single LLMProvider instance for a given provider/model spec.
 * Maps the provider name to the correct class (Anthropic, Ollama, etc.).
 */
function createProviderFromSpec(spec: ProviderSpec): LLMProvider {
  switch (spec.provider) {
    case "anthropic":
      return new AnthropicProvider(spec.model);
    case "ollama":
      throw new Error("Ollama provider not yet implemented (Phase 4)");
    default:
      throw new Error(`Unknown provider: "${spec.provider}"`);
  }
}

// ---------------------------------------------------------------------------
// ProviderChain — tries providers in order until one succeeds
// ---------------------------------------------------------------------------

/**
 * Wraps one or more providers and tries them in order on each chat() call.
 * If the primary returns an error, the next fallback is tried automatically.
 * If all providers fail, the last error is returned to the caller.
 *
 * Implements LLMProvider so the agent loop doesn't know it's talking to a chain.
 */
class ProviderChain implements LLMProvider {
  readonly name: string;
  private specs: ProviderSpec[];

  constructor(specs: ProviderSpec[]) {
    this.specs = specs;
    // Display name shows the primary provider/model
    this.name = `${specs[0].provider}/${specs[0].model}`;
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    let lastError: LLMResponse = { type: "error", error: "No providers configured" };

    for (let i = 0; i < this.specs.length; i++) {
      const spec = this.specs[i];
      const isFallback = i > 0;

      try {
        const provider = createProviderFromSpec(spec);

        if (isFallback) {
          console.log(`[provider] Falling back to ${spec.provider}/${spec.model}`);
        }

        const response = await provider.chat(systemPrompt, messages, tools);

        // If the provider returned an error and we have more fallbacks, try the next one
        if (response.type === "error" && i < this.specs.length - 1) {
          console.warn(
            `[provider] ${spec.provider}/${spec.model} failed: ${response.error} — trying next fallback`
          );
          lastError = response;
          continue;
        }

        return response;
      } catch (err) {
        // Unexpected throw (e.g. provider constructor failed) — try next fallback
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[provider] ${spec.provider}/${spec.model} threw: ${message} — trying next fallback`
        );
        lastError = { type: "error", error: message };
        continue;
      }
    }

    return lastError;
  }
}

// ---------------------------------------------------------------------------
// Public factory — the only thing the agent loop calls
// ---------------------------------------------------------------------------

/**
 * Creates a provider chain for a given agent.
 * Resolves the model chain (primary + fallbacks) based on agent config and global defaults,
 * then wraps them in a ProviderChain that handles cascading automatically.
 *
 * The returned object implements LLMProvider — the agent loop treats it like any single provider.
 */
export function createProviderChain(agentId: string): LLMProvider {
  const chain = resolveModelChain(agentId);
  if (chain.length === 0) {
    throw new Error(`No provider/model configured for agent "${agentId}"`);
  }

  if (chain.length > 1) {
    console.log(
      `[provider] ${agentId}: ${chain[0].provider}/${chain[0].model} → fallbacks: ${chain
        .slice(1)
        .map((s) => `${s.provider}/${s.model}`)
        .join(", ")}`
    );
  }

  return new ProviderChain(chain);
}
