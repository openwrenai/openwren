import type { Channel } from "./types";
import { createTelegramChannel } from "./telegram";
import { createDiscordChannel } from "./discord";
import { createWebSocketChannel, setSchedulerStatusProvider } from "./websocket";

export { setSchedulerStatusProvider };

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

/**
 * Look up a channel by name. Used by the scheduler to deliver proactive messages.
 * Returns the channel instance or undefined if not found.
 */
export function getChannel(name: string): Channel | undefined {
  return all.find((c) => c.name === name);
}

/**
 * Send a proactive message to a user on a specific channel.
 * Used by the scheduler for cron/heartbeat delivery.
 *
 * @returns true if delivered, false if channel not found, not configured, or delivery failed
 */
export async function deliverMessage(
  channelName: string,
  userId: string,
  agentId: string,
  text: string
): Promise<boolean> {
  const channel = getChannel(channelName);
  if (!channel || !channel.sendMessage) {
    console.warn(`[channels] Cannot deliver to "${channelName}" — no sendMessage support`);
    return false;
  }
  return channel.sendMessage(userId, agentId, text);
}
