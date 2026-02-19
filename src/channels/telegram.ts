import { Bot, Context } from "grammy";
import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { runAgentLoop } from "../agent/loop";

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
// Bot setup
// ---------------------------------------------------------------------------

export function createTelegramBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set in environment");
  }

  const bot = new Bot(token);
  const agentId = config.defaultAgent;
  const agentConfig = config.agents[agentId];

  // Per-sender sliding window rate limiter
  // Map<senderId, timestamp[]> — timestamps of recent messages
  const rateLimitMap = new Map<number, number[]>();

  function isRateLimited(senderId: number): boolean {
    const { maxMessages, windowSeconds } = config.telegram.rateLimit;
    const windowMs = windowSeconds * 1000;
    const now = Date.now();

    const timestamps = (rateLimitMap.get(senderId) ?? [])
      .filter((t) => now - t < windowMs); // drop expired timestamps

    if (timestamps.length >= maxMessages) {
      rateLimitMap.set(senderId, timestamps);
      return true;
    }

    timestamps.push(now);
    rateLimitMap.set(senderId, timestamps);
    return false;
  }

  // Middleware — rate limiter (runs before whitelist)
  bot.use(async (ctx, next) => {
    const senderId = ctx.from?.id;
    if (!senderId) return;

    if (isRateLimited(senderId)) {
      console.log(`[telegram] Rate limited sender: ${senderId}`);
      return; // silent drop
    }

    await next();
  });

  // Middleware — whitelist check
  bot.use(async (ctx, next) => {
    const senderId = ctx.from?.id;
    if (!senderId) return;

    const allowed = config.telegram.allowedUserIds;

    if (!allowed.includes(senderId)) {
      console.log(`[telegram] Rejected message from unauthorized user: ${senderId}`);
      if (config.telegram.unauthorizedBehavior === "reject") {
        await ctx.reply("Sorry Ismail you are not authenticated.");
      }
      // "silent" — do nothing, give no indication the bot exists
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

    // Show typing indicator
    await ctx.replyWithChatAction("typing");

    console.log(`[telegram] Message from ${senderId}: ${text}`);

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
      const result = await runAgentLoop(agentId, agentConfig, text, confirm);
      console.log(`[telegram] ${agentConfig.name} reply: ${result.text.slice(0, 120)}${result.text.length > 120 ? "..." : ""}`);

      // Compaction notification — tell user session was just compacted
      if (result.compacted) {
        await ctx.reply("📦 Session compacted — older messages summarized.");
      }

      const formatted = `**${agentConfig.name}:** ${result.text}`;

      // Telegram has a 4096 char message limit — split if needed
      if (formatted.length <= 4096) {
        await ctx.reply(formatted, { parse_mode: "Markdown" });
      } else {
        // Split into chunks
        for (let i = 0; i < formatted.length; i += 4096) {
          await ctx.reply(formatted.slice(i, i + 4096), { parse_mode: "Markdown" });
        }
      }

      // Warning notification — context is getting full, compaction coming soon
      if (result.nearThreshold) {
        await ctx.reply("⚠️ Context is almost full — compaction will run soon.");
      }
    } catch (err) {
      console.error("[telegram] Error running agent loop:", err);
      await ctx.reply(`**${agentConfig.name}:** Sorry, something went wrong. Please try again.`);
    }
  });

  bot.catch((err) => {
    console.error("[telegram] Bot error:", err);
  });

  return bot;
}
