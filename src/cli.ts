#!/usr/bin/env node

/**
 * Open Wren CLI
 *
 * Process management and interactive terminal client for the Open Wren bot.
 * Completely standalone — does not import any modules from the main app,
 * so it starts fast and works even if the config or server code is broken.
 *
 * Commands:
 *   openwren start         Start the bot as a background daemon
 *   openwren stop          Stop the running daemon gracefully
 *   openwren restart       Stop and restart the daemon
 *   openwren status        Show running agents, channels, uptime (via WS)
 *   openwren logs          Tail the daemon log file
 *   openwren chat [agent]  Interactive terminal chat session (via WS)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import * as readline from "readline";
import { WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKSPACE = path.join(os.homedir(), ".openwren");
const PID_FILE = path.join(WORKSPACE, "openwren.pid");
const LOG_FILE = path.join(WORKSPACE, "openwren.log");
const ENV_FILE = path.join(WORKSPACE, ".env");
const DEFAULT_PORT = 3000;

/** true when running via ts-node (dev), false when running compiled JS */
const IS_DEV = __filename.endsWith(".ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads WS_TOKEN from ~/.openwren/.env by parsing the file line-by-line.
 * No dotenv import — keeps the CLI dependency-free from the main app.
 */
function readWsToken(): string {
  if (!fs.existsSync(ENV_FILE)) return "";
  const content = fs.readFileSync(ENV_FILE, "utf-8");

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const eqIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    if (key === "WS_TOKEN") {
      // Strip surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
      }
      return value;
    }
  }
  return "";
}

/**
 * Reads the PID from the PID file and verifies the process is alive.
 * Returns null if the file doesn't exist or the process is dead (cleans up stale PID file).
 */
function readPid(): number | null {
  if (!fs.existsSync(PID_FILE)) return null;

  const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
  if (isNaN(pid)) return null;

  try {
    process.kill(pid, 0); // signal 0 = just check if process exists
    return pid;
  } catch {
    // Process not running — stale PID file from a crash
    fs.unlinkSync(PID_FILE);
    return null;
  }
}

/**
 * Resolves the node args to spawn the server process.
 * Dev mode: preloads ts-node/register to run src/index.ts directly.
 * Production: runs compiled dist/index.js.
 */
function resolveServerArgs(): string[] {
  if (IS_DEV) {
    const entry = path.join(__dirname, "index.ts");
    return ["-r", "ts-node/register", entry];
  }
  return [path.join(__dirname, "index.js")];
}

/** Builds the WebSocket URL for connecting to the running gateway. */
function wsUrl(token: string, port: number = DEFAULT_PORT): string {
  return `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`;
}

/** Formats seconds into a human-readable uptime string (e.g. "2h 15m 30s"). */
function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Resolves the gateway port from PORT env var or default. */
function getPort(): number {
  return parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
}

// ---------------------------------------------------------------------------
// Command: start — spawn the server as a detached background daemon
// ---------------------------------------------------------------------------

