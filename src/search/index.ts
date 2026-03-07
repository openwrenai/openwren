import { config } from "../config";
import { BraveSearchProvider } from "./brave";

// ---------------------------------------------------------------------------
// Search result type — common across all providers
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Search options — passed through to every provider
// ---------------------------------------------------------------------------

export interface SearchOptions {
  count?: number; // max results to return (default: 5)
}

// ---------------------------------------------------------------------------
// SearchProvider interface — all search backends implement this
// ---------------------------------------------------------------------------

export interface SearchProvider {
  name: string;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

// ---------------------------------------------------------------------------
// Factory — reads config and returns the correct provider
// ---------------------------------------------------------------------------

/**
 * Creates a SearchProvider based on config.search.provider.
 * Returns null if no search provider is configured.
 */
export function createSearchProvider(): SearchProvider | null {
  const providerName = config.search?.provider;
  if (!providerName) return null;

  switch (providerName) {
    case "brave": {
      const apiKey = config.search?.brave?.apiKey;
      if (!apiKey) {
        console.warn(
          `[search] Provider "brave" selected but search.brave.apiKey is not set — search disabled`
        );
        return null;
      }
      return new BraveSearchProvider(apiKey);
    }

    default:
      console.warn(`[search] Unknown search provider "${providerName}" — search disabled`);
      return null;
  }
}
