import { Bot } from "grammy";
import { config, AgentConfig, resolveUserId } from "../config";
import { runAgentLoop } from "../agent/loop";
import { bus } from "../events";
import type { Channel } from "./types";

// ---------------------------------------------------------------------------
// Pending confirmations
// ---------------------------------------------------------------------------

export interface PendingCommand {
  command: string;
  toolCallId: string;
  userId: string;
  agentId: string;
  resolve: (approved: boolean | "always") => void;
}

const pendingConfirmations = new Map<number, PendingCommand>();

export function setPendingConfirmation(chatId: number, pending: PendingCommand): void {
  pendingConfirmations.set(chatId, pending);
}

export function getPendingConfirmation(chatId: number): PendingCommand | undefined {
  return pendingConfirmations.get(chatId);
}

export function clearPendingConfirmation(chatId: number): void {
  pendingConfirmations.delete(chatId);
}

// ---------------------------------------------------------------------------
// Telegram markdown formatter
// ---------------------------------------------------------------------------

/**
 * Converts standard markdown to Telegram-compatible markdown.
 *
 * Telegram's legacy Markdown mode only supports: **bold**, *italic*,
 * `inline code`, ```code blocks```, and [links](url).
 *
 * Everything else the model might produce (headings, blockquotes,
 * strikethrough, image syntax, etc.) is stripped or converted so the
 * message never fails Telegram's parser.
 */
function formatForTelegram(text: string): string {
  let result = text;
  // # headings → **bold**
  result = result.replace(/^(#{1,6})\s+(.+)$/gm, "**$2**");
  // > blockquotes → plain text (not supported)
  result = result.replace(/^>\s?/gm, "");
  // --- horizontal rules → remove (not supported)
  result = result.replace(/^-{3,}$/gm, "");
  // - / * bullet markers → • (Telegram renders as plain text)
  result = result.replace(/^[\-\*]\s+/gm, "• ");
  // ~~strikethrough~~ → plain text (not supported in legacy mode)
  result = result.replace(/~~(.+?)~~/g, "$1");
  // ![alt](url) images → just the URL (can't render images as text)
  result = result.replace(/!\[.*?\]\((.+?)\)/g, "$1");
  return result;
}

// ---------------------------------------------------------------------------
// Shared bot setup — wires rate limiter, authorization, confirmation flow,
// message handler, and compaction notifications onto any Bot instance.
// Each bot is hardwired to exactly one agent via its binding.
// ---------------------------------------------------------------------------

/**
 * Wire all middleware and handlers onto a grammY Bot instance.
 *
 * @param bot - A grammY Bot instance created from a Telegram bot token.
 *              One bot per agent — each Telegram bot maps to exactly one agent.
 * @param agentId - The agent key in config (e.g. "atlas", "einstein").
 *                  Used for session lookup, user resolution, and event emission.
 * @param agentConfig - The agent's config entry (name, model overrides, etc.).
 *                      Used for display name in replies and logging.
 */
function setupBot(bot: Bot, agentId: string, agentConfig: AgentConfig): void {
  // Per-sender sliding window rate limiter
  const rateLimitMap = new Map<number, number[]>();

  function isRateLimited(senderId: number): boolean {
    const { maxMessages, windowSeconds } = config.channels.rateLimit;
    const windowMs = windowSeconds * 1000;
    const now = Date.now();

    const timestamps = (rateLimitMap.get(senderId) ?? [])
      .filter((t) => now - t < windowMs);

    if (timestamps.length >= maxMessages) {
      rateLimitMap.set(senderId, timestamps);
      return true;
    }

    timestamps.push(now);
    rateLimitMap.set(senderId, timestamps);
    return false;
  }

  // Middleware — rate limiter
  bot.use(async (ctx, next) => {
    const senderId = ctx.from?.id;
    if (!senderId) return;

    if (isRateLimited(senderId)) {
      console.log(`[telegram] Rate limited sender: ${senderId}`);
      return;
    }

    await next();
  });

  // Middleware — authorization via user channelIds lookup
  bot.use(async (ctx, next) => {
    const senderId = ctx.from?.id;
    if (!senderId) return;

    const userId = resolveUserId("telegram", senderId);
    if (!userId) {
      console.log(`[telegram] Rejected message from unauthorized user: ${senderId}`);
      if (config.channels.unauthorizedBehavior === "reject") {
        await ctx.reply("Unauthorized.");
      }
      return;
    }

    // Store userId on context for downstream handlers
    (ctx as any).userId = userId;
    await next();
  });

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const senderId = ctx.from.id;
    const text = ctx.message.text.trim();
    const userId: string = (ctx as any).userId;

    // Check if we're waiting for a YES/NO confirmation
    const pending = pendingConfirmations.get(chatId);
    if (pending) {
      const answer = text.toLowerCase();
      if (answer === "always") {
        clearPendingConfirmation(chatId);
        pending.resolve("always");
      } else if (answer === "yes" || answer === "y") {
        clearPendingConfirmation(chatId);
        pending.resolve(true);
      } else if (answer === "no" || answer === "n") {
        clearPendingConfirmation(chatId);
        pending.resolve(false);
        await ctx.reply("Cancelled.");
      } else {
        await ctx.reply(
          'Reply with:\n• **yes** — run once\n• **always** — run now and never ask again\n• **no** — cancel',
          { parse_mode: "Markdown" }
        );
      }
      return;
    }

    const message = text;

    if (!message) return;

    // Bus: notify observers that a message arrived
    bus.emit("message_in", {
      channel: "telegram", userId, agentId, agentName: agentConfig.name,
      text: message, timestamp: Date.now(),
    });

    // Show typing indicator
    await ctx.replyWithChatAction("typing");

    // Bus: notify observers that the agent is thinking
    bus.emit("agent_typing", {
      channel: "telegram", userId, agentId, agentName: agentConfig.name,
      timestamp: Date.now(),
    });

    console.log(`[telegram] Message from ${senderId} (${userId}) → ${agentConfig.name}: ${message}`);

    // Confirm callback — asks the user YES/NO/ALWAYS before destructive operations
    const confirm = (command: string): Promise<boolean | "always"> => {
      return new Promise((resolve) => {
        ctx.reply(
          `⚠️ **${agentConfig.name}** wants to run:\n\`${command}\`\n\nReply with **yes**, **always**, or **no**.`,
          { parse_mode: "Markdown" }
        );
        setPendingConfirmation(chatId, {
          command,
          toolCallId: "",
          userId,
          agentId,
          resolve,
        });
      });
    };

    try {
      const result = await runAgentLoop(userId, agentId, agentConfig, message, confirm);
      console.log(`[telegram] ${agentConfig.name} reply: ${result.text.slice(0, 120)}${result.text.length > 120 ? "..." : ""}`);

      // Bus: broadcast the agent's response to WS observers
      bus.emit("message_out", {
        channel: "telegram", userId, agentId, agentName: agentConfig.name,
        text: result.text, compacted: result.compacted, nearThreshold: result.nearThreshold,
        timestamp: Date.now(),
      });

      if (result.compacted) {
        // Bus: notify observers that session history was compacted
        bus.emit("session_compacted", { userId, agentId, timestamp: Date.now() });
        await ctx.reply("📦 Session compacted — older messages summarized.");
      }

      const formatted = formatForTelegram(result.text);

      // Telegram has a 4096 char message limit — split if needed.
      // ctx.reply() is grammY's context shorthand — it calls
      // bot.api.sendMessage(ctx.chat.id, ...) under the hood, replying
      // to the same chat the incoming message came from.
      if (formatted.length <= 4096) {
        await ctx.reply(formatted, { parse_mode: "Markdown" });
      } else {
        for (let i = 0; i < formatted.length; i += 4096) {
          await ctx.reply(formatted.slice(i, i + 4096), { parse_mode: "Markdown" });
        }
      }

      if (result.nearThreshold) {
        await ctx.reply("⚠️ Context is almost full — compaction will run soon.");
      }
    } catch (err) {
      console.error("[telegram] Error running agent loop:", err);
      // Bus: notify observers that the agent loop failed
      bus.emit("agent_error", {
        channel: "telegram", userId, agentId, agentName: agentConfig.name,
        error: err instanceof Error ? err.message : String(err), timestamp: Date.now(),
      });
      await ctx.reply("Sorry, something went wrong. Please try again.");
    }
  });

  bot.catch((err) => {
    console.error("[telegram] Bot error:", err);
  });
}

