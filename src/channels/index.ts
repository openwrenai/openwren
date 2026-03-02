import type { Channel } from "./types";
import { createTelegramChannel } from "./telegram";
import { createDiscordChannel } from "./discord";
import { createWebSocketChannel } from "./websocket";

const all: Channel[] = [
  createTelegramChannel(),
  createDiscordChannel(),
  createWebSocketChannel(),
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

/**
 * Stop all channels gracefully. Called on SIGTERM/SIGINT for clean shutdown.
 */
export async function stopChannels(): Promise<void> {
  for (const channel of all) {
    try {
      await channel.stop();
    } catch (err) {
      console.error(`[channels] Error stopping ${channel.name}:`, err);
    }
  }
}
