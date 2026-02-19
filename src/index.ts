import { config } from "./config";
import { initWorkspace } from "./workspace";
import { startGateway } from "./gateway/server";
import { createTelegramBot } from "./channels/telegram";

async function main() {
  console.log("[boot] Starting OrionBot...");
  console.log(`[boot] Provider: ${config.defaultProvider}`);
  console.log(`[boot] Default agent: ${config.defaultAgent} (${config.agents[config.defaultAgent].name})`);
  console.log(`[boot] Workspace: ${config.workspaceDir}`);

  // Ensure workspace directory structure exists
  initWorkspace();

  // Start Fastify gateway (health check + future webhook support)
  await startGateway();

  // Start Telegram bot (long polling)
  const bot = createTelegramBot();
  await bot.start({
    onStart: (botInfo) => {
      console.log(`[telegram] Bot started: @${botInfo.username}`);
      console.log(`[telegram] Send a message to your bot to begin.`);
    },
  });
}

main().catch((err) => {
  console.error("[boot] Fatal error:", err);
  process.exit(1);
});
