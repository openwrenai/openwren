import { config } from "./config";
import { initWorkspace } from "./workspace";
import { startGateway } from "./gateway/server";
import { createTelegramBot, createAgentBots } from "./channels/telegram";

async function main() {
  console.log("[boot] Starting OrionBot...");
  console.log(`[boot] Provider: ${config.defaultProvider}`);
  console.log(`[boot] Default agent: ${config.defaultAgent} (${config.agents[config.defaultAgent].name})`);
  console.log(`[boot] Workspace: ${config.workspaceDir}`);

  // Ensure workspace directory structure exists
  initWorkspace();

  // Start Fastify gateway (health check + future webhook support)
  await startGateway();

  // Start main Telegram bot (long polling, handles prefix routing)
  const mainBot = createTelegramBot();
  await mainBot.start({
    onStart: (botInfo) => {
      console.log(`[telegram] Main bot started: @${botInfo.username}`);
      console.log(`[telegram] Send a message to your bot to begin.`);
    },
  });

  // Start dedicated per-agent bots (if any have telegramToken configured)
  const agentBots = createAgentBots();
  for (const { bot, agentName } of agentBots) {
    await bot.start({
      onStart: (botInfo) => {
        console.log(`[telegram] ${agentName} bot started: @${botInfo.username}`);
      },
    });
  }
}

main().catch((err) => {
  console.error("[boot] Fatal error:", err);
  process.exit(1);
});