async function cmdStart(): Promise<void> {
  const existingPid = readPid();
  if (existingPid) {
    console.log(`Open Wren is already running (PID: ${existingPid}).`);
    return;
  }

  // Ensure workspace exists (the daemon creates it too, but we need the log file path)
  if (!fs.existsSync(WORKSPACE)) {
    fs.mkdirSync(WORKSPACE, { recursive: true });
  }

  // Open log file for append — daemon stdout/stderr goes here
  const logFd = fs.openSync(LOG_FILE, "a");

  const child = spawn(process.execPath, resolveServerArgs(), {
    detached: true,                        // run independently of this process
    stdio: ["ignore", logFd, logFd],       // stdin closed, stdout+stderr to log file
    cwd: path.resolve(__dirname, ".."),    // project root
    env: { ...process.env },
  });

  if (child.pid) {
    fs.writeFileSync(PID_FILE, String(child.pid), "utf-8");
  }

  // Detach — let the daemon run after the CLI exits
  child.unref();
  fs.closeSync(logFd);

  // Brief wait to check if the process crashed immediately on startup
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const pid = readPid();
  if (pid) {
    console.log(`Open Wren started (PID: ${pid})`);
    console.log(`Logs: ${LOG_FILE}`);
  } else {
    console.error("Open Wren failed to start. Check the log:");
    console.error(`  tail -20 ${LOG_FILE}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command: stop — read PID file and send SIGTERM
// ---------------------------------------------------------------------------

async function cmdStop(): Promise<void> {
  const pid = readPid();
  if (!pid) {
    console.log("Open Wren is not running.");
    return;
  }

  console.log(`Stopping Open Wren (PID: ${pid})...`);
  process.kill(pid, "SIGTERM");

  // Wait for process to exit (up to 5 seconds)
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      process.kill(pid, 0); // still alive?
    } catch {
      // Process has exited
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
      console.log("Open Wren stopped.");
      return;
    }
  }

  // Process didn't exit in time — force kill
  console.log("Force killing...");
  try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  console.log("Open Wren stopped.");
}

// ---------------------------------------------------------------------------
// Command: restart — stop + start
// ---------------------------------------------------------------------------

async function cmdRestart(): Promise<void> {
  const pid = readPid();
  if (pid) {
    await cmdStop();
    // Brief pause to let the port release before starting again
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await cmdStart();
}

// ---------------------------------------------------------------------------
// Command: status — connect to WS gateway and print system info
// ---------------------------------------------------------------------------

async function cmdStatus(): Promise<void> {
  const pid = readPid();
  if (!pid) {
    console.log("Open Wren is not running.");
    return;
  }

  const token = readWsToken();
  if (!token) {
    // Fall back to basic PID-only status if WS isn't configured
    console.log(`Open Wren is running (PID: ${pid})`);
    console.log("WS_TOKEN not set — cannot fetch detailed status.");
    return;
  }

  return new Promise<void>((resolve) => {
    const ws = new WebSocket(wsUrl(token, getPort()));

    const timeout = setTimeout(() => {
      console.log(`Open Wren is running (PID: ${pid})`);
      console.log("Could not connect to gateway for detailed status.");
      ws.close();
      resolve();
    }, 5000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "status" }));
    });

    ws.on("message", (raw: Buffer) => {
      const data = JSON.parse(raw.toString());
      if (data.type === "status") {
        clearTimeout(timeout);
        const p = data.payload;
        console.log(`Open Wren is running (PID: ${pid})`);
        console.log(`Uptime:   ${formatUptime(p.uptime)}`);
        console.log(`Agents:   ${p.agents.map((a: any) => `${a.name} (${a.id})`).join(", ")}`);
        console.log(`Channels: ${p.channels.join(", ")}`);
        ws.close();
        resolve();
      }
    });

    ws.on("error", () => {
      clearTimeout(timeout);
      console.log(`Open Wren is running (PID: ${pid})`);
      console.log("Could not connect to gateway for detailed status.");
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Command: logs — tail the daemon log file
// ---------------------------------------------------------------------------

function cmdLogs(): void {
  if (!fs.existsSync(LOG_FILE)) {
    console.log("No log file yet. Start the daemon first: openwren start");
    return;
  }

  // Spawn tail -f and pipe directly to the terminal
  const tail = spawn("tail", ["-f", "-n", "50", LOG_FILE], {
    stdio: "inherit",
  });

  // Clean exit on Ctrl+C (don't print stack trace)
  process.on("SIGINT", () => {
    tail.kill();
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Command: chat — interactive terminal REPL via WebSocket
// ---------------------------------------------------------------------------

async function cmdChat(agentId?: string): Promise<void> {
  const token = readWsToken();
  if (!token) {
    console.error("WS_TOKEN not set in ~/.openwren/.env — cannot connect.");
    process.exit(1);
  }

  agentId = agentId ?? "atlas";

  const ws = new WebSocket(wsUrl(token, getPort()));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  /** Prompt the user for their next message. */
  function prompt(): void {
    rl.question("\nyou> ", (input) => {
      const text = input.trim();
      if (!text) {
        prompt();
        return;
      }

      ws.send(JSON.stringify({ type: "message", agentId, text }));
      process.stdout.write("\nthinking...");
    });
  }

  ws.on("open", () => {
    console.log(`Connected to ${agentId}. Type your message (Ctrl+C to exit).`);
    prompt();
  });

  ws.on("message", (raw: Buffer) => {
    const data = JSON.parse(raw.toString());

    // Agent response — only show responses to OUR messages (websocket channel, our agent)
    if (data.type === "message_out" &&
        data.payload.agentId === agentId &&
        data.payload.channel === "websocket") {
      // Clear "thinking..." line
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);

      console.log(`\n${data.payload.agentName}> ${data.payload.text}`);

      if (data.payload.compacted) {
        console.log("\n📦 Session compacted — older messages summarized.");
      }
      if (data.payload.nearThreshold) {
        console.log("\n⚠️ Context is almost full — compaction will run soon.");
      }

      prompt();
    }

    // Tool confirmation — the server sends this directly to our connection
    // when the agent wants to run a shell command that needs approval.
    if (data.type === "confirm_request" && data.payload.agentId === agentId) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);

      console.log(`\n⚠️  ${data.payload.agentName} wants to run: ${data.payload.command}`);

      rl.question("Approve? (yes/no/always): ", (answer) => {
        const normalized = answer.trim().toLowerCase();
        let wsAnswer: "yes" | "no" | "always" = "no";
        if (normalized === "yes" || normalized === "y") wsAnswer = "yes";
        else if (normalized === "always") wsAnswer = "always";

        ws.send(JSON.stringify({
          type: "confirm_response",
          nonce: data.payload.nonce,
          answer: wsAnswer,
        }));

        process.stdout.write("\nthinking...");
      });
    }

    // Error from server
    if (data.type === "error") {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`\n❌ ${data.payload.error}`);
      prompt();
    }

    // Agent error (agent loop failed)
    if (data.type === "agent_error" &&
        data.payload.agentId === agentId &&
        data.payload.channel === "websocket") {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`\n❌ ${data.payload.agentName}: ${data.payload.error}`);
      prompt();
    }
  });

  ws.on("error", () => {
    console.error("\nCould not connect to gateway. Is Open Wren running?");
    rl.close();
    process.exit(1);
  });

  ws.on("close", () => {
    console.log("\nDisconnected.");
    rl.close();
    process.exit(0);
  });

  // Graceful exit on Ctrl+C
  rl.on("close", () => {
    ws.close();
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`
Open Wren CLI

Usage: openwren <command> [options]

Commands:
  start           Start the bot as a background daemon
  stop            Stop the running daemon
  restart         Stop and restart the daemon
  status          Show running agents, channels, and uptime
  logs            Tail the daemon log file
  chat [agent]    Interactive terminal chat (default: atlas)
`);
}

// ---------------------------------------------------------------------------
// Main — parse command and dispatch
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "start":   await cmdStart();       break;
    case "stop":    await cmdStop();        break;
    case "restart": await cmdRestart();     break;
    case "status":  await cmdStatus();      break;
    case "logs":    cmdLogs();              break;
    case "chat":    await cmdChat(args[0]); break;
    default:        printUsage();           break;
  }
}

main().catch((err) => {
  console.error("CLI error:", err);
  process.exit(1);
});
