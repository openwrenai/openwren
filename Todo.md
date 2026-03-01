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

- [x] `npm install discord.js` — add dependency
- [x] `src/channels/discord.ts` — `DiscordChannel implements Channel`. One `Client` per agent binding, DM-only filter, auth via `resolveUserId("discord", ...)`, rate limiting, confirmation flow (yes/no/always), typing indicator, agent name prepend, 2000-char message splitting, compaction notifications
- [x] `src/channels/index.ts` — import and add `createDiscordChannel()` to the `all` array
- [x] `src/templates/openwren.json` — add Discord binding and user ID examples
- [x] `src/gateway/server.ts` — fix misleading comment
- [x] `CLAUDE.md` — add `discord.js` to tech stack table, note Message Content Intent setup step
- [ ] Test: compile clean, DM bot → agent responds, unauthorized user silently rejected, rate limit works

Add Discord as a second messaging channel. Each bot hardwired to one agent — no prefix routing. DMs only.

## Left to do Phases

### Phase 3.8.1 — Remove Prefix Routing from Telegram

Each Telegram bot is already hardwired to its agent via bindings — the router is only called for the default agent's bot. Remove this: every bot is always hardwired to its fixed agent.

- [ ] `src/channels/telegram.ts` — remove router call, all bots use fixed agentId
- [ ] `src/agent/router.ts` — delete (dead code after this change)
- [ ] Test: compile clean, each bot responds as its own agent only

---

### Phase 4 — WebSocket Gateway

Upgrade `gateway/server.ts` from a stub health check into a real WebSocket server. Foundation for CLI commands, Web UI, and future native apps. Channels continue calling `runAgentLoop()` directly — WS is for external clients to observe and interact with the running bot.

- [ ] Add `@fastify/websocket` alongside the existing Fastify HTTP server
- [ ] Define typed event protocol: `message_in`, `message_out`, `agent_typing`, `session_compacted`, `agent_error`, `status`
- [ ] Internal event bus — channels emit events when messages arrive and when responses go out
- [ ] WS clients can subscribe to all events (for WebUI / CLI live view)
- [ ] WS clients can send messages directly (bypass Telegram/Discord — useful for WebUI and CLI chat)
- [ ] Auth for WS connections — token-based, secret set in config
- [ ] Update `CLAUDE.md` with WebSocket architecture notes

### Phase 5 — CLI Commands

Add an `openwren` CLI that controls the running bot process. Connects to the Phase 4 WebSocket gateway for status and live interaction. Basic commands use PID file management; advanced ones use WS.

- [ ] `bin/openwren.ts` — CLI entry point, wired into `package.json` `bin` field
- [ ] `openwren start` — spawns bot as background daemon, writes PID to `~/.openwren/openwren.pid`, redirects logs to `~/.openwren/openwren.log`
- [ ] `openwren stop` — reads PID file, sends SIGTERM gracefully
- [ ] `openwren restart` — stop + start
- [ ] `openwren status` — connects to WS gateway, prints running agents, active channels, uptime
- [ ] `openwren logs` — tails `~/.openwren/openwren.log`
- [ ] `openwren chat <agent>` — interactive terminal chat session via WS (no Telegram needed for dev/testing)

### Phase 6 — Installer / npm Packaging

Package Open Wren for global install. After this phase, users run `npm install -g openwren` and never need to clone the repo.

- [ ] Configure `package.json` `bin` field pointing to compiled CLI entry point
- [ ] Build pipeline — `tsc` to `dist/`, copy step for template files (tsc doesn't copy non-TS files)
- [ ] `openwren init` command — first-run wizard: creates `~/.openwren/`, writes template `openwren.json` and `.env`, prints setup instructions
- [ ] README with install + setup instructions for GitHub release
- [ ] Verify `npm install -g .` works end-to-end: install → `openwren init` → `openwren start` → bot responds on Telegram

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