import { config } from "./config";
import { initWorkspace } from "./workspace";
import { startGateway } from "./gateway/server";
import { createBots } from "./channels/telegram";

async function main() {
  console.log("[boot] Starting Open Wren...");
  console.log(`[boot] Provider: ${config.defaultProvider}`);
  console.log(`[boot] Default agent: ${config.defaultAgent} (${config.agents[config.defaultAgent].name})`);
  console.log(`[boot] Workspace: ${config.workspaceDir}`);

  // Ensure workspace directory structure exists
  initWorkspace();

  // Start Fastify gateway (health check + future webhook support)
  await startGateway();

  // Start all Telegram bots — one per agent with a telegramToken
  // bot.start() never resolves (blocks until stopped), so don't await
  const bots = createBots();
  for (const { bot, agentName, isDefault } of bots) {
    bot.start({
      onStart: (botInfo) => {
        if (isDefault) {
          console.log(`[telegram] ${agentName} bot started (default): @${botInfo.username}`);
        } else {
          console.log(`[telegram] ${agentName} bot started: @${botInfo.username}`);
        }
      },
    });
  }
}

main().catch((err) => {
  console.error("[boot] Fatal error:", err);
  process.exit(1);
});
