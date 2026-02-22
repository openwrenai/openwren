import { Bot } from "grammy";
import * as fs from "fs";
import * as path from "path";
import { config, AgentConfig } from "../config";
import { runAgentLoop } from "../agent/loop";
import { routeMessage } from "../agent/router";

// ---------------------------------------------------------------------------
// Chat ID persistence
// ---------------------------------------------------------------------------

const chatIdPath = path.join(config.workspaceDir, "telegram-chat-id.json");

function saveChatId(chatId: number): void {
  fs.writeFileSync(chatIdPath, JSON.stringify({ chatId }), "utf-8");
}

function loadChatId(): number | null {
  if (!fs.existsSync(chatIdPath)) return null;
  try {
    const { chatId } = JSON.parse(fs.readFileSync(chatIdPath, "utf-8"));
    return chatId ?? null;
  } catch {
    return null;
  }
}

export function getOwnerChatId(): number | null {
  return loadChatId();
}

// ---------------------------------------------------------------------------
// Pending confirmations
// ---------------------------------------------------------------------------

export interface PendingCommand {
  command: string;
  toolCallId: string;
  sessionKey: string;
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
 * Telegram only supports: **bold**, *italic*, `code`, ```code blocks```, [links].
 * Headers (# ## ###) are converted to **bold** text.
 */
function formatForTelegram(text: string): string {
  return text.replace(/^(#{1,6})\s+(.+)$/gm, "**$2**");
}

// ---------------------------------------------------------------------------
// Shared bot setup — wires rate limiter, whitelist, confirmation flow,
// message handler, and compaction notifications onto any Bot instance.
//
// fixedAgentId = null  → main bot, uses router to resolve agent per message
// fixedAgentId = "xyz" → dedicated bot, always routes to that agent
// ---------------------------------------------------------------------------

function setupBot(bot: Bot, fixedAgentId: string | null): void {
  // Per-sender sliding window rate limiter
  const rateLimitMap = new Map<number, number[]>();

  function isRateLimited(senderId: number): boolean {
    const { maxMessages, windowSeconds } = config.telegram.rateLimit;
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

  // Middleware — whitelist check
  bot.use(async (ctx, next) => {
    const senderId = ctx.from?.id;
    if (!senderId) return;

    if (!config.telegram.allowedUserIds.includes(senderId)) {
      console.log(`[telegram] Rejected message from unauthorized user: ${senderId}`);
      if (config.telegram.unauthorizedBehavior === "reject") {
        await ctx.reply("Unauthorized.");
      }
      return;
    }

    await next();
  });

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const senderId = ctx.from.id;
    const text = ctx.message.text.trim();

    // Persist chat ID on every message (idempotent)
    saveChatId(chatId);

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

    // Resolve agent — either fixed (dedicated bot) or via router (main bot)
    let agentId: string;
    let agentConfig: AgentConfig;
    let message: string;

    if (fixedAgentId) {
      agentId = fixedAgentId;
      agentConfig = config.agents[fixedAgentId];
      message = text;
    } else {
      const route = routeMessage(text);
      agentId = route.agentId;
      agentConfig = route.agentConfig;
      message = route.message;
    }

    // Empty message after stripping prefix (e.g. user sent just "/einstein")
    if (!message) {
      await ctx.reply(`**${agentConfig.name}** is listening. Send a message after the prefix.`, { parse_mode: "Markdown" });
      return;
    }

    // Show typing indicator
    await ctx.replyWithChatAction("typing");

    console.log(`[telegram] Message from ${senderId} → ${agentConfig.name}: ${message}`);

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
          sessionKey: agentConfig.sessionPrefix,
          agentId,
          resolve,
        });
      });
    };

    try {
      const result = await runAgentLoop(agentId, agentConfig, message, confirm);
      console.log(`[telegram] ${agentConfig.name} reply: ${result.text.slice(0, 120)}${result.text.length > 120 ? "..." : ""}`);

      if (result.compacted) {
        await ctx.reply("📦 Session compacted — older messages summarized.");
      }

      const formatted = formatForTelegram(`**${agentConfig.name}:** ${result.text}`);

      // Telegram has a 4096 char message limit — split if needed
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
      await ctx.reply(`**${agentConfig.name}:** Sorry, something went wrong. Please try again.`, { parse_mode: "Markdown" });
    }
  });

  bot.catch((err) => {
    console.error("[telegram] Bot error:", err);
  });
}

// ---------------------------------------------------------------------------
// Main bot — handles default agent + prefix routing
// ---------------------------------------------------------------------------

export function createTelegramBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set in environment");
  }

  const bot = new Bot(token);
  setupBot(bot, null); // null = use router
  return bot;
}

// ---------------------------------------------------------------------------
// Per-agent dedicated bots — one per agent that has a telegramToken set
// ---------------------------------------------------------------------------

export interface AgentBot {
  bot: Bot;
  agentId: string;
  agentName: string;
}

export function createAgentBots(): AgentBot[] {
  const bots: AgentBot[] = [];

  for (const [agentId, agentConfig] of Object.entries(config.agents)) {
    if (!agentConfig.telegramToken) continue;

    const bot = new Bot(agentConfig.telegramToken);
    setupBot(bot, agentId);
    bots.push({ bot, agentId, agentName: agentConfig.name });
    console.log(`[telegram] Created dedicated bot for agent: ${agentConfig.name} (${agentId})`);
  }

  return bots;
}
