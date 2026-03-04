## Completed Phases
### Phase 1 — Project Setup + Core Agent (no messaging yet)
The goal of Phase 1 is a working agent you can test entirely in the terminal before wiring up any messaging channel.

### Phase 2 — Telegram Channel
Wire the working agent into Telegram. At this point the brain already works, so this phase is purely plumbing.

### Phase 3 — Multi-Agent Routing
Add support for multiple agents with different personalities, each with their own soul file and isolated conversation history. All agents share the same tool registry and memory directory.

### Phase 3.1 — Session Refactor + User System + Timestamps
Restructure sessions into a user→agent folder hierarchy, add UTC timestamps to every message, archive sessions on compaction instead of overwriting, introduce a channel-agnostic user system in config.json, and globalize channel settings.

### Phase 3.2 — Externalize User Config (JSON5 + Dot-Notation)
Move user configuration out of the project repository to `~/.openwren/openwren.json` so git pulls never overwrite custom settings. The file uses `.json` extension (for editor syntax highlighting) but is parsed as **JSON5** (comments, trailing commas). Users write **flat dot-notation keys** instead of managing deeply nested objects — a `deepSet()` helper injects each key into the full default config at the correct path. This phase also migrates the workspace directory from `~/.bot-workspace` to `~/.openwren`.

### Phase 3.5 — Rebrand to Open Wren
Cosmetic rebrand from OrionBot to **Open Wren**. The workspace directory (`~/.openwren/`) and all `bot-workspace` references in source code were already migrated in Phase 3.2. This phase handles the remaining project-level naming **and a full overhaul of CLAUDE.md** which is heavily outdated.

### Phase 3.6 — Channel Decoupling (Bindings Pattern)
Decouple agents from channels using a bindings pattern. Agents become pure personality (zero channel fields), channels are pure transport, and bindings are the glue mapping agents to channels with credentials. `index.ts` calls a single `startChannels()` — no platform-specific knowledge.

**Note:** if we ever add a build step (e.g. `tsc` to `dist/`), template files in `src/templates/` won't be copied automatically — we'd need a copy step or bundler config to include them

### Phase 3.7 — Per-Agent Provider/Model with Cascading Fallbacks

Add per-agent model selection and cascading fallback chains. Unified `"provider/model"` format (e.g. `"anthropic/claude-sonnet-4-6"`). Agents without a model inherit the global default. If the primary fails, fallbacks are tried in order.

### Phase 3.7.1 — Timestamp Date Fix

Add dates to injected timestamps so agents can tell when days have passed between messages. `[HH:MM]` → `[Feb 28, HH:MM]`.

### Phase 3.8 — Discord Channel
**Manual setup required before running:** Enable "Message Content Intent" in Discord Developer Portal → App → Bot → Privileged Gateway Intents.
Add Discord as a second messaging channel. Each bot hardwired to one agent — no prefix routing. DMs only.

### Phase 3.8.1 — Remove Prefix Routing

Removed the router abstraction entirely. Every bot (Telegram, Discord) is hardwired to exactly one agent via its binding — no prefix switching. `triggerPrefix` removed from `AgentConfig`.


### Phase 4 — WebSocket Gateway

Added WebSocket support to the existing Fastify server. Internal event bus for cross-channel observability. WS clients can send messages to agents and receive all bus events. Foundation for CLI (Phase 5) and Web UI (Phase 10).

- [x] `npm install @fastify/websocket` — WebSocket plugin for Fastify
- [x] `src/events.ts` — typed event bus (`EventEmitter` singleton). Event protocol: `message_in`, `message_out`, `agent_typing`, `session_compacted`, `agent_error`, `status`, `confirm_request`
- [x] `src/gateway/server.ts` — registered `@fastify/websocket` plugin, exported Fastify instance for WS channel to attach routes
- [x] `src/channels/websocket.ts` — `WebSocketChannel` implements `Channel`. Token auth via `?token=` query param, rate limiting, confirmation flow via nonces, broadcasts bus events to all connected clients
- [x] `src/channels/index.ts` — wired `createWebSocketChannel()` into channel array
- [x] `src/channels/telegram.ts` + `discord.ts` — added bus event emissions (message_in, agent_typing, message_out, session_compacted, agent_error) as side effects
- [x] `src/config.ts` — added `gateway.wsToken` to Config interface and defaults
- [x] Templates — added `gateway.wsToken` to openwren.json template, `WS_TOKEN` to env.template
- [x] `CLAUDE.md` — updated architecture diagram, project structure, tech stack, added event bus and WS channel docs
- [x] Compile clean

