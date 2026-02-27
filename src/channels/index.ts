import type { Channel } from "./types";
import { createTelegramChannel } from "./telegram";

const all: Channel[] = [
  createTelegramChannel(),
  // Future: createDiscordChannel(),
  // Future: createWhatsAppChannel(),
];

/**
 * Start all configured channels. Each channel checks its own bindings —
 * unconfigured channels are silently skipped.
 */
export function startChannels(): void {
  for (const channel of all) {
    if (!channel.isConfigured()) {
      console.log(`[channels] Skipped (not configured): ${channel.name}`);
      continue;
    }
    channel.start();
  }
}
