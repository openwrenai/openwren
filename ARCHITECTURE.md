# Open Wren — Architecture Reference

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js (v22+), TypeScript |
| Messaging: Telegram | grammY (`grammy`) — modern Telegram Bot API wrapper |
| Messaging: Discord | discord.js (`discord.js`) — DM-only, one bot per agent, Message Content Intent required |
| HTTP/WS | Fastify + `@fastify/websocket` — HTTP server with WebSocket upgrade for CLI/Web UI |
| LLM: Cloud | Anthropic SDK (`@anthropic-ai/sdk`) — per-agent model selection with cascading fallbacks |
| LLM: Local | Ollama REST API (Phase 7) |
| Config | JSON5 (`json5`) — `~/.openwren/openwren.json` with dot-notation keys |
| Env | `dotenv` — secrets in `~/.openwren/.env` |
| Database | SQLite (`better-sqlite3`) + Drizzle ORM (`drizzle-orm`) — orchestrator workflow state |

Core dependencies: `@anthropic-ai/sdk`, `grammy`, `discord.js`, `fastify`, `@fastify/websocket`, `dotenv`, `json5`, `better-sqlite3`, `drizzle-orm`. Dev: `drizzle-kit` (migration generation).

> **Discord setup:** Before running a Discord bot, enable **Message Content Intent** in the Discord Developer Portal → your app → Bot → Privileged Gateway Intents. Without it the bot receives no message text.

---

## Architecture

```
You (Telegram / Discord / WebSocket)
        │
   ┌────▼────────────────┐
   │  Channel Layer       │  ← Channel interface, adapters, auth, rate limiting
   │  (channels/)         │  ← emits events to the bus as side effects
   └────────┬─────────────┘
            │                          ┌──────────────────┐
     ┌──────▼──────┐                   │  Event Bus        │
     │  Agent Loop  │  ← ReAct loop    │  (events.ts)      │  ← typed EventEmitter singleton
     │  (loop.ts)   │  (bus-unaware)   │  message_in/out   │  ← channels emit, WS clients subscribe
     └──────┬───────┘                   │  agent_typing     │
            │                          │  session_compacted │
    ┌───────▼────────┐                 │  agent_error      │
    │  LLM Provider  │                 │  status            │
    └───────┬────────┘                 └──────────────────┘
            │  tool_use response                │
    ┌───────▼────────┐                 ┌────────▼─────────┐
    │  Tool Executor │                 │  WebSocket /ws    │  ← CLI, Web UI, external observers
    └───────┬────────┘                 │  (gateway)        │
            │                          └──────────────────┘
   ┌────────┼─────────┐
   ▼        ▼         ▼
shell    read/write  memory
(whitelist) (sandboxed) (persistent)
```

---

## Configuration

All defaults live in code (`defaultConfig` in `config.ts`). User overrides go in `~/.openwren/openwren.json` — a JSON5 file with flat dot-notation keys. Secrets reference env vars via `${env:VAR}` syntax, resolved from `~/.openwren/.env`.

Nothing reads `process.env` directly (except `PORT` for the gateway and `OPENWREN_HOME` for workspace path override). Everything flows: `openwren.json` → `${env:VAR}` → `.env`.

**Example openwren.json:**
```json5
{
  "defaultModel": "anthropic/claude-sonnet-4-6",
  "defaultFallback": "anthropic/claude-haiku-3-5",
  "providers.anthropic.apiKey": "${env:ANTHROPIC_API_KEY}",
  "users.owner.displayName": "Your Name",
  "users.owner.channelIds.telegram": "${env:OWNER_TELEGRAM_ID}",
  "bindings.telegram.atlas": "${env:TELEGRAM_BOT_TOKEN}",
  "bindings.telegram.einstein": "${env:EINSTEIN_TELEGRAM_TOKEN}",
  "agents.einstein.model": "anthropic/claude-sonnet-4-6",
  "timezone": "Europe/Stockholm",
}
```

**Bindings** connect agents to channels. Three separate concepts:
- `agents.*` — pure personality (name) + optional model override. Zero channel awareness.
- `channels.*` — shared transport settings (rate limit, auth behavior).
- `bindings.*` — the glue. Channel-first layout: `bindings.telegram.atlas` = the Telegram bot token Atlas uses.
- `gateway.*` — WebSocket settings (token-based auth for CLI/Web UI connections).

