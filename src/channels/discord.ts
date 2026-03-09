import { Client, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import { config, AgentConfig, resolveUserId } from "../config";
import { runAgentLoop } from "../agent/loop";
import { bus } from "../events";
import type { Channel } from "./types";

// ---------------------------------------------------------------------------
// Pending confirmations — keyed by Discord user ID (DMs are 1:1, so user ID
// is sufficient to identify the conversation)
// ---------------------------------------------------------------------------

interface PendingCommand {
  command: string;
  userId: string;
  agentId: string;
  resolve: (approved: boolean | "always") => void;
}

// ---------------------------------------------------------------------------
// Per-agent Discord client setup — wires rate limiter, authorization,
// confirmation flow, and message handler onto a single Client instance.
//
// Each client is hardwired to one agent — no prefix routing.
// ---------------------------------------------------------------------------

function createClient(agentId: string, agentConfig: AgentConfig): Client {
  const client = new Client({
    intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
    // Partials.Channel + Partials.Message are required to receive DMs to
    // channels that haven't been cached yet (Discord.js quirk for DM support)
    partials: [Partials.Channel, Partials.Message],
  });

  // Per-sender sliding window rate limiter (keyed by Discord user ID string)
  const rateLimitMap = new Map<string, number[]>();

  function isRateLimited(senderId: string): boolean {
    const { maxMessages, windowSeconds } = config.channels.rateLimit;
    const windowMs = windowSeconds * 1000;
    const now = Date.now();

    const timestamps = (rateLimitMap.get(senderId) ?? []).filter((t) => now - t < windowMs);

    if (timestamps.length >= maxMessages) {
      rateLimitMap.set(senderId, timestamps);
      return true;
    }

    timestamps.push(now);
    rateLimitMap.set(senderId, timestamps);
    return false;
  }

  const pendingConfirmations = new Map<string, PendingCommand>();

  client.on("ready", () => {
    console.log(`[discord] ${agentConfig.name} bot ready: @${client.user?.username}`);
  });

  client.on("messageCreate", async (message) => {
    // DMs only — ignore server/guild channel messages
    if (message.channel.type !== ChannelType.DM) return;
    // Ignore bots (including ourselves)
    if (message.author.bot) return;

    const senderId = message.author.id;

    // Rate limiting
    if (isRateLimited(senderId)) {
      console.log(`[discord] Rate limited sender: ${senderId}`);
      return;
    }

    // Authorization — reject senders not listed in config.users
    const userId = resolveUserId("discord", senderId);
    if (!userId) {
      console.log(`[discord] Rejected message from unauthorized user: ${senderId}`);
      if (config.channels.unauthorizedBehavior === "reject") {
        await message.reply("Unauthorized.");
      }
      return;
    }

    const text = message.content.trim();
    if (!text) return;

    // Check if we're waiting for a YES/NO/ALWAYS confirmation from this user
    const pending = pendingConfirmations.get(senderId);
    if (pending) {
      const answer = text.toLowerCase();
      if (answer === "always") {
        pendingConfirmations.delete(senderId);
        pending.resolve("always");
      } else if (answer === "yes" || answer === "y") {
        pendingConfirmations.delete(senderId);
        pending.resolve(true);
      } else if (answer === "no" || answer === "n") {
        pendingConfirmations.delete(senderId);
        pending.resolve(false);
        await message.reply("Cancelled.");
      } else {
        await message.reply(
          "Reply with:\n- **yes** — run once\n- **always** — run now and never ask again\n- **no** — cancel"
        );
      }
      return;
    }

    // Bus: notify observers that a message arrived
    bus.emit("message_in", {
      channel: "discord", userId, agentId, agentName: agentConfig.name,
      text, timestamp: Date.now(),
    });

    // Show typing indicator (lasts ~10 seconds in Discord)
    await message.channel.sendTyping();

    // Bus: notify observers that the agent is thinking
    bus.emit("agent_typing", {
      channel: "discord", userId, agentId, agentName: agentConfig.name,
      timestamp: Date.now(),
    });

    console.log(`[discord] Message from ${senderId} (${userId}) → ${agentConfig.name}: ${text}`);

    // Confirm callback — prompts the user before destructive tool calls
    const confirm = (command: string): Promise<boolean | "always"> => {
      return new Promise((resolve) => {
        message.reply(
          `⚠️ **${agentConfig.name}** wants to run:\n\`${command}\`\n\nReply with **yes**, **always**, or **no**.`
        );
        pendingConfirmations.set(senderId, { command, userId, agentId, resolve });
      });
    };

    try {
      const result = await runAgentLoop(userId, agentId, agentConfig, text, confirm);
      console.log(
        `[discord] ${agentConfig.name} reply: ${result.text.slice(0, 120)}${result.text.length > 120 ? "..." : ""}`
      );

      // Bus: broadcast the agent's response to WS observers
      bus.emit("message_out", {
        channel: "discord", userId, agentId, agentName: agentConfig.name,
        text: result.text, compacted: result.compacted, nearThreshold: result.nearThreshold,
        timestamp: Date.now(),
      });

      if (result.compacted) {
        // Bus: notify observers that session history was compacted
        bus.emit("session_compacted", { userId, agentId, timestamp: Date.now() });
        await message.channel.send("📦 Session compacted — older messages summarized.");
      }

      const reply = result.text;

      // Discord has a 2000 char message limit — split if needed.
      // First chunk is a reply (so Discord links it to the user's message),
      // subsequent chunks are plain channel sends.
      if (reply.length <= 2000) {
        await message.reply(reply);
      } else {
        await message.reply(reply.slice(0, 2000));
        for (let i = 2000; i < reply.length; i += 2000) {
          await message.channel.send(reply.slice(i, i + 2000));
        }
      }

      if (result.nearThreshold) {
        await message.channel.send("⚠️ Context is almost full — compaction will run soon.");
      }
    } catch (err) {
      console.error("[discord] Error running agent loop:", err);
      // Bus: notify observers that the agent loop failed
      bus.emit("agent_error", {
        channel: "discord", userId, agentId, agentName: agentConfig.name,
        error: err instanceof Error ? err.message : String(err), timestamp: Date.now(),
      });
      await message.reply("Sorry, something went wrong. Please try again.");
    }
  });

  client.on("error", (err) => {
    console.error("[discord] Client error:", err);
  });

  return client;
}

// ---------------------------------------------------------------------------
// DiscordChannel — reads bindings from config.bindings.discord
// ---------------------------------------------------------------------------

class DiscordChannel implements Channel {
  readonly name = "discord";
  private entries: { client: Client; agentId: string }[] = [];

  isConfigured(): boolean {
    const bindings = config.bindings.discord;
    return !!bindings && Object.keys(bindings).length > 0;
  }

  start(): void {
    const bindings = config.bindings.discord;
    if (!bindings) return;

    for (const [agentId, token] of Object.entries(bindings)) {
      const agentConfig = config.agents[agentId];
      if (!agentConfig) {
        console.warn(`[discord] Binding for unknown agent "${agentId}" — skipping`);
        continue;
      }
      if (!token) {
        console.warn(`[discord] Empty token for agent "${agentId}" — skipping`);
        continue;
      }

      const client = createClient(agentId, agentConfig);
      this.entries.push({ client, agentId });

      // client.login() is async — don't await, Discord.js handles reconnection internally
      client.login(token).catch((err) => {
        console.error(`[discord] Failed to login ${agentConfig.name}:`, err);
      });
    }
  }

  async stop(): Promise<void> {
    for (const { client } of this.entries) {
      client.destroy();
    }
    this.entries = [];
  }

  /**
   * Send a proactive DM to a user via Discord.
   * Looks up the user's Discord ID from config, finds the bot bound to the
   * given agent, fetches the Discord User object, and sends a DM.
   *
   * Used by the scheduler for cron/heartbeat delivery.
   */
  async sendMessage(userId: string, agentId: string, text: string): Promise<boolean> {
    // Find the user's Discord ID
    const userConfig = config.users[userId];
    if (!userConfig) return false;

    const discordId = userConfig.channelIds.discord;
    if (!discordId) return false;

    // Find the client bound to this agent
    const entry = this.entries.find((e) => e.agentId === agentId);
    if (!entry) return false;

    const formatted = text;

    try {
      const discordUser = await entry.client.users.fetch(String(discordId));
      // Discord has a 2000 char message limit — split if needed
      if (formatted.length <= 2000) {
        await discordUser.send(formatted);
      } else {
        await discordUser.send(formatted.slice(0, 2000));
        for (let i = 2000; i < formatted.length; i += 2000) {
          await discordUser.send(formatted.slice(i, i + 2000));
        }
      }
      return true;
    } catch (err) {
      console.error(`[discord] Failed to send proactive message to ${userId}:`, err);
      return false;
    }
  }
}

export function createDiscordChannel(): Channel {
  return new DiscordChannel();
}
