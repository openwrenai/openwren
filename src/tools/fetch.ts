import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ToolDefinition } from "../providers";
import { detectInjection, detectSuspicious, wrapUntrusted } from "./sanitize";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Default max characters to return. ~40K chars ≈ ~10K tokens.
// Generous enough to cover most articles in full.
const DEFAULT_MAX_CHARS = 40_000;

// Fetch timeout in milliseconds
const FETCH_TIMEOUT = 15_000;

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const fetchUrlToolDefinition: ToolDefinition = {
  name: "fetch_url",
  description:
    "Fetch a web page and extract its main content as plain text. " +
    "HTML is parsed and article content is extracted (navigation, ads, and sidebars are stripped). " +
    "Results are truncated if very long. Use when you need the full content of a specific URL.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch, e.g. \"https://example.com/article\"",
      },
    },
    required: ["url"],
  },
};

// ---------------------------------------------------------------------------
// Security scan — hard block + soft log
// ---------------------------------------------------------------------------

/** Returns a block string if injection detected, otherwise logs soft matches and returns null. */
function scanContent(text: string, url: string): string | null {
  const injection = detectInjection(text);
  if (injection) {
    console.warn(`[security] Prompt injection detected in ${url}: "${injection}"`);
    return `[security] Blocked — suspected prompt injection ("${injection}") in URL: ${url}`;
  }
  const suspicious = detectSuspicious(text);
  if (suspicious) {
    console.warn(`[security] Suspicious content in ${url}: "${suspicious}" (soft match, not blocked)`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function fetchUrl(url: string): Promise<string> {
  // Basic URL validation
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `[fetch error] Invalid URL: "${url}"`;
  }

  if (!parsed.protocol.startsWith("http")) {
    return `[fetch error] Only HTTP(S) URLs are supported, got "${parsed.protocol}"`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "OpenWren/1.0 (web-fetch tool)",
        Accept: "text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.8, */*;q=0.7",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return `[fetch error] HTTP ${response.status} ${response.statusText} for ${url}`;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();

    // Fast path: server returned markdown — skip readability entirely
    if (contentType.includes("markdown")) {
      const truncated = body.slice(0, DEFAULT_MAX_CHARS);
      const blocked = scanContent(truncated, url);
      if (blocked) return blocked;
      const suffix = body.length > DEFAULT_MAX_CHARS ? `\n\n[truncated — ${body.length} chars total]` : "";
      return wrapUntrusted(`Markdown content from ${url}:\n\n${truncated}${suffix}`);
    }

    // If it's not HTML, return raw text (truncated)
    if (!contentType.includes("html")) {
      const truncated = body.slice(0, DEFAULT_MAX_CHARS);
      const blocked = scanContent(truncated, url);
      if (blocked) return blocked;
      const suffix = body.length > DEFAULT_MAX_CHARS ? `\n\n[truncated — ${body.length} chars total]` : "";
      return wrapUntrusted(`Content from ${url} (${contentType}):\n\n${truncated}${suffix}`);
    }

    // Parse HTML with linkedom, extract article with readability
    const { document } = parseHTML(body);
    const reader = new Readability(document as any);
    const article = reader.parse();

    if (!article || !article.textContent) {
      // Readability couldn't extract — fall back to raw text extraction
      const text = document.body?.textContent?.trim() ?? "";
      if (!text) return `[fetch] No readable content found at ${url}`;

      const blocked = scanContent(text, url);
      if (blocked) return blocked;

      const truncated = text.slice(0, DEFAULT_MAX_CHARS);
      const suffix = text.length > DEFAULT_MAX_CHARS ? `\n\n[truncated — ${text.length} chars total]` : "";
      return wrapUntrusted(`Content from ${url}:\n\n${truncated}${suffix}`);
    }

    // Return extracted article
    const title = article.title ? `# ${article.title}\n\n` : "";
    const content = article.textContent.trim();

    const blocked = scanContent(content, url);
    if (blocked) return blocked;

    const truncated = content.slice(0, DEFAULT_MAX_CHARS);
    const suffix = content.length > DEFAULT_MAX_CHARS ? `\n\n[truncated — ${content.length} chars total]` : "";

    return wrapUntrusted(`${title}${truncated}${suffix}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("abort")) {
      return `[fetch error] Request timed out after ${FETCH_TIMEOUT / 1000}s for ${url}`;
    }
    return `[fetch error] ${message}`;
  }
}