On first run, `~/.openwren/` is created with template `openwren.json` and `.env` files.

---

## Workspace Directory

```
~/.openwren/
├── openwren.json                         # User config (safe to share publicly)
├── .env                                  # Secrets (API keys, bot tokens)
├── openwren.pid                          # Daemon PID file (created by `openwren start`)
├── openwren.log                          # Daemon log file (stdout/stderr redirect)
├── sessions/                             # User-facing conversations (user-scoped)
│   └── {userId}/
│       ├── sessions.json                 # Index of WebUI sessions (main is implicit)
│       ├── main.jsonl                    # Default session — all channels hit this
│       ├── {uuid}.jsonl                  # Additional sessions from WebUI
│       └── archives/                     # Compacted/archived sessions
│           └── main-2026-03-22_04-00-00.jsonl
├── memory/
│   ├── atlas-user-prefs.md               # Persistent memory (agents prefix keys by convention)
│   └── atlas-projects.md
├── agents/
│   ├── atlas/
│   │   ├── soul.md                       # Atlas personality and instructions
│   │   ├── heartbeat.md                  # Optional heartbeat checklist (read fresh each cycle)
│   │   └── skills/                       # Per-agent skills (highest precedence)
│   ├── einstein/
│   │   └── soul.md
│   ├── wizard/
│   │   └── soul.md
│   └── personal_trainer/
│       └── soul.md
├── schedules/
│   ├── jobs.json                         # All scheduled jobs (loaded into memory on startup)
│   └── runs/                             # Run history JSONL per job (auto-pruned)
│       └── morning-briefing.jsonl
├── skills/                               # Global skills (visible to all agents)
│   └── custom-skill/
│       └── SKILL.md
└── exec-approvals.json                   # Shell commands approved once per agent
```

The workspace path defaults to `~/.openwren`. Overridable via `OPENWREN_HOME` env var (for testing or running multiple instances).

**Sessions** are ephemeral — they compact and archive over time. **Memory files** are permanent — they survive session resets, restarts, and compaction.

---

## Project Structure

```
src/
├── index.ts               # Entry point — timestamped logging, boot, SIGTERM/SIGINT shutdown
├── cli.ts                 # Standalone CLI — start/stop/restart/status/logs/chat (no app imports)
├── config.ts              # Config loader: defaults, JSON5 parse, deepSet, resolveEnvRefs
├── events.ts              # Typed event bus (EventEmitter singleton) — channels emit, WS subscribes
├── workspace.ts           # Ensures ~/.openwren/ directory structure exists
├── gateway/
│   ├── server.ts          # Fastify server + @fastify/websocket plugin, health check, exports app instance
│   └── routes/
│       └── schedules.ts   # REST API for schedule CRUD (used by CLI + future WebUI)
├── channels/
│   ├── index.ts           # Barrel: startChannels() + stopChannels() + deliverMessage() for scheduler
│   ├── types.ts           # Channel interface (name, isConfigured, start, stop, sendMessage?)
│   ├── telegram.ts        # Telegram adapter: TelegramChannel implements Channel
│   ├── discord.ts         # Discord adapter: DiscordChannel implements Channel (DM-only)
│   └── websocket.ts       # WebSocket adapter: registers /ws route, auth, bidirectional messaging
├── agent/
│   ├── loop.ts            # Core ReAct loop (think → tool → think → respond)
│   ├── history.ts         # JSONL session persistence, compaction, archival, timestamps, locking
│   ├── prompt.ts          # Loads soul.md + skills into system prompt
│   └── skills.ts          # Skill catalog builder: scan dirs, parse frontmatter, gate checks
├── providers/
│   ├── index.ts           # Provider interface, ProviderChain (cascading fallbacks), model chain resolution
│   ├── anthropic.ts       # Anthropic Claude implementation
│   └── ollama.ts          # Ollama local LLM implementation
├── search/
│   ├── index.ts           # SearchProvider interface, factory, SearchResult type
│   └── brave.ts           # Brave Search API implementation
├── tools/
│   ├── index.ts           # Tool registry, definitions, executor
│   ├── shell.ts           # Whitelisted shell command runner + list_shell_commands tool
│   ├── sanitize.ts        # Prompt injection detection (hard + soft) + untrusted content delimiters
│   ├── filesystem.ts      # Sandboxed file read/write
│   ├── memory.ts          # save_memory and memory_search tools
│   ├── skills.ts          # load_skill tool (on-demand skill activation)
│   ├── search.ts          # search_web tool (provider-agnostic, injection scan on snippets)
│   ├── fetch.ts           # fetch_url tool (readability + linkedom, markdown fast-path, injection scan)
│   └── schedule.ts        # manage_schedule tool (create/list/update/delete/enable/disable jobs)
├── scheduler/
│   ├── index.ts           # Scheduler core: load jobs, croner timers, CRUD, timezone helpers
│   ├── queue.ts           # FIFO job queue — sequential execution, one job at a time
│   ├── runner.ts          # Execute single job: agent loop → HEARTBEAT_OK check → deliver → log
│   ├── store.ts           # File I/O: schedules/jobs.json, run history JSONL, normalizeAtValue, generateJobId
│   └── heartbeat.ts       # Heartbeat timer: reads heartbeat.md, active hours, HEARTBEAT_OK suppression
├── orchestrator/
│   ├── schema.ts          # Drizzle ORM table definitions (workflows, tasks, task_deps, task_log)
│   ├── db.ts              # SQLite connection singleton, auto-migration on first access
│   ├── queue.ts           # Per-agent task queue (parallel across agents, sequential per agent)
│   ├── resolver.ts        # Dependency resolution, cascade-cancellation, deadlock detection
│   ├── runner.ts          # Task executor with auto-complete fallback
│   ├── notify.ts          # Manager wake-up on workflow completion/failure
│   ├── index.ts           # Barrel exports, event wiring, workflow recovery on restart
│   └── ARCHITECTURE.md    # Orchestrator design docs and event flow diagrams
├── skills/                # Bundled skills shipped with the package
│   ├── memory-management/ # autoload — teaches agents memory tools
│   ├── file-read/         # autoload — role-aware file read rules
│   ├── file-write/        # autoload — role-aware file write rules
│   ├── manager/           # autoload — top-level manager delegation patterns (gated: delegated=false)
│   ├── sub-manager/       # autoload — sub-manager delegation within existing workflow (gated: delegated=true)
│   ├── worker/            # autoload — task completion and progress reporting
│   ├── web-search/        # gated on search.provider config key
│   ├── web-fetch/         # no gate
│   ├── agent-browser/     # gated on agent-browser binary
│   └── scheduling/        # catalog — agent loads via load_skill when user requests scheduling
└── scratch.ts             # Terminal REPL for dev testing
```

