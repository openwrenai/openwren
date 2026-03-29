/**
 * WebSocket Channel
 *
 * Bidirectional JSON channel for CLI clients and future Web UI.
 * Clients connect to ws://127.0.0.1:3000/ws?token=<secret>, then:
 *   - Send JSON messages to interact with agents
 *   - Receive a live stream of ALL bus events (from every channel)
 *
 * Unlike Telegram/Discord, this channel doesn't own a route directly —
 * it sets a connection handler via setWsConnectionHandler(), and the
 * gateway registers the /ws route before Fastify starts listening.
 *
 * Auth: single shared bearer token (gateway.wsToken in config).
 * All connected clients map to the first user in config (Phase 4
 * simplification — per-user WS tokens deferred to a later phase).
 */

import * as crypto from "crypto";
import { WebSocket } from "ws";
import { config } from "../config";
import { runAgentLoop } from "../agent/loop";
import { handleCommand } from "./commands";
import { bus, BusEventName, BusEvents } from "../events";
import { setWsConnectionHandler } from "../gateway/server";
import type { Channel } from "./types";

// ---------------------------------------------------------------------------
// WS client → server message types (discriminated union on `type`)
// ---------------------------------------------------------------------------

/** Send a chat message to an agent. */
interface WsSendMessage {
  type: "message";
  agentId: string; // which agent to talk to (e.g. "atlas")
  text: string;    // the user's message
}

/** Reply to a tool confirmation prompt (shell command approval). */
interface WsConfirmResponse {
  type: "confirm_response";
  nonce: string;                    // echoes the nonce from the confirm_request event
  answer: "yes" | "no" | "always";  // "always" = approve and whitelist for this agent
}

/** Request a system status snapshot (agents, channels, uptime). */
interface WsStatusRequest {
  type: "status";
}

/** All possible messages a WS client can send. */
type WsClientMessage = WsSendMessage | WsConfirmResponse | WsStatusRequest;

// ---------------------------------------------------------------------------
// Scheduler status provider
//
// A function that returns live scheduler status, registered by index.ts after
// the scheduler starts. Kept here as a callback to avoid a circular import:
//   websocket.ts → scheduler/index.ts → runner.ts → channels/index.ts → websocket.ts
// ---------------------------------------------------------------------------

type SchedulerStatusFn = () => {
  enabled: boolean;
  jobs: { total: number; enabled: number };
  nextRun: { jobId: string | null; time: string } | null;
  queuePending: number;
  queueProcessing: boolean;
};

let schedulerStatusProvider: SchedulerStatusFn | null = null;

/**
 * Register the scheduler status getter. Called once by index.ts after
 * startScheduler() so the WS status response includes scheduler info.
 */
export function setSchedulerStatusProvider(fn: SchedulerStatusFn): void {
  schedulerStatusProvider = fn;
}

// ---------------------------------------------------------------------------
// Connected client tracking
// ---------------------------------------------------------------------------

/**
 * WebSocket uses nonce-based structured JSON for confirmations (not text parsing),
 * so it manages its own pending map rather than using the shared confirm.ts module.
 * The confirm callback still returns a standard ConfirmFn-compatible promise.
 */
interface PendingConfirm {
  nonce: string;
  resolve: (answer: boolean | "always") => void;
}

/** State for a single connected WebSocket client. */
interface ConnectedClient {
  socket: WebSocket;
  userId: string;                                     // resolved config user ID
  pendingConfirmations: Map<string, PendingConfirm>;  // nonce → pending confirm
  rateTimestamps: number[];                           // sliding window for rate limiting
}

/** All currently connected clients. */
const clients = new Set<ConnectedClient>();

// ---------------------------------------------------------------------------
// Broadcast — forwards a bus event to every connected WS client
// ---------------------------------------------------------------------------

function broadcast<K extends BusEventName>(type: K, payload: BusEvents[K]): void {
  const message = JSON.stringify({ type, payload });
  for (const client of clients) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(message);
    }
  }
}

// ---------------------------------------------------------------------------
// Auth — constant-time token comparison to prevent timing attacks
// ---------------------------------------------------------------------------

