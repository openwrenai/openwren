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

const WORKSPACE = process.env.OPENWREN_HOME
  ? path.resolve(process.env.OPENWREN_HOME.replace(/^~\//, os.homedir() + "/"))
  : path.join(os.homedir(), ".openwren");
const PID_FILE = path.join(WORKSPACE, "openwren.pid");
const LOG_FILE = path.join(WORKSPACE, "openwren.log");
const ENV_FILE = path.join(WORKSPACE, ".env");
const DEFAULT_PORT = 3000;

/** true when running via tsx (dev), false when running compiled JS */
const IS_DEV = import.meta.filename.endsWith(".ts");

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
 * Dev mode: preloads tsx/esm to run src/index.ts directly.
 * Production: runs compiled dist/index.js.
 */
function resolveServerArgs(): string[] {
  if (IS_DEV) {
    const entry = path.join(import.meta.dirname, "index.ts");
    return ["--import", "tsx/esm", entry];
  }
  return [path.join(import.meta.dirname, "index.js")];
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
    cwd: path.resolve(import.meta.dirname, ".."),    // project root
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
        if (p.scheduler) {
          const s = p.scheduler;
          const jobStr = `${s.jobs.total} jobs (${s.jobs.enabled} enabled)`;
          const nextStr = s.nextRun
            ? `next: ${fmtDate(s.nextRun.time)} (${s.nextRun.jobId})`
            : "none scheduled";
          const queueStr = s.queueProcessing
            ? " — running"
            : s.queuePending > 0
              ? ` — ${s.queuePending} queued`
              : "";
          console.log(`Schedule: ${jobStr}, ${nextStr}${queueStr}`);
        }
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
// Command: init — create workspace directory and template files
// ---------------------------------------------------------------------------

/**
 * Default soul.md content for the Atlas agent.
 * Duplicated here (not imported from workspace.ts) because the CLI is standalone.
 */
const DEFAULT_SOUL = `# Who You Are

You are Atlas, a personal AI assistant running locally on your owner's machine.
You are capable, direct, and thoughtful. You get things done without unnecessary filler.

## Memory

You have a persistent memory system that survives session resets and compaction.

- Use \`save_memory\` to store important facts, preferences, and context worth keeping across sessions.
- Use \`memory_search\` at the start of conversations that reference past context ("my project", "that thing we discussed", etc.).
- Memory files persist forever — session history does not.
- Prefix your memory keys with your name to avoid collisions with other agents (e.g. \`atlas-user-prefs\`, \`atlas-projects\`).

## Tools

You have access to tools for reading/writing files, running whitelisted shell commands, and searching memory.
Use them proactively when they help you give a better answer. Don't ask for permission to use a tool — just use it.

## Style

- Be concise. Skip preamble and filler phrases.
- If you don't know something, say so directly.
- If a task is ambiguous, ask one clarifying question — not five.
- Format responses with markdown when it aids readability (code blocks, lists, headers).
`;

function cmdInit(args: string[]): void {
  const force = args.includes("--force");

  // Check if workspace already exists
  const configPath = path.join(WORKSPACE, "openwren.json");
  if (fs.existsSync(configPath) && !force) {
    console.log(`Open Wren is already initialized at ${WORKSPACE}`);
    console.log("Use --force to overwrite existing files.");
    return;
  }

  // Resolve templates directory relative to this script.
  // In compiled mode: dist/cli.js → dist/templates/
  // In dev mode: src/cli.ts → src/templates/
  const templatesDir = path.join(import.meta.dirname, "templates");

  if (!fs.existsSync(templatesDir)) {
    console.error(`Templates not found at ${templatesDir}`);
    console.error("This is a build error — templates should be in dist/templates/");
    process.exit(1);
  }

  // 1. Create directory structure — minimal scaffolding only.
  // Agent-specific dirs (sessions, memory, workspace) are created by
  // initWorkspace() on first boot, based on agents defined in config.
  const dirs = [
    WORKSPACE,
    path.join(WORKSPACE, "data"),
    path.join(WORKSPACE, "teams"),
    path.join(WORKSPACE, "agents"),
    path.join(WORKSPACE, "agents", "atlas"),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  console.log(`✓ Created ${WORKSPACE}/`);

  // 2. Write template config
  const configTemplate = fs.readFileSync(path.join(templatesDir, "openwren.json"), "utf-8");
  fs.writeFileSync(configPath, configTemplate, "utf-8");
  console.log("✓ Created openwren.json");

  // 3. Write template .env
  const envPath = path.join(WORKSPACE, ".env");
  const envTemplate = fs.readFileSync(path.join(templatesDir, "env.template"), "utf-8");
  fs.writeFileSync(envPath, envTemplate, "utf-8");
  console.log("✓ Created .env");

  // 4. Write template security.json
  const securityPath = path.join(WORKSPACE, "security.json");
  if (!fs.existsSync(securityPath) || force) {
    const securityTemplate = fs.readFileSync(path.join(templatesDir, "security.json"), "utf-8");
    fs.writeFileSync(securityPath, securityTemplate, "utf-8");
    console.log("✓ Created security.json — shell permissions and path protection");
  }

  // 6. Write default Atlas soul file
  const soulPath = path.join(WORKSPACE, "agents", "atlas", "soul.md");
  if (!fs.existsSync(soulPath) || force) {
    fs.writeFileSync(soulPath, DEFAULT_SOUL, "utf-8");
    console.log("✓ Created agents/atlas/soul.md");
  }

  // 7. Print next steps
  console.log(`
Setup complete! Next steps:

  1. Add your API keys in ${WORKSPACE}/.env
  2. Uncomment and edit settings in ${WORKSPACE}/openwren.json
  3. Run: openwren start
`);
}

// ---------------------------------------------------------------------------
// Command: schedule — manage scheduled jobs via REST API
// ---------------------------------------------------------------------------

/** Base URL for the schedule REST API on the running daemon. */
function apiUrl(path: string): string {
  const port = getPort();
  return `http://127.0.0.1:${port}${path}`;
}

/** Make an authenticated HTTP request to the daemon's REST API. */
async function apiRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: any }> {
  const token = readWsToken();
  if (!token) {
    console.error("WS_TOKEN not set in ~/.openwren/.env — cannot connect to API.");
    process.exit(1);
  }

  const headers: Record<string, string> = { "Authorization": `Bearer ${token}` };
  if (body) headers["Content-Type"] = "application/json";

  const options: RequestInit = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(apiUrl(path), options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** Format a date string for display (compact). */
function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("sv-SE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function cmdSchedule(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "list": {
      const { status, data } = await apiRequest("GET", "/api/schedules");
      if (status !== 200) {
        console.error("Failed to fetch schedules:", data.error ?? status);
        return;
      }

      const jobs = data.jobs as any[];
      if (jobs.length === 0) {
        console.log("No scheduled jobs.");
        return;
      }

      // Table header
      console.log(
        "ID".padEnd(25) +
        "Name".padEnd(25) +
        "Schedule".padEnd(20) +
        "Agent".padEnd(12) +
        "Status".padEnd(10) +
        "Next Run"
      );
      console.log("-".repeat(100));

      for (const j of jobs) {
        const schedule = j.schedule?.cron ?? j.schedule?.every ?? j.schedule?.at ?? "?";
        const status = j.enabled ? "enabled" : "disabled";
        console.log(
          j.jobId.padEnd(25) +
          (j.name ?? "").slice(0, 24).padEnd(25) +
          schedule.slice(0, 19).padEnd(20) +
          (j.agent ?? "").padEnd(12) +
          status.padEnd(10) +
          fmtDate(j.nextRun)
        );
      }
      break;
    }

    case "create": {
      // Parse --flag value pairs from args (args[0] is "create", skip it)
      const flags: Record<string, string> = {};
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("--") && i + 1 < args.length) {
          flags[arg.slice(2)] = args[++i];
        }
      }

      let name: string;
      let agent: string;
      let scheduleStr: string;
      let prompt: string;
      let channel: string;
      let user: string;

      if (flags.name && flags.schedule && flags.prompt) {
        // Inline mode — all required flags provided
        name = flags.name;
        agent = flags.agent ?? "atlas";
        scheduleStr = flags.schedule;
        prompt = flags.prompt;
        channel = flags.channel ?? "telegram";
        user = flags.user ?? "owner";
      } else {
        // Interactive mode — prompt for missing values
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

        name = await ask("Job name: ");
        agent = await ask("Agent (default: atlas): ") || "atlas";
        console.log('Schedule format: cron:0 8 * * * | every:2h | at:2026-03-15T09:00:00 (or bare value)');
        scheduleStr = await ask("Schedule: ");
        prompt = await ask("Prompt (what the agent should do): ");
        channel = await ask("Channel (default: telegram): ") || "telegram";
        user = await ask("User (default: owner): ") || "owner";
        rl.close();
      }

      if (!name || !scheduleStr || !prompt) {
        console.error("Name, schedule, and prompt are required.");
        return;
      }

      // Parse schedule string into object
      // Supported formats (prefix or bare):
      //   cron:0 8 * * *    or   "0 8 * * *"        (auto-detect: contains * or 5+ fields)
      //   every:2h          or   2h                  (auto-detect: digits + m/h/d)
      //   at:2026-03-15T09:00   or   2026-03-15T09:00  (auto-detect: fallback)
      let schedule: Record<string, string>;
      if (/^(cron|every|at):/.test(scheduleStr)) {
        const colonIdx = scheduleStr.indexOf(":");
        schedule = { [scheduleStr.slice(0, colonIdx)]: scheduleStr.slice(colonIdx + 1) };
      } else {
        // Heuristic: if it contains spaces/stars it's cron, if it has m/h/d it's interval, otherwise at
        if (scheduleStr.includes("*") || scheduleStr.split(" ").length >= 5) {
          schedule = { cron: scheduleStr };
        } else if (/^\d+[mhd]$/.test(scheduleStr)) {
          schedule = { every: scheduleStr };
        } else {
          schedule = { at: scheduleStr };
        }
      }

      // Auto-append :00 seconds if at value has only HH:MM
      if (schedule.at && /T\d{2}:\d{2}$/.test(schedule.at)) {
        schedule.at += ":00";
      }

      const { status, data } = await apiRequest("POST", "/api/schedules", {
        name, agent, schedule, prompt, channel, user,
      });

      if (status === 201) {
        console.log(`✓ Created job "${data.jobId}"`);
      } else {
        console.error("Failed:", data.error ?? status);
      }
      break;
    }

    case "enable": {
      const jobId = args[1];
      if (!jobId) { console.error("Usage: openwren schedule enable <jobId>"); return; }
      const { status, data } = await apiRequest("POST", `/api/schedules/${jobId}/enable`);
      console.log(status === 200 ? `✓ Enabled "${jobId}"` : `Failed: ${data.error ?? status}`);
      break;
    }

    case "disable": {
      const jobId = args[1];
      if (!jobId) { console.error("Usage: openwren schedule disable <jobId>"); return; }
      const { status, data } = await apiRequest("POST", `/api/schedules/${jobId}/disable`);
      console.log(status === 200 ? `✓ Disabled "${jobId}"` : `Failed: ${data.error ?? status}`);
      break;
    }

    case "delete": {
      const jobId = args[1];
      if (!jobId) { console.error("Usage: openwren schedule delete <jobId>"); return; }
      const { status, data } = await apiRequest("DELETE", `/api/schedules/${jobId}`);
      console.log(status === 200 ? `✓ Deleted "${jobId}"` : `Failed: ${data.error ?? status}`);
      break;
    }

    case "run": {
      const jobId = args[1];
      if (!jobId) { console.error("Usage: openwren schedule run <jobId>"); return; }
      const { status, data } = await apiRequest("POST", `/api/schedules/${jobId}/run`);
      console.log(status === 200 ? `✓ Triggered "${jobId}"` : `Failed: ${data.error ?? status}`);
      break;
    }

    case "history": {
      const jobId = args[1];
      if (!jobId) { console.error("Usage: openwren schedule history <jobId>"); return; }
      const { status, data } = await apiRequest("GET", `/api/schedules/${jobId}/history`);
      if (status !== 200) { console.error("Failed:", data.error ?? status); return; }

      const runs = data.runs as any[];
      if (runs.length === 0) { console.log("No run history."); return; }

      console.log(
        "Time".padEnd(20) + "Status".padEnd(10) + "Duration".padEnd(12) +
        "Delivered".padEnd(12) + "Error"
      );
      console.log("-".repeat(70));

      for (const r of runs) {
        const time = new Date(r.ts).toLocaleString("sv-SE", {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
        });
        const dur = r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "-";
        const delivered = r.suppressed ? `no (${r.suppressed})` : r.delivered ? "yes" : "no";
        console.log(
          time.padEnd(20) + r.status.padEnd(10) + dur.padEnd(12) +
          delivered.padEnd(12) + (r.error ?? "")
        );
      }
      break;
    }

    default:
      console.log(`
Schedule Commands:
  openwren schedule list                List all scheduled jobs
  openwren schedule create              Create a new job (interactive prompts)
  openwren schedule create --name "..." --schedule "..." --prompt "..."
                                        Create inline (--agent, --channel, --user optional)
  openwren schedule enable <jobId>      Enable a disabled job
  openwren schedule disable <jobId>     Disable a job
  openwren schedule delete <jobId>      Delete a job and its history
  openwren schedule run <jobId>         Trigger immediate execution
  openwren schedule history <jobId>     Show run history for a job
`);
      break;
  }
}

// ---------------------------------------------------------------------------
// Command: usage — show token usage summary
// ---------------------------------------------------------------------------

async function cmdUsage(args: string[]): Promise<void> {
  // Parse flags: --days N, --agent X
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--") && i + 1 < args.length) {
      flags[arg.slice(2)] = args[++i];
    }
  }

  const queryParams: string[] = [];
  if (flags.days) queryParams.push(`days=${flags.days}`);
  if (flags.agent) queryParams.push(`agent=${flags.agent}`);
  if (flags.provider) queryParams.push(`provider=${flags.provider}`);

  const qs = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";
  const { status, data } = await apiRequest("GET", `/api/usage${qs}`);

  if (status !== 200) {
    console.error("Failed to fetch usage:", data.error ?? status);
    return;
  }

  const summary = data as {
    days: Record<string, { in: number; out: number }>;
    byAgent: Record<string, { in: number; out: number }>;
    byProvider: Record<string, { in: number; out: number }>;
    bySession: Record<string, { in: number; out: number; lastActive: string }>;
  };

  // Today's usage
  const today = new Date().toISOString().slice(0, 10);
  const todayUsage = summary.days[today];

  if (!todayUsage && Object.keys(summary.days).length === 0) {
    console.log("No usage data recorded yet.");
    return;
  }

  // Daily breakdown
  const sortedDays = Object.keys(summary.days).sort().reverse();
  if (sortedDays.length > 0) {
    console.log("Daily Usage:");
    console.log("  " + "Date".padEnd(14) + "Input".padStart(10) + "Output".padStart(10) + "Total".padStart(10));
    console.log("  " + "-".repeat(44));
    for (const day of sortedDays) {
      const d = summary.days[day];
      console.log(
        "  " + day.padEnd(14) +
        fmtTokens(d.in).padStart(10) +
        fmtTokens(d.out).padStart(10) +
        fmtTokens(d.in + d.out).padStart(10)
      );
    }
  }

  // By agent
  const agents = Object.keys(summary.byAgent);
  if (agents.length > 0) {
    console.log("\nBy Agent:");
    console.log("  " + "Agent".padEnd(20) + "Input".padStart(10) + "Output".padStart(10) + "Total".padStart(10));
    console.log("  " + "-".repeat(50));
    for (const agent of agents) {
      const a = summary.byAgent[agent];
      console.log(
        "  " + agent.padEnd(20) +
        fmtTokens(a.in).padStart(10) +
        fmtTokens(a.out).padStart(10) +
        fmtTokens(a.in + a.out).padStart(10)
      );
    }
  }

  // By provider
  const providers = Object.keys(summary.byProvider);
  if (providers.length > 0) {
    console.log("\nBy Provider:");
    console.log("  " + "Provider".padEnd(20) + "Input".padStart(10) + "Output".padStart(10) + "Total".padStart(10));
    console.log("  " + "-".repeat(50));
    for (const prov of providers) {
      const p = summary.byProvider[prov];
      console.log(
        "  " + prov.padEnd(20) +
        fmtTokens(p.in).padStart(10) +
        fmtTokens(p.out).padStart(10) +
        fmtTokens(p.in + p.out).padStart(10)
      );
    }
  }
}

/** Format token count with K/M suffixes for readability. */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`
Open Wren CLI

Usage: openwren <command> [options]

Commands:
  init              Initialize workspace (~/.openwren) with template files
  start             Start the bot as a background daemon
  stop              Stop the running daemon
  restart           Stop and restart the daemon
  status            Show running agents, channels, and uptime
  logs              Tail the daemon log file
  chat [agent]      Interactive terminal chat (default: atlas)
  schedule [cmd]    Manage scheduled jobs (list, create, enable, disable, delete, run, history)
  usage [options]   Show token usage summary (--days N, --agent X, --provider X)
`);
}

// ---------------------------------------------------------------------------
// Main — parse command and dispatch
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "init":    cmdInit(args);          break;
    case "start":   await cmdStart();       break;
    case "stop":    await cmdStop();        break;
    case "restart": await cmdRestart();     break;
    case "status":  await cmdStatus();      break;
    case "logs":    cmdLogs();              break;
    case "chat":     await cmdChat(args[0]);   break;
    case "schedule": await cmdSchedule(args); break;
    case "usage":    await cmdUsage(args);    break;
    default:         printUsage();            break;
  }
}

main().catch((err) => {
  console.error("CLI error:", err);
  process.exit(1);
});
