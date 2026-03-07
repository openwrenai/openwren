import type { ToolDefinition } from "../providers";
import { createSearchProvider } from "../search";
import { detectInjection, detectSuspicious, wrapUntrusted } from "./sanitize";

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const searchWebToolDefinition: ToolDefinition = {
  name: "search_web",
  description:
    "Search the web using the configured search provider. " +
    "Returns a list of results with title, URL, and snippet. " +
    "Use for current events, recent information, technical docs, or anything that benefits from a live web search.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query, e.g. \"Node.js WebSocket tutorial\" or \"latest TypeScript release\"",
      },
      count: {
        type: "number",
        description: "Max number of results to return (default: 5, max: 10)",
      },
    },
    required: ["query"],
  },
};

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function searchWeb(query: string, count?: number): Promise<string> {
  const provider = createSearchProvider();
  if (!provider) {
    return "[search error] No search provider configured. Set search.provider in openwren.json.";
  }

  const maxCount = Math.min(count ?? 5, 10);

  try {
    const results = await provider.search(query, { count: maxCount });

    if (results.length === 0) {
      return `No results found for "${query}".`;
    }

    // Scan each snippet for prompt injection
    for (const r of results) {
      const injection = detectInjection(r.snippet);
      if (injection) {
        console.warn(`[security] Prompt injection detected in search snippet from ${r.url}: "${injection}"`);
        return `[security] Blocked — suspected prompt injection ("${injection}") in search result from: ${r.url}`;
      }
      const suspicious = detectSuspicious(r.snippet);
      if (suspicious) {
        console.warn(`[security] Suspicious content in search snippet from ${r.url}: "${suspicious}" (soft match, not blocked)`);
      }
    }

    // Format results as a readable list
    const formatted = results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join("\n\n");

    return wrapUntrusted(`Search results for "${query}" (${results.length} results, via ${provider.name}):\n\n${formatted}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `[search error] ${message}`;
  }
}