---

## Multi-Agent System

Four pre-defined agents: **Atlas** (default, general assistant), **Einstein** (physics), **Wizard** (wise old wizard), **Coach** (personal trainer). Each has its own soul file, session history, and optionally its own Telegram bot.

**How agents work:**
- Agent ID is the config key (`atlas`, `einstein`, `wizard`, `personal_trainer`)
- Soul file loaded from `~/.openwren/agents/{agentId}/soul.md` on every API call (never cached)
- User sessions are user-scoped: `sessions/{userId}/main.jsonl` (shared across all channels and agents)
- All agents share the same `memory/` directory — agents prefix their memory keys by convention (`atlas-user-prefs`, `einstein-physics`)
- All agents share the same tool registry

**Routing:** Each agent has its own bot per channel, hardwired via bindings in `openwren.json`. Message a bot directly — it always responds as its bound agent. No prefix routing.

**Adding a new agent requires zero code changes.** Only: create `~/.openwren/agents/{id}/soul.md` and add the agent to `openwren.json`.

---

## User System

Users are defined in config with channel-agnostic IDs. Authorization works by scanning all users for a matching channel ID:

```json5
{
  "users.owner.displayName": "Niko",
  "users.owner.channelIds.telegram": "${env:OWNER_TELEGRAM_ID}",
}
```

`resolveUserId("telegram", senderId)` → returns userId or null (unauthorized). Applied at the channel layer before anything reaches the agent loop.

---

## Session Management

