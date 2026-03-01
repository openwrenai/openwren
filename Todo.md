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

## Left to do Phases

----- If I ASK YOU TO INSERT NEW PHASE INSERT AFTER THIS LINE ------

### Phase 3.7 — Per-Agent Provider/Model with Cascading Fallbacks

Add per-agent model selection and cascading fallback chains. Unified `"provider/model"` format (e.g. `"anthropic/claude-sonnet-4-6"`). Agents without a model inherit the global default. If the primary fails, fallbacks are tried in order.

- [x] `src/config.ts` — `defaultProvider` → `defaultModel` (string), add `defaultFallback`, remove `providers.*.model`, add `model?`/`fallback?` to `AgentConfig`
- [x] `src/providers/index.ts` — parsing utils (`parseProviderSpec`, `parseFallbackChain`), `resolveModelChain()`, `ProviderChain` class, replace `createProvider()` with `createProviderChain()`
- [x] `src/providers/anthropic.ts` — constructor accepts `model: string` parameter
- [x] `src/agent/loop.ts` — `createProvider()` → `createProviderChain(agentId)`
- [x] `src/templates/openwren.json` — update template with new config shape
- [x] `CLAUDE.md` — update config examples and provider docs
- [x] `~/.openwren/openwren.json` — migrate user config to new format
- [x] `src/providers/anthropic.ts` — add comments to `chat()` and constructor explaining what they do
- [x] `src/providers/index.ts` — add comments above every interface, function, and class explaining purpose
- [x] All new/modified functions across all files — add a comment above explaining what it does, purpose, etc
- [x] Test: compile clean, boot with provider/model logs, fallback triggers on error, scratch works

### Phase 3.7.1 — Timestamp Date Fix

Add dates to injected timestamps so agents can tell when days have passed between messages. `[HH:MM]` → `[Feb 28, HH:MM]`.

- [x] `src/agent/history.ts` — update `injectTimestamps()` to include month+day in timestamp format
- [x] Test: compile clean, verify timestamps show date in agent responses

### Phase 3.8 — Discord Channel

Add Discord as a second messaging channel. Each bot hardwired to one agent — no prefix routing. DMs only.

**Manual setup required before running:** Enable "Message Content Intent" in Discord Developer Portal → App → Bot → Privileged Gateway Intents.

- [x] `npm install discord.js` — add dependency
- [x] `src/channels/discord.ts` — `DiscordChannel implements Channel`. One `Client` per agent binding, DM-only filter, auth via `resolveUserId("discord", ...)`, rate limiting, confirmation flow (yes/no/always), typing indicator, agent name prepend, 2000-char message splitting, compaction notifications
- [x] `src/channels/index.ts` — import and add `createDiscordChannel()` to the `all` array
- [x] `src/templates/openwren.json` — add Discord binding and user ID examples
- [x] `src/gateway/server.ts` — fix misleading comment
- [x] `CLAUDE.md` — add `discord.js` to tech stack table, note Message Content Intent setup step
- [ ] Test: compile clean, DM bot → agent responds, unauthorized user silently rejected, rate limit works

### Phase 3.8.1 — Remove Prefix Routing from Telegram

Each Telegram bot is already hardwired to its agent via bindings — the router is only called for the default agent's bot. Remove this: every bot is always hardwired to its fixed agent.

- [ ] `src/channels/telegram.ts` — remove router call, all bots use fixed agentId
- [ ] `src/agent/router.ts` — delete (dead code after this change)
- [ ] Test: compile clean, each bot responds as its own agent only

---

### Phase 4 — Ollama Support

- [ ] `providers/ollama.ts` — implement same `LLMProvider` interface against Ollama REST API (`http://localhost:11434/api/chat`)
- [ ] Provider factory in `providers/index.ts` — read `config.provider` and return correct implementation
- [ ] Model selection in config (`llama3.2`, `qwen3`, `mistral`, etc.)
- [ ] Test tool_use compatibility — not all Ollama models support native function calling
- [ ] Fallback: if model doesn't support native tool_use, implement XML-based tool parsing in system prompt instead
- [ ] Recommended models to test first: `qwen3:8b` and `llama3.2` — best function calling support among open-source models

### Phase 5 — Web Search + Fetch

Add research capabilities once the core bot is stable and useful.

- [ ] `tools/search.ts` — Brave Search API wrapper (get free API key at brave.com/search/api)
- [ ] `tools/fetch.ts` — fetch URL, strip HTML with `@mozilla/readability`, truncate to ~3000 tokens
- [ ] Wire both tools into the tool registry
- [ ] Add `BRAVE_API_KEY` to `.env`

### Phase 6 — WhatsApp (Optional, Proceed with Caution)

WhatsApp support via `@whiskeysockets/baileys` — the same package OpenClaw uses (pinned at `7.0.0-rc.9`). This is unofficial and reverse-engineers the WhatsApp Web WebSocket protocol.

**Risks to be aware of before implementing:**
- Unofficial — can break if WhatsApp updates their protocol
- Violates WhatsApp Terms of Service — account ban is possible (low risk for personal use, but real)
- Supply chain risk — only ever install `@whiskeysockets/baileys`, never forks or similarly named packages (a malicious clone was caught stealing session tokens in late 2025)
- Session management is more complex than Telegram — requires QR code scan, persistent auth state on disk, reconnection logic

