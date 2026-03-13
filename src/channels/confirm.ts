/**
 * Shared confirmation flow for channel adapters.
 *
 * Telegram and Discord use text-based confirmation (yes/no/always parsing).
 * WebSocket uses nonce-based structured JSON — it manages its own pending map
 * but can import the ConfirmFn type from tools/index.ts.
 *
 * This module eliminates the duplicated parsing logic and pending confirmation
 * management from telegram.ts and discord.ts.
 */

import type { ConfirmFn } from "../tools";

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Parses a text response to a confirmation prompt.
 * Returns "always", true (yes), false (no), or null (unrecognized).
 */
export function parseConfirmAnswer(text: string): boolean | "always" | null {
  const answer = text.toLowerCase().trim();
  if (answer === "always") return "always";
  if (answer === "yes" || answer === "y") return true;
  if (answer === "no" || answer === "n") return false;
  return null;
}

/** Help text shown when the user sends an unrecognized response during a pending confirmation. */
export const CONFIRM_HELP =
  "Reply with:\n• **yes** — run once\n• **always** — run now and never ask again\n• **no** — cancel";

// ---------------------------------------------------------------------------
// Pending confirmation manager — generic, keyed by string
// ---------------------------------------------------------------------------

interface PendingConfirmation {
  command: string;
  resolve: (approved: boolean | "always") => void;
}

const pending = new Map<string, PendingConfirmation>();

/**
 * Tries to handle an incoming message as a confirmation response.
 *
 * Returns:
 * - The answer (true / false / "always") if consumed — the channel should
 *   react accordingly (e.g. send "Cancelled." on false)
 * - "help" if there's a pending confirmation but the text wasn't recognized
 * - null if there's no pending confirmation for this key
 */
export function handleConfirmResponse(
  chatKey: string,
  text: string
): boolean | "always" | "help" | null {
  const entry = pending.get(chatKey);
  if (!entry) {
    console.log(`[confirm] No pending confirmation for ${chatKey} — passing through`);
    return null;
  }

  const answer = parseConfirmAnswer(text);
  if (answer === null) {
    console.log(`[confirm] Unrecognized answer "${text}" for ${chatKey} — showing help`);
    return "help";
  }

  pending.delete(chatKey);
  console.log(`[confirm] ${chatKey} answered "${answer}" for command: ${entry.command}`);
  entry.resolve(answer);
  return answer;
}

/**
 * Creates a ConfirmFn for the given chat key.
 *
 * When the agent requests confirmation, `sendPrompt` is called to display
 * the ⚠️ message, and the returned promise resolves when
 * `handleConfirmResponse` matches a reply from the user.
 */
export function createConfirmFn(
  chatKey: string,
  agentName: string,
  sendPrompt: (text: string) => void
): ConfirmFn {
  return (command: string, reason?: string) => {
    return new Promise((resolve) => {
      const reasonLine = reason ? `\nReason: ${reason}` : "";
      sendPrompt(
        `⚠️ **${agentName}** wants to run:\n\`${command}\`${reasonLine}\n\nReply with **yes**, **always**, or **no**.`
      );
      pending.set(chatKey, { command, resolve });
    });
  };
}
