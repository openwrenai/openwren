# Open Wren — Personal AI Agent Bot

## Rules for Claude

- **Never run git commands unless explicitly asked to commit or push.** Editing files is fine; touching git is not unless the user says so.
- **Always briefly summarize what you're about to do before prompting the user for permission.** One or two sentences max — what files, what change, why.
- **Never add `Co-Authored-By` or contributor lines to commit messages.**

## Overview

A self-hosted personal AI assistant bot controlled via messaging channels (Telegram, with Discord/WhatsApp planned). Runs as a local Node.js gateway, connects to an LLM backend (Anthropic Claude or Ollama), and can execute tasks on your behalf — reading/writing files, running whitelisted shell commands, persistent memory across sessions.

Multiple agents with distinct personalities (Atlas, Einstein, Wizard, Coach). Agents are decoupled from channels — bindings connect agents to channels with credentials.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js (v22+), TypeScript |
| Messaging | grammY (`grammy`) — modern Telegram Bot API wrapper |
| HTTP | Fastify — lightweight internal API/webhook server |
| LLM: Cloud | Anthropic SDK (`@anthropic-ai/sdk`) — per-agent model selection with cascading fallbacks |
| LLM: Local | Ollama REST API (Phase 4) |
| Config | JSON5 (`json5`) — `~/.openwren/openwren.json` with dot-notation keys |
| Env | `dotenv` — secrets in `~/.openwren/.env` |

Core dependencies: `@anthropic-ai/sdk`, `grammy`, `fastify`, `dotenv`, `json5`.

---

## Architecture

```
You (Telegram / Discord / ...)
        │
   ┌────▼────────────────┐
   │  Channel Layer       │  ← Channel interface, adapters (Telegram, etc.), auth, routing
   │  (channels/)         │
   └────────┬─────────────┘
            │
     ┌──────▼──────┐
     │  Agent Loop  │  ← conversation history, tool orchestration, ReAct pattern
     │  (loop.ts)   │
     └──────┬───────┘
            │
    ┌───────▼────────┐
    │  LLM Provider  │  ← Anthropic API  OR  Ollama (switchable)
    └───────┬────────┘
            │  tool_use response
    ┌───────▼────────┐
    │  Tool Executor │
    └───────┬────────┘
            │
   ┌────────┼─────────┐
   ▼        ▼         ▼
shell    read/write  memory
(whitelist) (sandboxed) (persistent)
```

---

## Configuration

All defaults live in code (`defaultConfig` in `config.ts`). User overrides go in `~/.openwren/openwren.json` — a JSON5 file with flat dot-notation keys. Secrets reference env vars via `${env:VAR}` syntax, resolved from `~/.openwren/.env`.

Nothing reads `process.env` directly (except `PORT` for the gateway). Everything flows: `openwren.json` → `${env:VAR}` → `.env`.

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
- `agents.*` — pure personality (name, triggerPrefix) + optional model override. Zero channel awareness.
- `channels.*` — shared transport settings (rate limit, auth behavior).
- `bindings.*` — the glue. Channel-first layout: `bindings.telegram.atlas` = the Telegram bot token Atlas uses.

On first run, `~/.openwren/` is created with template `openwren.json` and `.env` files.

---

## Workspace Directory

```
~/.openwren/
├── openwren.json                         # User config (safe to share publicly)
├── .env                                  # Secrets (API keys, bot tokens)
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
│   │   └── soul.md                       # Atlas personality and instructions
│   ├── einstein/
│   │   └── soul.md
│   ├── wizard/
│   │   └── soul.md
│   └── personal_trainer/
│       └── soul.md
└── exec-approvals.json                   # Shell commands approved once per agent
```

The workspace path (`~/.openwren`) is hardcoded in code. Not user-configurable.

**Sessions** are ephemeral — they compact and archive over time. **Memory files** are permanent — they survive session resets, restarts, and compaction.

---

## Project Structure

