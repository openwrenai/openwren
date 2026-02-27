import { config } from "./config";
import { initWorkspace } from "./workspace";
import { startGateway } from "./gateway/server";
import { startChannels } from "./channels";

async function main() {
  console.log("[boot] Starting Open Wren...");
  console.log(`[boot] Provider: ${config.defaultProvider}`);
  console.log(`[boot] Default agent: ${config.defaultAgent} (${config.agents[config.defaultAgent].name})`);
  console.log(`[boot] Workspace: ${config.workspaceDir}`);

  // Ensure workspace directory structure exists
  initWorkspace();

  // Start Fastify gateway (health check + future webhook support)
  await startGateway();

  // Start all configured channels (Telegram, Discord, etc.)
  startChannels();
}

main().catch((err) => {
  console.error("[boot] Fatal error:", err);
  process.exit(1);
});
