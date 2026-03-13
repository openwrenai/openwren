import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { isProtectedWrite, isProtectedRead, isAllowedOutsidePath } from "../security";
import type { ToolDefinition } from "../providers";

// ---------------------------------------------------------------------------
// Sandbox enforcement
// ---------------------------------------------------------------------------

/**
 * Resolves and validates that the given file path stays within the workspace.
 * For reads: allows outside-workspace paths listed in paths.allowReadOutside.
 * For writes: always restricted to workspace.
 */
function safePath(filePath: string, allowOutside: boolean = false): string {
  const workspace = config.workspaceDir;
  const resolved = path.resolve(workspace, filePath);

  const insideWorkspace = resolved.startsWith(workspace + path.sep) || resolved === workspace;

  if (!insideWorkspace) {
    // For reads, check if this outside path is explicitly allowed
    if (allowOutside && isAllowedOutsidePath(resolved)) {
      return resolved;
    }

    throw new Error(
      `Path "${filePath}" resolves outside the workspace sandbox (${workspace}). Access denied.`
    );
  }

  return resolved;
}

/**
 * Returns the workspace-relative path for protected path matching.
 * e.g. /home/user/.openwren/agents/atlas/soul.md → agents/atlas/soul.md
 */
function workspaceRelative(resolved: string): string {
  const workspace = config.workspaceDir;
  if (resolved.startsWith(workspace + path.sep)) {
    return resolved.slice(workspace.length + 1);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function readFile(filePath: string, _agentId?: string): Promise<string> {
  try {
    const resolved = safePath(filePath, true); // allow outside-workspace reads if configured

    // Check read-protected paths
    const readProtected = isProtectedRead(workspaceRelative(resolved));
    if (readProtected) {
      return `[read error] Path is read-protected: ${readProtected}`;
    }

    if (!fs.existsSync(resolved)) {
      return `[read error] File not found: ${filePath}`;
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      // Return directory listing instead
      const entries = fs.readdirSync(resolved);
      return `(directory listing for ${filePath})\n${entries.join("\n")}`;
    }

    // Cap file reads at 512 KB to avoid flooding context
    const MAX_BYTES = 512 * 1024;
    if (stat.size > MAX_BYTES) {
      const fd = fs.openSync(resolved, "r");
      const buf = Buffer.alloc(MAX_BYTES);
      fs.readSync(fd, buf, 0, MAX_BYTES, 0);
      fs.closeSync(fd);
      return buf.toString("utf-8") + `\n\n[truncated — file is ${stat.size} bytes, showing first ${MAX_BYTES}]`;
    }

    return fs.readFileSync(resolved, "utf-8");
  } catch (err: unknown) {
    const e = err as Error;
    return `[read error] ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function writeFile(filePath: string, content: string, agentId?: string): Promise<string> {
  try {
    const resolved = safePath(filePath); // writes always restricted to workspace

    // Check write-protected paths (per-agent override if agentId provided)
    const writeProtected = isProtectedWrite(workspaceRelative(resolved), agentId);
    if (writeProtected) {
      return `[write error] Path is write-protected: ${writeProtected}`;
    }

    // Ensure parent directory exists
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolved, content, "utf-8");
    return `File written: ${filePath} (${content.length} bytes)`;
  } catch (err: unknown) {
    const e = err as Error;
    return `[write error] ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const readFileToolDefinition: ToolDefinition = {
  name: "read_file",
  description:
    "Read the contents of a file or list a directory. " +
    "Path is relative to the workspace directory (~/.openwren). " +
    "Large files are truncated at 512 KB.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file or directory, relative to the workspace root",
      },
    },
    required: ["path"],
  },
};

export const writeFileToolDefinition: ToolDefinition = {
  name: "write_file",
  description:
    "Write content to a file. Creates the file and any missing parent directories. " +
    "Overwrites existing files. " +
    "Path is relative to the workspace directory (~/.openwren). " +
    "Requires user confirmation before execution.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file, relative to the workspace root",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
    required: ["path", "content"],
  },
};
