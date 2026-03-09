/**
 * Channel — uniform interface for a messaging transport (Telegram, Discord, etc.).
 *
 * Each channel implementation:
 * - reads its own bindings from config.bindings.{channelName}
 * - owns all platform-specific logic (rate limiting, formatting, confirmation flow)
 * - calls runAgentLoop() and is otherwise invisible to the agent layer
 */
export interface Channel {
  /** Channel identifier, matches the key in config.bindings (e.g. "telegram") */
  readonly name: string;

  /** Returns true if at least one agent is bound to this channel */
  isConfigured(): boolean;

  /** Start all bots/connections for this channel. Non-blocking. */
  start(): void;

  /** Graceful shutdown */
  stop(): Promise<void>;

  /**
   * Send a proactive message to a user on this channel.
   * Used by the scheduler to deliver cron/heartbeat results without an incoming message.
   *
   * @param userId - The config user ID (e.g. "owner"), NOT the platform-specific sender ID
   * @param agentId - Which agent is sending (to resolve the correct bot/binding)
   * @param text - The message text to deliver
   * @returns true if delivered, false if the channel couldn't deliver (not configured, user not found)
   */
  sendMessage?(userId: string, agentId: string, text: string): Promise<boolean>;
}