### Phase 5 — CLI Commands

Standalone CLI for process management and interactive chat. No imports from the main app — starts fast, works even if config is broken. Dev usage: `npm run cli -- <command>`. After Phase 6 (packaging): `openwren <command>`.

- [x] `src/cli.ts` — CLI entry point with command routing, wired into `package.json` `bin` field (`dist/cli.js`) and `cli` dev script
- [x] `openwren start` — spawns bot as detached background daemon, writes PID to `~/.openwren/openwren.pid`, redirects stdout/stderr to `~/.openwren/openwren.log`
- [x] `openwren stop` — reads PID file, sends SIGTERM, waits up to 5s, force-kills if needed, cleans PID file
- [x] `openwren restart` — stop + start with port release pause
- [x] `openwren status` — connects to WS gateway, prints agents, channels, uptime. Falls back to PID-only status if WS not configured
- [x] `openwren logs` — tails `~/.openwren/openwren.log` with `tail -f -n 50`
- [x] `openwren chat [agent]` — interactive terminal REPL via WS with confirmation flow (yes/no/always), error handling, compaction notices
- [x] `src/index.ts` — SIGTERM/SIGINT graceful shutdown handler (stops channels, closes Fastify, cleans PID file)
- [x] `src/channels/index.ts` — added `stopChannels()` for graceful shutdown
- [x] Timestamped logging — `[YYYY-MM-DD HH:MM:SS]` prepended to all console.log/error output via override in `index.ts`
- [x] Compile clean, all commands tested

## Left to do Phases

### Phase 6 — Installer / npm Packaging

Package Open Wren for global install via `npm install -g openwren`. Versioning: CalVer `YYYY.M.D` (date-based).

Claude go step by step here and after each task ask user to check everything looks good so far. do not do all items at once, very important!

- [x] `OPENWREN_HOME` env var — override workspace path (defaults to `~/.openwren`). Updated `config.ts` + `cli.ts`
- [x] `package.json` metadata — description, repository, keywords, author, license, `files` field (ship only `dist/`, templates, README)
- [x] Build pipeline — update `npm run build` to copy `src/templates/` → `dist/templates/` after `tsc`
- [x] `openwren init` command — creates workspace dir, writes template `openwren.json`, `.env`, and default `agents/atlas/soul.md`. Prints next steps. Skips if already initialized (--force to overwrite)
- [x] `#!/usr/bin/env node` shebang — verify it survives `tsc` compilation in `dist/cli.js`
- [x] Test local install — `npm run build && npm install -g .` → `OPENWREN_HOME=~/.openwren-test openwren init` → verify bot works → clean up
- [x] Publish to npm — `npm login && npm publish`. Live at https://www.npmjs.com/package/openwren

### Phase 7 — Ollama Support

Add local LLM support via Ollama. Same `LLMProvider` interface — the agent loop doesn't know or care.

- [ ] `src/providers/ollama.ts` — implement `LLMProvider` against Ollama REST API (`http://localhost:11434/api/chat`)
- [ ] Provider factory in `src/providers/index.ts` — resolve `ollama/` prefix in model strings
- [ ] Test tool_use compatibility — not all Ollama models support native function calling
- [ ] Fallback: if model doesn't support native tool_use, implement XML-based tool parsing in system prompt instead
- [ ] Recommended models to test first: `qwen3:8b` and `llama3.2` — best function calling support among open-source models

### Phase 8 — Skills System

Add a skills loader that injects capability instructions into the system prompt at session start. See `Skills.md` for full architecture and SKILL.md format.

- [ ] `src/agent/skills.ts` — loader: scans bundled → global → per-agent dirs, parses frontmatter, gate checks (env, bins, os), returns eligible skill bodies
- [ ] `src/agent/prompt.ts` — append eligible skills after soul.md content
- [ ] `src/config.ts` — add `skills` config section (`entries.<name>.enabled`, `load.extraDirs`)
- [ ] `src/workspace.ts` — ensure `~/.openwren/skills/` directory exists at startup
- [ ] Bundled skill: `src/skills/memory-management/SKILL.md`
- [ ] Bundled skill: `src/skills/file-operations/SKILL.md`
- [ ] Update `CLAUDE.md` with skills architecture notes

### Phase 9 — Web Research (Search + Fetch + Browser)

Add research tools and their skills. Skills system (Phase 8) must be done first so each tool ships with proper agent instructions.