function validateToken(provided: string): boolean {
  const expected = config.gateway.wsToken;
  if (!expected || !provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Rate limiting — sliding window, same config as Telegram/Discord
// ---------------------------------------------------------------------------

function isRateLimited(client: ConnectedClient): boolean {
  const { maxMessages, windowSeconds } = config.channels.rateLimit;
  const windowMs = windowSeconds * 1000;
  const now = Date.now();

  // Drop timestamps outside the current window
  client.rateTimestamps = client.rateTimestamps.filter((t) => now - t < windowMs);

  if (client.rateTimestamps.length >= maxMessages) {
    return true;
  }

  client.rateTimestamps.push(now);
  return false;
}

// ---------------------------------------------------------------------------
// Send helper — sends a typed JSON message to a single client
// ---------------------------------------------------------------------------

function sendTo(client: ConnectedClient, type: string, payload: unknown): void {
  if (client.socket.readyState === WebSocket.OPEN) {
    client.socket.send(JSON.stringify({ type, payload }));
  }
}

// ---------------------------------------------------------------------------
// Message handler — dispatches a parsed client message by type
// ---------------------------------------------------------------------------

async function handleMessage(client: ConnectedClient, msg: WsClientMessage): Promise<void> {

  // --- Status request: emit a snapshot of the running system ---
  if (msg.type === "status") {
    bus.emit("status", {
      agents: Object.entries(config.agents).map(([id, a]) => ({ id, name: a.name })),
      channels: ["telegram", "discord", "websocket"],
      uptime: Math.floor(process.uptime()),
      scheduler: schedulerStatusProvider ? schedulerStatusProvider() : null,
      timestamp: Date.now(),
    });
    return;
  }

  // --- Confirm response: resolve the pending tool confirmation promise ---
  if (msg.type === "confirm_response") {
    const pending = client.pendingConfirmations.get(msg.nonce);
    if (!pending) return; // stale or unknown nonce — silently ignore
    client.pendingConfirmations.delete(msg.nonce);

    if (msg.answer === "always") pending.resolve("always");
    else if (msg.answer === "yes") pending.resolve(true);
    else pending.resolve(false);
    return;
  }

  // --- Chat message: validate, then run the agent loop ---
  if (msg.type === "message") {
    if (!msg.text?.trim()) {
      sendTo(client, "error", { error: "Empty message" });
      return;
    }

    if (isRateLimited(client)) {
      sendTo(client, "error", { error: "Rate limited" });
      return;
    }

    // Fall back to default agent if client didn't specify one
    const agentId = msg.agentId ?? config.defaultAgent;
    const agentConfig = config.agents[agentId];
    if (!agentConfig) {
      sendTo(client, "error", { error: `Unknown agent: ${agentId}` });
      return;
    }

    const text = msg.text.trim();

    // Check for slash commands (/new, /reset) before reaching the agent loop
    const commandResponse = handleCommand(text, client.userId);
    if (commandResponse !== null) {
      sendTo(client, "message", { agentId, text: commandResponse });
      return;
    }

    console.log(`[websocket] ${agentConfig.name} ← ${client.userId}: ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}`);

    // Bus: notify observers that a message arrived
    bus.emit("message_in", {
      channel: "websocket",
      userId: client.userId,
      agentId,
      agentName: agentConfig.name,
      text,
      timestamp: Date.now(),
    });

    // Bus: notify observers that the agent is thinking
    bus.emit("agent_typing", {
      channel: "websocket",
      userId: client.userId,
      agentId,
      agentName: agentConfig.name,
      timestamp: Date.now(),
    });

    // Confirm callback — sends a confirm_request to THIS specific client,
    // then waits for a confirm_response with the matching nonce.
    // The returned promise resolves when the client replies (or disconnects).
    const confirm = (command: string, reason?: string): Promise<boolean | "always"> => {
      const nonce = crypto.randomUUID();
      return new Promise((resolve) => {
        client.pendingConfirmations.set(nonce, { nonce, resolve });
        sendTo(client, "confirm_request", {
          nonce,
          agentId,
          agentName: agentConfig.name,
          command,
          reason,
          timestamp: Date.now(),
        });
      });
    };

    try {
      const result = await runAgentLoop(client.userId, agentId, agentConfig, text, confirm);
      console.log(
        `[websocket] ${agentConfig.name} reply: ${result.text.slice(0, 120)}${result.text.length > 120 ? "..." : ""}`
      );

      // Bus: broadcast the agent's response to WS observers
      bus.emit("message_out", {
        channel: "websocket",
        userId: client.userId,
        agentId,
        agentName: agentConfig.name,
        text: result.text,
        compacted: result.compacted,
        nearThreshold: result.nearThreshold,
        timestamp: Date.now(),
      });

      if (result.compacted) {
        // Bus: notify observers that session history was compacted
        bus.emit("session_compacted", {
          userId: client.userId,
          agentId,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error("[websocket] Error running agent loop:", err);
      // Bus: notify observers that the agent loop failed
      bus.emit("agent_error", {
        channel: "websocket",
        userId: client.userId,
        agentId,
        agentName: agentConfig.name,
        error,
        timestamp: Date.now(),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// WebSocketChannel
//
// Wires up two things in start():
// 1. Bus subscriptions — listens to all bus events and broadcasts them to
//    every connected client (this is how WS clients see Telegram/Discord activity)
// 2. Connection handler — passed to the gateway via setWsConnectionHandler().
//    The gateway registers the /ws route before Fastify calls listen().
// ---------------------------------------------------------------------------

class WebSocketChannel implements Channel {
  readonly name = "websocket";

  isConfigured(): boolean {
    return !!config.gateway.wsToken;
  }

  start(): void {
    // 1. Subscribe to every bus event and relay to all connected WS clients.
    //    This is what makes WS a "live view" of the entire system — events
    //    emitted by Telegram, Discord, or other WS clients all flow through here.
    const eventNames: BusEventName[] = [
      "message_in",
      "message_out",
      "agent_typing",
      "session_compacted",
      "agent_error",
      "status",
      "confirm_request",
      "schedule_run",
      "schedule_error",
    ];
    for (const eventName of eventNames) {
      bus.on(eventName, (payload) => broadcast(eventName, payload));
    }

    // 2. Register the connection handler. The gateway calls this handler for
    //    each new /ws connection. We handle auth, client tracking, and message
    //    parsing here — the gateway only owns the route and Fastify plumbing.
    setWsConnectionHandler((socket: WebSocket, request: any) => {
      // Auth: extract token from ?token= query param and validate
      const url = new URL(request.url ?? "", `http://${request.hostname}`);
      const token = url.searchParams.get("token") ?? "";

      if (!validateToken(token)) {
        socket.close(4001, "Unauthorized");
        return;
      }

      // Phase 4 simplification: single shared token — all WS clients map to
      // the first user in config. Per-user WS auth deferred to a later phase.
      const userId = Object.keys(config.users)[0] ?? "owner";

      const client: ConnectedClient = {
        socket,
        userId,
        pendingConfirmations: new Map(),
        rateTimestamps: [],
      };
      clients.add(client);
      console.log(`[websocket] Client connected (userId: ${userId})`);

      // Handle incoming messages — parse JSON and dispatch to handleMessage
      socket.on("message", async (raw: Buffer) => {
        let msg: WsClientMessage;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          sendTo(client, "error", { error: "Invalid JSON" });
          return;
        }

        await handleMessage(client, msg);
      });

      // On disconnect: reject any pending confirmations so the agent loop
      // doesn't hang forever waiting for a yes/no that will never come.
      socket.on("close", () => {
        for (const pending of client.pendingConfirmations.values()) {
          pending.resolve(false);
        }
        client.pendingConfirmations.clear();
        clients.delete(client);
        console.log("[websocket] Client disconnected");
      });

      socket.on("error", (err) => {
        console.error("[websocket] Socket error:", err);
      });
    });
  }

  async stop(): Promise<void> {
    for (const client of clients) {
      client.socket.close(1001, "Server shutting down");
    }
    clients.clear();
  }
}

export function createWebSocketChannel(): Channel {
  return new WebSocketChannel();
}