**Only implement this if Telegram doesn't meet your needs.**

- [ ] `channels/whatsapp.ts` — Baileys socket setup, QR code auth, message routing
- [ ] Persistent auth state (scan QR once, stays logged in)
- [ ] Reconnection logic (Baileys drops connection occasionally)
- [ ] Wire into gateway alongside Telegram channel

### Phase 7 — Polish + Deployment

- [ ] **Cron / scheduled tasks** — proactive messages (morning briefings, reminders). Use isolated session keys (`cron:morning-briefing`) separate from the main conversation session, so scheduled task history doesn't pollute your chat history
- [ ] **Pre-compaction memory flush** — before compacting a session, run a silent internal turn instructing the agent to save anything critical to memory files. Ensures nothing important is lost during compaction
- [ ] **Semantic memory search** — upgrade from keyword matching to vector embeddings so "auth bug" matches "authentication issues" (OpenClaw uses this in production)
- [ ] Logging and usage tracking (token counts, cost per message)
- [ ] Docker + `docker-compose` for deployment to a VPS
- [ ] **File access sandbox review** — currently `read_file`/`write_file` are sandboxed to `~/.bot-workspace` and `shell_exec` is unsandboxed (limited only by command whitelist). Review whether to add configurable allowed paths in `config.json` (e.g. `"allowedPaths": ["~/.bot-workspace", "~/Documents/projects"]`) so the agent can access specific directories outside the workspace without full shell access.
- [ ] **Shell command whitelist review** — review the current whitelist in `tools/shell.ts` and consider trimming commands that aren't needed. Note: the whitelist is hardcoded in `shell.ts` right now — consider making it configurable via `config.json` so the user can add/remove commands without touching code.

---

### Phase 8 — WebSocket Gateway

Upgrade `gateway/server.ts` from a stub health check into a real WebSocket server. This is the foundation that CLI commands, Web UI, and future native apps all connect to. Channels continue to call `runAgentLoop()` directly — the WebSocket layer is for external clients to observe and interact with the running bot.

- [ ] Add `ws` (or `@fastify/websocket`) alongside the existing Fastify HTTP server
- [ ] Define internal typed event protocol: `message_in`, `message_out`, `agent_typing`, `session_compacted`, `agent_error`, `status`
- [ ] Internal event bus — channels emit events when messages arrive and when responses go out
- [ ] WS clients can subscribe to all events (for WebUI / CLI live view)
- [ ] WS clients can send messages directly (bypass Telegram/Discord — useful for WebUI and CLI chat)
- [ ] Auth for WS connections — token-based, secret set in config
- [ ] Update `CLAUDE.md` with WebSocket architecture notes

### Phase 9 — CLI Commands

Add an `openwren` CLI that controls the running bot process. The CLI connects to the Phase 8 WebSocket gateway to query state and send commands. Basic commands implemented first as local process management (PID file), more advanced ones over WS.

- [ ] `bin/openwren.ts` — CLI entry point, wired into `package.json` `bin` field
- [ ] `openwren start` — spawns the bot as a background daemon, writes PID to `~/.openwren/openwren.pid`, redirects logs to `~/.openwren/openwren.log`
- [ ] `openwren stop` — reads PID file, sends SIGTERM gracefully
- [ ] `openwren restart` — stop + start
- [ ] `openwren status` — connects to WS gateway, prints running agents, active channels, uptime
- [ ] `openwren logs` — tails `~/.openwren/openwren.log`
- [ ] `openwren chat <agent>` — interactive terminal chat session via WS (no Telegram needed for dev/testing)

### Phase 10 — Installer / npm Packaging

Package Open Wren for global install via npm. After this phase, users install with `npm install -g openwren` and never need to clone the repo or run `npm run start`.

- [ ] Configure `package.json` `bin` field pointing to compiled CLI entry point
- [ ] Build pipeline — `tsc` output to `dist/`, include templates in the package (copy step needed since tsc doesn't copy non-TS files)
- [ ] `openwren init` command — first-run wizard that creates `~/.openwren/`, writes template `openwren.json` and `.env`, prints setup instructions
- [ ] README with install + setup instructions for GitHub release
- [ ] Verify `npm install -g .` works end-to-end: install → `openwren init` → `openwren start` → bot responds on Telegram

### Phase 11 — Web UI (Dashboard)

A local browser dashboard served by the Fastify server at `http://127.0.0.1:3000`. Connects to the Phase 8 WebSocket gateway. Accessible via `openwren dashboard` CLI command (opens browser). Token-auth at WS handshake — loopback connections auto-approved.

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

**Usage & Monitoring**
- [ ] Usage dashboard — token counts and estimated cost per session/agent/day
- [ ] Live log tail — stream `~/.openwren/openwren.log` with text filter
- [ ] System health — uptime, active agents, memory file count, session count

**Execution Approvals**
- [ ] Approval panel — view pending shell command confirmations and approve/reject from browser (alternative to replying yes/no in Telegram/Discord)
- [ ] Allowlist editor — view and edit `exec-approvals.json` (permanently approved commands per agent)

**Scheduled Tasks (Phase 7 prerequisite)**
- [ ] Cron job list — view all scheduled tasks, last run time, next run time
- [ ] Enable/disable/run-now controls per job