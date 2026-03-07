# Open Wren — Personal AI Agent Bot

## Rules for Claude

- **Never run git commands unless explicitly asked to commit or push.** Editing files is fine; touching git is not unless the user says so.
- **Always briefly summarize what you're about to do before prompting the user for permission.** One or two sentences max — what files, what change, why.
- **Never add `Co-Authored-By` or contributor lines to commit messages.**
- **Commit message format:** Subject line is `Phase X.Y: short title` (no conventional commits prefix like `feat:` or `fix:`). Body bullet-points what changed and why.

## Overview

A self-hosted personal AI assistant bot controlled via messaging channels (Telegram, Discord, with WhatsApp planned). Runs as a local Node.js gateway with WebSocket support, connects to an LLM backend (Anthropic Claude or Ollama), and can execute tasks on your behalf — reading/writing files, running whitelisted shell commands, persistent memory across sessions.

Multiple agents with distinct personalities (Atlas, Einstein, Wizard, Coach). Agents are decoupled from channels — bindings connect agents to channels with credentials.

---

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

Core dependencies: `@anthropic-ai/sdk`, `grammy`, `discord.js`, `fastify`, `@fastify/websocket`, `dotenv`, `json5`.

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
├── sessions/
│   ├── {userId}/                         # One per user in config
│   │   ├── atlas/
│   │   │   ├── active.jsonl              # Current session
│   │   │   └── 2026-02-22_18-05-43.jsonl # Archived compaction (UTC)
│   │   ├── einstein/
│   │   └── wizard/
│   └── local/                            # Scratch/dev sessions
├── memory/
│   ├── atlas-user-prefs.md               # Persistent memory (agents prefix keys by convention)
│   └── atlas-projects.md
├── agents/
│   ├── atlas/
│   │   ├── soul.md                       # Atlas personality and instructions
│   │   └── skills/                       # Per-agent skills (highest precedence)
│   ├── einstein/
│   │   └── soul.md
│   ├── wizard/
│   │   └── soul.md
│   └── personal_trainer/
│       └── soul.md
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
│   └── server.ts          # Fastify server + @fastify/websocket plugin, health check, exports app instance
├── channels/
│   ├── index.ts           # Barrel: startChannels() + stopChannels() for graceful shutdown
│   ├── types.ts           # Channel interface (name, isConfigured, start, stop)
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
│   └── fetch.ts           # fetch_url tool (readability + linkedom, markdown fast-path, injection scan)
├── skills/                # Bundled skills shipped with the package
│   ├── memory-management/ # autoload — teaches agents memory tools
│   ├── file-operations/   # autoload — teaches agents file sandbox rules
│   ├── web-search/        # gated on search.provider config key
│   ├── web-fetch/         # no gate
│   └── agent-browser/     # gated on agent-browser binary
└── scratch.ts             # Terminal REPL for dev testing
```

---

## Multi-Agent System

Four pre-defined agents: **Atlas** (default, general assistant), **Einstein** (physics), **Wizard** (wise old wizard), **Coach** (personal trainer). Each has its own soul file, session history, and optionally its own Telegram bot.

**How agents work:**
- Agent ID is the config key (`atlas`, `einstein`, `wizard`, `personal_trainer`)
- Soul file loaded from `~/.openwren/agents/{agentId}/soul.md` on every API call (never cached)
- Sessions isolated per user + agent: `sessions/{userId}/{agentId}/active.jsonl`
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
- **Path:** `sessions/{userId}/{agentId}/active.jsonl`
- **Locking:** Per-session mutex prevents race conditions from simultaneous messages.
- **Compaction:** When token estimate exceeds 80% of context window, all messages are summarized into a single message. The original `active.jsonl` is archived as `yyyy-mm-dd_hh-mm-ss.jsonl` (UTC) before overwriting.
- **Timestamps:** Stored as UTC ms in JSONL. Converted to `[Feb 28, HH:MM]` local time before feeding to the LLM via `injectTimestamps()`.
- **Idle reset:** Optional — `session.idleResetMinutes` in config. 0 = disabled.
- **Daily reset:** Optional — `session.dailyResetTime` (e.g. `"04:00"`) in configured timezone.

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

## Notes for Claude Code

- Prefer **explicit over clever** — this codebase should be readable at a glance
- Keep the agent loop in one file (`loop.ts`) so the control flow is obvious
- Tool definitions and their executor functions live together in their respective files
- **Provider chain** — `createProviderChain(agentId)` resolves the model chain (primary + fallbacks) and returns a `ProviderChain` that implements `LLMProvider`. The agent loop doesn't know it's talking to a chain. Inheritance: agent without `model` inherits `defaultModel` + `defaultFallback`. Agent with `model` but no `fallback` inherits `defaultFallback` as safety net. Agent with both `model` and `fallback` uses its own chain exclusively
- The provider abstraction is the most important seam — keep it clean
- **Config system** — all defaults in `defaultConfig` in `config.ts`. User overrides via `~/.openwren/openwren.json` (JSON5, dot-notation). Secrets via `${env:VAR}` referencing `~/.openwren/.env`. Nothing reads `process.env` directly
- **Confirmation flow** — stateful, lives in the channel layer (`telegram.ts`). `pendingConfirmations: Map<chatId, PendingCommand>`. The agent loop is not aware of this
- **Agent name in replies** — prepend `[AgentName]` to every reply in `telegram.ts`, not in the loop. The loop is channel-agnostic
- **Soul files** — load from `~/.openwren/agents/{agent-id}/soul.md` on every API call. Never cache — user edits take effect immediately
- **Skills system** — two-stage loading. Stage 1: `buildSkillCatalog()` scans bundled → extra dirs → global → per-agent skill directories, parses SKILL.md frontmatter (hand-rolled, no YAML dep), runs gate checks (`requires.env`, `requires.bins`, `requires.config`, `requires.os`), returns catalog entries (name + description) and autoloaded skill bodies. Stage 2: agent calls `load_skill` tool to get the full body on demand. Skills with `autoload: true` skip the catalog and inject directly into the system prompt. Precedence: per-agent > global > extra dirs > bundled. Bundled skills live in `src/skills/`, copied to `dist/skills/` by the build script. Adding a new skill requires zero code changes — just create `~/.openwren/skills/{name}/SKILL.md`
- **Adding a new agent** — zero code changes. Create `~/.openwren/agents/{id}/soul.md`, add dot-notation keys in `openwren.json`. If adding an agent ever requires TypeScript changes, the abstraction is wrong
- **Channel decoupling** — agents have zero channel fields. Bindings (`config.bindings`) map channels to agents with credentials. Channel-first layout: `bindings.telegram.atlas` for O(1) lookup when a message arrives. Three concepts: agents (personality), channels (transport settings), bindings (glue)
- **Channel interface** — each channel implements `Channel` from `channels/types.ts`. Barrel file `channels/index.ts` exports `startChannels()`. `index.ts` has no platform-specific knowledge. Adding a new channel = create adapter file + one import in the barrel
- **Event bus** — `src/events.ts` exports a typed `EventEmitter` singleton (`bus`). Channels emit events (`message_in`, `message_out`, `agent_typing`, `session_compacted`, `agent_error`) as side effects alongside their normal operation. The bus is purely observational — it does not mediate between channels and the agent loop. WS clients subscribe to the bus to receive all events. The agent loop is completely unaware of the event system
- **WebSocket channel** — `src/channels/websocket.ts` implements `Channel`. Registers `/ws` route on the shared Fastify instance. Auth via `?token=` query param (constant-time comparison). All WS clients map to first user in config (Phase 4 simplification). Supports: sending messages to agents, receiving bus events, tool confirmation flow via nonces. WS is only enabled when `gateway.wsToken` is set in config
- **Bot startup** — `TelegramChannel.start()` creates all bots from `config.bindings.telegram`. Each bot is hardwired to its agent. grammY `bot.start()` never resolves — don't await it
- **JSONL sessions** — append on each message, rewrite only on compaction. Compaction archives the old file before overwriting
- **Compaction token estimate** — content-only character count ÷ 4. No tokenizer API calls. Trigger at 80% of context window
- **Memory key namespacing** — agents prefix keys with their name (`atlas-user-prefs`, `einstein-physics`). Convention in soul files, not enforced in code
- **CLI** — `src/cli.ts` is completely standalone. It imports zero modules from the main app (no config, no events, nothing). This is deliberate — it must start fast and work even if config validation fails. It reads `~/.openwren/.env` directly (line-by-line parse) for the WS token. Dev usage: `npm run cli -- <command>`
- **Timestamped logging** — `console.log` and `console.error` are overridden once in `index.ts` to prepend `[YYYY-MM-DD HH:MM:SS]`. Every module gets timestamps for free — no per-file changes needed
- **Graceful shutdown** — `index.ts` registers SIGTERM/SIGINT handlers that call `stopChannels()`, close Fastify, and clean up the PID file. Triggered by `openwren stop` or Ctrl+C in foreground mode
- **npm packaging** — published as `openwren` on npmjs.com. Versioning: CalVer `YYYY.M.D` (date-based). Same-day hotfixes use a suffix: `YYYY.M.D-1`, `YYYY.M.D-2`, etc. `files` field in `package.json` ships only `dist/` and `README.md`. Build script: `tsup && cp -r src/templates dist/templates && cp -r src/skills dist/skills` (bundler doesn't copy non-TS assets). Users install globally (`npm install -g openwren`), run `openwren init`, never touch source
- **Search provider abstraction** — `src/search/` follows the same pattern as LLM providers. `SearchProvider` interface with `search(query, options)` method. `createSearchProvider()` factory reads `config.search.provider` and returns the correct implementation. Config layout: `search.provider` selects the backend, `search.{provider}.*` holds provider-specific settings. Adding a new search backend = one new file + config key, zero changes to tools or skills. Currently ships with Brave Search; future: Zenserp, Google Custom Search, SearXNG
- **Fetch tool** — `src/tools/fetch.ts` uses `@mozilla/readability` + `linkedom` to extract article content from HTML. Readability strips navigation, ads, sidebars. Linkedom provides a lightweight DOM for readability to parse against. Output truncated to ~40K chars to prevent context window overflow. Accept header prefers `text/markdown` — if a server returns markdown, readability is skipped entirely (fast path). All fetched content runs through `scanContent()` which applies both hard and soft injection detection
- **Prompt injection detection** — `src/tools/sanitize.ts` exports three functions. `detectInjection()` runs 8 hard patterns (ignore previous instructions, you are now a, etc.) — matched content is blocked and never reaches the LLM. `detectSuspicious()` runs 4 soft patterns (list tools/skills, reveal system prompt, respond in JSON, etc.) — matched content is logged but NOT blocked, relying on untrusted delimiters and the LLM's own judgment. `wrapUntrusted()` wraps all web content in `[BEGIN/END UNTRUSTED WEB CONTENT]` delimiters so the LLM can distinguish trusted instructions from external content. `fetch.ts` uses a `scanContent()` helper that runs both checks in sequence
- **`list_shell_commands` tool** — returns the full whitelist of allowed shell commands with notes on restrictions (git subcommands, curl GET-only, destructive commands). The `shell_exec` tool description no longer lists commands inline — saves tokens on every API call. The agent calls `list_shell_commands` on demand when it needs to check what's allowed
- **`requires.config` gate** — skill frontmatter supports `requires.config: [key.path]` to gate on config values. Traverses the config object using dot-notation and checks the value is set and truthy. Used by `web-search` skill to gate on `search.provider`
- **`OPENWREN_HOME`** — env var to override workspace path. Used in both `config.ts` (main app) and `cli.ts` (standalone CLI). Defaults to `~/.openwren`. Useful for testing: `OPENWREN_HOME=~/.openwren-test openwren init`

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