// ---------------------------------------------------------------------------
// TelegramChannel — reads bindings from config.bindings.telegram
// ---------------------------------------------------------------------------

class TelegramChannel implements Channel {
  readonly name = "telegram";
  private bots: { bot: Bot; agentId: string }[] = [];

  isConfigured(): boolean {
    const bindings = config.bindings.telegram;
    return !!bindings && Object.keys(bindings).length > 0;
  }

  start(): void {
    const bindings = config.bindings.telegram;
    if (!bindings) return;

    for (const [agentId, token] of Object.entries(bindings)) {
      const agentConfig = config.agents[agentId];
      if (!agentConfig) {
        console.warn(`[telegram] Binding for unknown agent "${agentId}" — skipping`);
        continue;
      }
      if (!token) {
        console.warn(`[telegram] Empty token for agent "${agentId}" — skipping`);
        continue;
      }

      const bot = new Bot(token);
      setupBot(bot, agentId, agentConfig);
      this.bots.push({ bot, agentId });

      // bot.start() never resolves (grammY polling) — don't await
      bot.start({
        onStart: (botInfo) => {
          console.log(`[telegram] ${agentConfig.name} bot started: @${botInfo.username}`);
        },
      });
    }
  }

  async stop(): Promise<void> {
    for (const { bot } of this.bots) {
      bot.stop();
    }
    this.bots = [];
  }

  /**
   * Send a proactive message to a user via Telegram.
   * Looks up the user's Telegram chat ID from config, then finds the
   * bot bound to the given agent and calls bot.api.sendMessage().
   *
   * Used by the scheduler for cron/heartbeat delivery.
   */
  async sendMessage(userId: string, agentId: string, text: string): Promise<boolean> {
    // Find the user's Telegram chat ID
    const userConfig = config.users[userId];
    if (!userConfig) return false;

    const chatId = userConfig.channelIds.telegram;
    if (!chatId) return false;

    // Find the bot bound to this agent
    const entry = this.bots.find((b) => b.agentId === agentId);
    if (!entry) return false;

    const formatted = formatForTelegram(text);

    try {
      // Telegram has a 4096 char message limit — split if needed.
      // Uses bot.api.sendMessage() directly (not ctx.reply()) because
      // this is a proactive message — no incoming ctx to reply to.
      if (formatted.length <= 4096) {
        await entry.bot.api.sendMessage(Number(chatId), formatted, { parse_mode: "Markdown" });
      } else {
        for (let i = 0; i < formatted.length; i += 4096) {
          await entry.bot.api.sendMessage(Number(chatId), formatted.slice(i, i + 4096), { parse_mode: "Markdown" });
        }
      }
      return true;
    } catch (err) {
      console.error(`[telegram] Failed to send proactive message to ${userId}:`, err);
      return false;
    }
  }
}

export function createTelegramChannel(): Channel {
  return new TelegramChannel();
}