- [ ] `src/tools/search.ts` — Brave Search API wrapper (free API key at brave.com/search/api)
- [ ] `src/tools/fetch.ts` — fetch URL, strip HTML with `@mozilla/readability`, truncate to ~3000 tokens
- [ ] Wire both into the tool registry
- [ ] Bundled skill: `src/skills/brave-search/SKILL.md` (gated on `BRAVE_API_KEY`)
- [ ] Bundled skill: `src/skills/web-fetch/SKILL.md`
- [ ] `src/tools/shell.ts` — add `agent-browser` commands to whitelist
- [ ] Bundled skill: `src/skills/agent-browser/SKILL.md` (gated on `agent-browser` binary on PATH)

### Phase 10 — Web UI (Dashboard)

A local browser dashboard at `http://127.0.0.1:3000`. Connects to Phase 4 WebSocket gateway. Opened via `openwren dashboard`.

**Chat & Sessions**
- [ ] Chat interface — send messages, stream responses token-by-token, abort runs mid-stream
- [ ] Read-only fallback — if gateway goes unreachable mid-session, show history but disable input instead of crashing
- [ ] Agent selector — switch between Atlas, Einstein, Wizard, etc.
- [ ] Session list — browse all sessions per agent/user with last-active timestamps
- [ ] Session history viewer — read full conversation transcript for any session
- [ ] Session actions — reset session, force compaction, view archive list

**Agents**
- [ ] Agent list — all configured agents with name, model, status
- [ ] Soul file editor — view and edit `~/.openwren/agents/{id}/soul.md` directly in the UI
- [ ] Per-agent model override — change model/fallback without editing config file
- [ ] Agent creation — add a new agent (creates soul.md stub, adds to config)

**Memory**
- [ ] Memory file browser — list all files in `~/.openwren/memory/`
- [ ] Memory editor — view and edit individual memory files (markdown)
- [ ] Memory delete — remove stale memory keys

**Config**
- [ ] Config editor — view and edit `~/.openwren/openwren.json` via form or raw JSON5
- [ ] Config validation — show errors before saving, protect against concurrent edits
- [ ] Restart prompt — notify when a config change requires restart to take effect

**Channels & Status**
- [ ] Channel status panel — show which channels are connected (Telegram, Discord) and their bot usernames
- [ ] Per-channel connection health — last message received, error state if login failed

**Skills**
- [ ] Skills panel — list all loaded skills, which are active vs gated out, enable/disable toggle

**Usage & Monitoring**
- [ ] Usage dashboard — token counts and estimated cost per session/agent/day
- [ ] Live log tail — stream `~/.openwren/openwren.log` with text filter
- [ ] System health — uptime, active agents, memory file count, session count

**Execution Approvals**
- [ ] Approval panel — view pending shell command confirmations and approve/reject from browser
- [ ] Allowlist editor — view and edit `exec-approvals.json` (permanently approved commands per agent)

**Scheduled Tasks (Phase 12 prerequisite)**
- [ ] Cron job list — view all scheduled tasks, last run time, next run time
- [ ] Enable/disable/run-now controls per job

### Phase 11 — WhatsApp (Optional, Proceed with Caution)

WhatsApp support via `@whiskeysockets/baileys`. Unofficial, reverse-engineers WhatsApp Web protocol.

**Risks:** violates WhatsApp ToS (ban possible), can break on protocol updates, supply chain risk — only ever install `@whiskeysockets/baileys`, never forks. A malicious clone was caught stealing session tokens in late 2025.

- [ ] `src/channels/whatsapp.ts` — Baileys socket setup, QR code auth, message routing
- [ ] Persistent auth state (scan QR once, stays logged in)
- [ ] Reconnection logic (Baileys drops connection occasionally)
- [ ] Wire into `channels/index.ts` alongside Telegram and Discord

### Phase 12 — Polish + Deployment

- [ ] **Cron / scheduled tasks** — proactive messages (morning briefings, reminders). Use isolated session keys so scheduled task history doesn't pollute chat history
- [ ] **Pre-compaction memory flush** — before compacting, run a silent agent turn to save critical context to memory files
- [ ] **Semantic memory search** — upgrade from keyword matching to vector embeddings so "auth bug" matches "authentication issues"
- [ ] Logging and usage tracking (token counts, cost per message)
- [ ] Docker + `docker-compose` for VPS deployment
- [ ] **File access sandbox review** — consider configurable `allowedPaths` so agent can access directories outside workspace without full shell access
- [ ] **Shell command whitelist review** — make whitelist configurable via `openwren.json` so users can add/remove commands without touching code