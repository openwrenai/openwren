import * as fs from "fs";
import * as path from "path";
import { agentMemoryDir } from "../config";
import type { ToolDefinition } from "../providers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function memoryDir(agentId: string): string {
  return agentMemoryDir(agentId);
}

function memoryFilePath(agentId: string, key: string): string {
  // Sanitize key — only allow alphanumerics, hyphens, underscores
  const safeKey = key.replace(/[^a-zA-Z0-9\-_]/g, "_");
  return path.join(memoryDir(agentId), `${safeKey}.md`);
}

// ---------------------------------------------------------------------------
// save_memory
// ---------------------------------------------------------------------------

export async function saveMemory(agentId: string, key: string, content: string): Promise<string> {
  try {
    const dir = memoryDir(agentId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = memoryFilePath(agentId, key);
    fs.writeFileSync(filePath, content, "utf-8");
    return `Memory saved: ${key} (${content.length} chars)`;
  } catch (err: unknown) {
    const e = err as Error;
    return `[memory error] ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// memory_search
// ---------------------------------------------------------------------------

export async function searchMemory(agentId: string, query: string): Promise<string> {
  try {
    const dir = memoryDir(agentId);
    if (!fs.existsSync(dir)) return "No memory files found.";
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));

    if (files.length === 0) {
      return "No memory files found.";
    }

    // Split query into words, filter short words, lowercase for matching
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (words.length === 0) {
      return "Query too short — please provide at least one word with 3+ characters.";
    }

    const matches: { key: string; content: string }[] = [];

    for (const file of files) {
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const contentLower = content.toLowerCase();

      const hits = words.filter((w) => contentLower.includes(w));
      if (hits.length > 0) {
        const key = file.replace(/\.md$/, "");
        matches.push({ key, content });
      }
    }

    if (matches.length === 0) {
      return `No memory files matched query: "${query}"`;
    }

    return matches
      .map((m) => `### ${m.key}\n${m.content}`)
      .join("\n\n---\n\n");
  } catch (err: unknown) {
    const e = err as Error;
    return `[memory error] ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const saveMemoryToolDefinition: ToolDefinition = {
  name: "save_memory",
  description:
    "Save information to persistent memory. Survives session resets and restarts. " +
    "Use this for facts, preferences, project context, or anything worth remembering long-term. " +
    "Saving to the same key overwrites the previous value — use this to update a memory.",
  input_schema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "Unique identifier for this memory (e.g. user-prefs, projects). Use hyphens, no spaces.",
      },
      content: {
        type: "string",
        description: "The content to store. Markdown is fine.",
      },
    },
    required: ["key", "content"],
  },
};

export const searchMemoryToolDefinition: ToolDefinition = {
  name: "memory_search",
  description:
    "Search persistent memory files by keyword. " +
    "Returns the full content of every memory file that contains any word from the query. " +
    "Use this at the start of conversations that reference past context.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Keywords to search for, e.g. \"user preferences\" or \"project orion\"",
      },
    },
    required: ["query"],
  },
};