- **Storage:** JSONL files (append-only, crash-safe). Every message has a UTC millisecond timestamp.
- **Main session:** `sessions/{userId}/main.jsonl` — shared across all channels (Telegram, Discord, WebSocket). One per user.
- **WebUI sessions:** `sessions/{userId}/{uuid}.jsonl` — additional sessions created from WebUI. Each locked to one agent. Tracked in `sessions/{userId}/sessions.json`.
- **System sessions:** Task sessions (`agents/{agentId}/sessions/tasks/`) and job sessions (`agents/{agentId}/sessions/jobs/`) stay agent-scoped — not user conversations.
- **Locking:** Per-session mutex prevents race conditions from simultaneous messages.
- **Compaction:** When token estimate exceeds 80% of context window, all messages are summarized into a single message. The original session is archived to `sessions/{userId}/archives/` before overwriting.
- **Timestamps:** Stored as UTC ms in JSONL. Converted to `[Feb 28, HH:MM]` local time before feeding to the LLM via `injectTimestamps()`.
- **Idle reset:** Optional — `session.idleResetMinutes` in config. 0 = disabled.
- **Daily reset:** Optional — `session.dailyResetTime` (e.g. `"04:00"`) in configured timezone.
- **Manual reset:** `/new` or `/reset` from any channel — archives current `main.jsonl`, starts fresh.
- **REST API:** `GET/POST/PATCH/DELETE /api/sessions` for WebUI session management.

---

## CLI

Standalone process manager and interactive client. Entry point: `src/cli.ts` (compiled: `dist/cli.js`). Dev: `npm run cli -- <command>`. After global install: `openwren <command>`.

| Command | What it does |
|---|---|
| `init` | Create workspace (`~/.openwren/`) with template config, `.env`, and default Atlas soul file. Skips if already initialized (`--force` to overwrite) |
| `start` | Spawn bot as detached daemon, write PID to `~/.openwren/openwren.pid`, redirect logs to `~/.openwren/openwren.log` |
| `stop` | Read PID file, send SIGTERM, wait up to 5s, force-kill if needed |
| `restart` | Stop + start |
| `status` | Connect to WS gateway, print agents/channels/uptime. Falls back to PID-only if WS not configured |
| `logs` | Tail `~/.openwren/openwren.log` with `tail -f -n 50` |
| `chat [agent]` | Interactive terminal REPL via WS. Supports tool confirmation (yes/no/always) |

Three run modes:
- **`npm install -g openwren`** → `openwren init` → `openwren start` — global install from npm, for end users
- **`npm run dev`** — foreground, logs to terminal, Ctrl+C to stop (for development)
- **`npm run cli -- start`** — background daemon, logs to file, managed via CLI commands (for development)

---

## Implementation Details

