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
}
