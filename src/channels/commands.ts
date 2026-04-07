/**
 * Channel commands — intercepts slash commands from messaging channels.
 *
 * Commands are processed before reaching the agent loop. Returns the
 * response text if handled, or null if the message is not a command.
 */

import * as fs from "fs";
import { agentSessionPath, agentSessionArchiveDir } from "../config";
import * as path from "path";

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Check if a message is a channel command and handle it.
 *
 * @param text - The raw message text from the user
 * @param userId - The user who sent the message
 * @param agentId - The agent this session belongs to
 * @returns Response text if command was handled, null if not a command
 */
export function handleCommand(text: string, userId: string, agentId: string): string | null {
  const trimmed = text.trim().toLowerCase();

  if (trimmed === "/help") {
    return [
      "/new — Archive current session and start fresh",
      "/reset — Same as /new",
      "/help — Show this list",
    ].join("\n");
  }

  if (trimmed === "/new" || trimmed === "/reset") {
    return handleNewSession(userId, agentId);
  }

  return null;
}

/**
 * Archive the current session.jsonl and start a fresh session.
 * Moves the current session to archives/ with a timestamp suffix.
 *
 * @param userId - The user requesting a new session
 * @param agentId - The agent whose session to reset
 * @returns Confirmation message for the user
 */
function handleNewSession(userId: string, agentId: string): string {
  const sessionFile = agentSessionPath(userId, agentId);

  if (!fs.existsSync(sessionFile)) {
    return "Session is already empty. Nothing to reset.";
  }

  // Check if the file has any content
  const content = fs.readFileSync(sessionFile, "utf-8").trim();
  if (!content) {
    return "Session is already empty. Nothing to reset.";
  }

  // Archive current session
  const archiveDir = agentSessionArchiveDir(userId, agentId);
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  const archiveName = `session-${y}-${mo}-${d}_${h}-${mi}-${s}.jsonl`;
  const archivePath = path.join(archiveDir, archiveName);

  fs.renameSync(sessionFile, archivePath);
  console.log(`[sessions] Archived ${agentId} session to archives/${archiveName}`);

  return "Session archived. Starting fresh.";
}
