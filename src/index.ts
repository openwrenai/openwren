import { config } from "./config";
import { initWorkspace } from "./workspace";
import { startGateway } from "./gateway/server";
import { startChannels } from "./channels";

async function main() {
  console.log("[boot] Starting Open Wren...");
  console.log(`[boot] Default model: ${config.defaultModel}`);
  console.log(`[boot] Default agent: ${config.defaultAgent} (${config.agents[config.defaultAgent].name})`);
  console.log(`[boot] Workspace: ${config.workspaceDir}`);

  // Ensure workspace directory structure exists
  initWorkspace();

  // Start all configured channels (Telegram, Discord, WebSocket, etc.)
  // Must run before startGateway() so the WS channel can register its
  // connection handler before Fastify starts listening.
  startChannels();

  // Start Fastify gateway (health check, WebSocket /ws route)
  await startGateway();
}

main().catch((err) => {
  console.error("[boot] Fatal error:", err);
  process.exit(1);
});