```
src/
├── index.ts               # Entry point — starts gateway + startChannels()
├── config.ts              # Config loader: defaults, JSON5 parse, deepSet, resolveEnvRefs
├── workspace.ts           # Ensures ~/.openwren/ directory structure exists
├── gateway/
│   └── server.ts          # Fastify server, health check, future webhook support
├── channels/
│   ├── index.ts           # Barrel: startChannels() — creates and starts all configured channels
│   ├── types.ts           # Channel interface (name, isConfigured, start, stop)
│   └── telegram.ts        # Telegram adapter: TelegramChannel implements Channel
├── agent/
│   ├── loop.ts            # Core ReAct loop (think → tool → think → respond)
│   ├── history.ts         # JSONL session persistence, compaction, archival, timestamps, locking
│   ├── router.ts          # Parses message prefix, resolves which agent handles it
│   └── prompt.ts          # Loads soul.md for the resolved agent into system prompt
├── providers/
│   ├── index.ts           # Provider interface, ProviderChain (cascading fallbacks), model chain resolution
│   └── anthropic.ts       # Anthropic Claude implementation
├── tools/
│   ├── index.ts           # Tool registry, definitions, executor
│   ├── shell.ts           # Whitelisted shell command runner
│   ├── filesystem.ts      # Sandboxed file read/write
│   └── memory.ts          # save_memory and memory_search tools
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

**Routing:** Two ways to reach an agent:
1. **Prefix routing** on the default agent's bot: `/einstein explain gravity` strips the prefix and routes to Einstein. Plain messages go to the default agent (`config.defaultAgent`).
2. **Dedicated bot** per agent: each agent can have its own bot token via bindings in `openwren.json`. Message it directly — no prefix needed.

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
- **Timestamps:** Stored as UTC ms in JSONL. Converted to `[HH:MM]` local time before feeding to the LLM via `injectTimestamps()`.
- **Idle reset:** Optional — `session.idleResetMinutes` in config. 0 = disabled.
- **Daily reset:** Optional — `session.dailyResetTime` (e.g. `"04:00"`) in configured timezone.

---

## Notes for Claude Code

- Prefer **explicit over clever** — this codebase should be readable at a glance
- Keep the agent loop in one file (`loop.ts`) so the control flow is obvious
- Tool definitions and their executor functions live together in their respective files
- **Provider chain** — `createProviderChain(agentId)` resolves the model chain (primary + fallbacks) and returns a `ProviderChain` that implements `LLMProvider`. The agent loop doesn't know it's talking to a chain. Inheritance: agent without `model` inherits `defaultModel` + `defaultFallback`. Agent with `model` but no `fallback` uses only that model. Agent with both uses its own chain
- The provider abstraction is the most important seam — keep it clean
- **Config system** — all defaults in `defaultConfig` in `config.ts`. User overrides via `~/.openwren/openwren.json` (JSON5, dot-notation). Secrets via `${env:VAR}` referencing `~/.openwren/.env`. Nothing reads `process.env` directly
- **Confirmation flow** — stateful, lives in the channel layer (`telegram.ts`). `pendingConfirmations: Map<chatId, PendingCommand>`. The agent loop is not aware of this
- **Multi-agent routing** — the router (`agent/router.ts`) is the only place that knows about prefix matching. It returns a resolved agent to the channel layer. The agent loop never knows how routing happened
- **Agent name in replies** — prepend `[AgentName]` to every reply in `telegram.ts`, not in the loop. The loop is channel-agnostic
- **Soul files** — load from `~/.openwren/agents/{agent-id}/soul.md` on every API call. Never cache — user edits take effect immediately
- **Adding a new agent** — zero code changes. Create `~/.openwren/agents/{id}/soul.md`, add dot-notation keys in `openwren.json`. If adding an agent ever requires TypeScript changes, the abstraction is wrong
- **Channel decoupling** — agents have zero channel fields. Bindings (`config.bindings`) map channels to agents with credentials. Channel-first layout: `bindings.telegram.atlas` for O(1) lookup when a message arrives. Three concepts: agents (personality), channels (transport settings), bindings (glue)
- **Channel interface** — each channel implements `Channel` from `channels/types.ts`. Barrel file `channels/index.ts` exports `startChannels()`. `index.ts` has no platform-specific knowledge. Adding a new channel = create adapter file + one import in the barrel
- **Bot startup** — `TelegramChannel.start()` creates all bots from `config.bindings.telegram`. The default agent's bot uses the router (prefix routing), others are hardwired. grammY `bot.start()` never resolves — don't await it
- **JSONL sessions** — append on each message, rewrite only on compaction. Compaction archives the old file before overwriting
- **Compaction token estimate** — content-only character count ÷ 4. No tokenizer API calls. Trigger at 80% of context window
- **Memory key namespacing** — agents prefix keys with their name (`atlas-user-prefs`, `einstein-physics`). Convention in soul files, not enforced in code
- Core dependencies: `@anthropic-ai/sdk`, `grammy`, `fastify`, `dotenv`, `json5`
- For Ollama (Phase 4): test with `qwen3:8b` or `llama3.2` first — best function calling support among open-source models

---

## Security

- Never run as root
- Bind gateway to `127.0.0.1`, not `0.0.0.0`
- User authorization via `resolveUserId()` — reject unrecognized senders at the channel layer before touching the agent loop
- All secrets in `~/.openwren/.env`, referenced via `${env:VAR}` — config file is safe to share
- Sandbox all file operations to the workspace directory
- Treat all inbound content (web pages, search results) as potentially adversarial
- For WhatsApp (Phase 6): only ever install `@whiskeysockets/baileys` — never forks or similarly named packages
