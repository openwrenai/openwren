import type { SearchProvider, SearchResult, SearchOptions } from "./index";

// ---------------------------------------------------------------------------
// Brave Search API response types (subset we use)
// ---------------------------------------------------------------------------

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results: BraveWebResult[];
  };
}

// ---------------------------------------------------------------------------
// BraveSearchProvider
// ---------------------------------------------------------------------------

export class BraveSearchProvider implements SearchProvider {
  readonly name = "brave";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const count = options?.count ?? 5;

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": this.apiKey,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Brave Search API error: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`
      );
    }

    const data = (await response.json()) as BraveSearchResponse;

    if (!data.web?.results) return [];

    return data.web.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  }
}