- **Provider chain** — `createProviderChain(agentId)` resolves the model chain (primary + fallbacks) and returns a `ProviderChain` that implements `LLMProvider`. The agent loop doesn't know it's talking to a chain. Inheritance: agent without `model` inherits `defaultModel` + `defaultFallback`. Agent with `model` but no `fallback` inherits `defaultFallback` as safety net. Agent with both `model` and `fallback` uses its own chain exclusively
- **Config system** — all defaults in `defaultConfig` in `config.ts`. User overrides via `~/.openwren/openwren.json` (JSON5, dot-notation). Secrets via `${env:VAR}` referencing `~/.openwren/.env`
- **Confirmation flow** — stateful, lives in the channel layer (`telegram.ts`). `pendingConfirmations: Map<chatId, PendingCommand>`. The agent loop is not aware of this
- **Soul files** — load from `~/.openwren/agents/{agent-id}/soul.md` on every API call. Never cache — user edits take effect immediately
- **Skills system** — two-stage loading. Stage 1: `buildSkillCatalog()` scans bundled → extra dirs → global → per-agent skill directories, parses SKILL.md frontmatter, runs gate checks (`requires.env`, `requires.bins`, `requires.config`, `requires.os`, `requires.role`, `requires.tools`, `requires.delegated`). Stage 2: agent calls `load_skill` tool to get the full body on demand. Skills with `autoload: true` inject directly into the system prompt. Precedence: per-agent > global > extra dirs > bundled
- **Channel decoupling** — agents have zero channel fields. Bindings (`config.bindings`) map channels to agents with credentials. Channel-first layout: `bindings.telegram.atlas` for O(1) lookup
- **Channel interface** — each channel implements `Channel` from `channels/types.ts`. Adding a new channel = create adapter file + one import in the barrel
- **Event bus** — `src/events.ts` exports a typed `EventEmitter` singleton (`bus`). Channels emit events as side effects. The bus is purely observational — it does not mediate between channels and the agent loop. WS clients subscribe to receive all events
- **WebSocket channel** — `src/channels/websocket.ts`. Auth via `?token=` query param (constant-time comparison). WS is only enabled when `gateway.wsToken` is set in config
- **JSONL sessions** — append on each message, rewrite only on compaction. Compaction archives the old file before overwriting. Token estimate: content-only character count ÷ 4. Trigger at 80% of context window
- **Memory key namespacing** — agents prefix keys with their name (`atlas-user-prefs`, `einstein-physics`). Convention in soul files, not enforced in code
- **CLI** — `src/cli.ts` is completely standalone. It imports zero modules from the main app. It reads `~/.openwren/.env` directly (line-by-line parse) for the WS token
- **Timestamped logging** — `console.log` and `console.error` are overridden once in `index.ts` to prepend `[YYYY-MM-DD HH:MM:SS]`
- **Graceful shutdown** — `index.ts` registers SIGTERM/SIGINT handlers that call `stopChannels()`, close Fastify, and clean up the PID file
- **npm packaging** — published as `openwren` on npmjs.com. `files` field ships only `dist/` and `README.md`. Build script copies `src/templates/`, `src/skills/`, and `drizzle/` into `dist/`
- **Search provider abstraction** — `src/search/` follows the same pattern as LLM providers. `SearchProvider` interface with `search(query, options)` method. Adding a new search backend = one new file + config key. Currently ships with Brave Search
- **Fetch tool** — `src/tools/fetch.ts` uses `@mozilla/readability` + `linkedom` to extract article content. Output truncated to ~40K chars. Accept header prefers `text/markdown` for fast path. All fetched content runs through injection detection
- **Prompt injection detection** — `src/tools/sanitize.ts`. Hard patterns block known jailbreak phrases. Soft patterns log suspicious content without blocking. `wrapUntrusted()` wraps web content in `[BEGIN/END UNTRUSTED WEB CONTENT]` delimiters
- **Scheduler** — `src/scheduler/` handles cron jobs and heartbeat. Three schedule types: `cron`, `every` (m/h/d), `at` (one-shot). All times in `config.timezone`. Error handling: transient errors get exponential backoff retry, permanent errors auto-disable the job
- **Job isolation** — `isolated: true` routes to `sessions/{userId}/jobs/{jobId}.jsonl`. `isolated: false` uses the main session. Isolated sessions skip idle/daily resets and compaction
- **Heartbeat** — `src/scheduler/heartbeat.ts`. Periodic check-in, agents respond with message or `HEARTBEAT_OK` (suppressed). Active hours gating via config. File read fresh each cycle
- **Channel `sendMessage()`** — optional method on `Channel` interface for proactive delivery. `channels/index.ts` exports `deliverMessage()` convenience function
- **Schedule REST API** — `src/gateway/routes/schedules.ts`. Auth via Bearer token. Endpoints: GET/POST/PATCH/DELETE `/api/schedules` + per-job actions
- **`manage_schedule` tool** — minimal description, tells agent to `load_skill("scheduling")` for full instructions. Saves tokens on every API call
- **Orchestrator** — see `src/orchestrator/ARCHITECTURE.md` for full design docs and event flow diagrams
- **Orchestrator database** — SQLite via `better-sqlite3` + Drizzle ORM. WAL mode, foreign keys enforced. Migrations automatic via `getDb()` → `migrate()`. Dev workflow: edit schema → `npx drizzle-kit drop` → `npx drizzle-kit generate` → delete local DB → restart
- **Teams config** — `config.teams` defines agent teams. `canDelegateTo(from, to)` validates delegation permissions. Team folder: `~/.openwren/teams/{teamName}/`. Adding a new team = just config

---

## Security

- Never run as root
- Bind gateway to `127.0.0.1`, not `0.0.0.0`
- WebSocket auth via bearer token (`gateway.wsToken`), validated with constant-time comparison. WS disabled if token not set
- User authorization via `resolveUserId()` — reject unrecognized senders at the channel layer before touching the agent loop
- All secrets in `~/.openwren/.env`, referenced via `${env:VAR}` — config file is safe to share
- Sandbox all file operations to the workspace directory
- Treat all inbound content (web pages, search results) as potentially adversarial
- Prompt injection defense: three layers — (1) regex hard-block for known jailbreak phrases, (2) `[BEGIN/END UNTRUSTED WEB CONTENT]` delimiters prime the LLM to distrust embedded instructions, (3) the LLM's own training to recognize injection attempts. Soft patterns log suspicious content without blocking
- For WhatsApp (Phase 11): only ever install `@whiskeysockets/baileys` — never forks or similarly named packages
