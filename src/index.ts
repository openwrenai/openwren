import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import { config } from "./config";
import { initWorkspace } from "./workspace";
import { startGateway, app } from "./gateway/server";
import { startChannels, stopChannels } from "./channels";

// ---------------------------------------------------------------------------
// Timestamped logging — prepend [YYYY-MM-DD HH:MM:SS] to all console output.
// Applied once here so every module in the process gets timestamps for free.
// Works in both foreground (npm run dev) and daemon mode (openwren start).
// ---------------------------------------------------------------------------

const originalLog = console.log;
const originalError = console.error;

function timestamp(): string {
  const d = new Date();
  const date = d.toLocaleDateString("sv-SE"); // YYYY-MM-DD (ISO format)
  const time = d.toLocaleTimeString("en-GB", { hour12: false });
  return `${date} ${time}`;
}

console.log = (...args: any[]) => {
  originalLog(`[${timestamp()}]`, ...args);
};

console.error = (...args: any[]) => {
  originalError(`[${timestamp()}]`, ...args);
};

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

  // Register graceful shutdown — triggered by `openwren stop` (SIGTERM)
  // or Ctrl+C in foreground mode (SIGINT).
  const shutdown = async (signal: string) => {
    console.log(`\n[boot] Received ${signal}, shutting down...`);
    await stopChannels();
    if (app) await app.close();

    // Clean up PID file if it exists (daemon mode)
    const pidFile = path.join(config.workspaceDir, "openwren.pid");
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);

    console.log("[boot] Goodbye.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[boot] Fatal error:", err);
  process.exit(1);
});
