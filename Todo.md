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

### Phase 5 — CLI Commands

Standalone CLI for process management and interactive chat. No imports from the main app — starts fast, works even if config is broken. Dev usage: `npm run cli -- <command>`. After Phase 6 (packaging): `openwren <command>`.

### Phase 6 — Installer / npm Packaging

Package Open Wren for global install via `npm install -g openwren`. Versioning: CalVer `YYYY.M.D` (date-based).

### Phase 6.1 — README v1

First proper README for the npm package and GitHub repo. Covers install, setup, CLI commands, configuration, adding agents, Discord setup, and license.

### Phase 6.2 — Switch to ES Modules (via tsup bundler)

Migrate from CommonJS to ESM using `tsup` as the bundler. `tsc` becomes type-check only (`noEmit: true`). The bundler handles all module resolution — no `.js` extensions needed anywhere in source.

- [x] `npm install --save-dev tsup tsx` — bundler + ts-node replacement for dev
- [x] `tsup.config.ts` — two entry points (`src/index.ts`, `src/cli.ts`), ESM output, copy templates, shebang on cli
- [x] `tsconfig.json` — add `"noEmit": true`, `"allowImportingTsExtensions": true`; tsc is now type-check only
- [x] `package.json` — `"type": "module"`, replace `ts-node` with `tsx` in `dev`/`cli`/`scratch` scripts, replace `tsc` build with `tsup`
- [x] `src/config.ts` — `__dirname` → `import.meta.dirname`
- [x] `src/cli.ts` — `__dirname` → `import.meta.dirname`, `__filename` → `import.meta.filename`, update `resolveServerArgs()` dev branch from `-r ts-node/register` → `--import tsx` (keeps `openwren start` working in dev mode)
- [x] Remove `ts-node` from devDependencies

**Verify (dev mode via `npm run cli --`):**
- [x] `npm run build` compiles clean
- [ ] `npm run dev` starts and responds to a message
- [x] `npm run cli -- init --force` creates workspace files (use `OPENWREN_HOME=~/.openwren-test`)
- [x] `npm run cli -- start` spawns daemon
- [x] `npm run cli -- status` connects and shows agents/uptime
- [x] `npm run cli -- logs` tails the log file
- [x] `npm run cli -- chat` works via WebSocket
- [x] `npm run cli -- stop` stops the daemon cleanly

**Verify (production via globally installed `openwren`):**
- [x] `npm run build && npm install -g .` installs successfully
- [x] `OPENWREN_HOME=~/.openwren-test openwren init --force` creates workspace files
- [x] `OPENWREN_HOME=~/.openwren-test openwren start` spawns daemon
- [x] `OPENWREN_HOME=~/.openwren-test openwren status` shows agents/uptime
- [x] `OPENWREN_HOME=~/.openwren-test openwren logs` tails the log file
- [x] `OPENWREN_HOME=~/.openwren-test openwren chat` works via WebSocket
- [x] `OPENWREN_HOME=~/.openwren-test openwren stop` stops the daemon cleanly
- [x] Clean up: `rm -rf ~/.openwren-test`

### Phase 7 — Ollama Support

Add local LLM support via Ollama. Same `LLMProvider` interface — the agent loop doesn't know or care.

- [x] `src/config.ts` — add `providers.ollama.baseUrl` (default: `http://localhost:11434`)
- [x] `src/providers/ollama.ts` — implement `LLMProvider` against Ollama REST API. Translates internal Anthropic-style message format to OpenAI-compatible format Ollama expects (tool definitions, tool calls, tool results, system prompt)
- [x] `src/providers/index.ts` — wire in OllamaProvider, replace existing stub
- [x] `src/channels/websocket.ts` — log incoming user messages
- [x] `src/index.ts` — log per-agent model overrides at boot
- [x] Test with `ollama/gpt-oss:20b` — basic chat confirmed working via Telegram
- [ ] Test tool calling with Ollama model
- [ ] Recommended models for function calling: `qwen3:8b`, `llama3.2`


## Left to do Phases

### Phase 8 — Skills System

Add a skills loader that injects capability instructions into the system prompt at session start. See `Skills.md` for full architecture and SKILL.md format.

**Design decisions:**
- Hand-rolled frontmatter parser (no YAML lib). Validate `requires.bins` names against `[a-zA-Z0-9_-]` before spawning `which`.
- Env gate reads `~/.openwren/.env` once at boot (via dotenv, already loaded) + `process.env` fallback. Reload deferred to Phase 12 (`reloadEnv()`).
- `autoload: true` frontmatter field — skill body injected directly into system prompt (no `load_skill` call needed). Used for memory-management and file-operations. Other skills use two-stage catalog + on-demand loading.
- Trim `## Memory` and `## Tools` sections from default soul template in `workspace.ts` (existing user soul files untouched).

**Tasks:**
- [ ] `src/agent/skills.ts` — catalog builder: scan bundled → global → per-agent dirs, parse frontmatter (hand-rolled), gate checks (`requires.env`, `requires.bins`, `requires.os`), `enabled` check, config overrides. Returns catalog entries (name + description) and autoloaded skill bodies separately.
- [ ] `src/tools/skills.ts` — `load_skill` tool: reads full SKILL.md body on demand, returns as tool result
- [ ] `src/agent/prompt.ts` — append autoloaded skill bodies + skill catalog after soul.md
- [ ] `src/tools/index.ts` — register `load_skill` tool
- [ ] `src/config.ts` — add `skills` config section (`allowBundled`, `entries.<name>.enabled`, `load.extraDirs`)
- [ ] `src/workspace.ts` — ensure `~/.openwren/skills/` directory exists; trim default soul template
- [ ] Bundled skill: `src/skills/memory-management/SKILL.md` (`autoload: true`)
- [ ] Bundled skill: `src/skills/file-operations/SKILL.md` (`autoload: true`)
- [ ] Bundled skill stubs (Phase 9): `src/skills/brave-search/SKILL.md`, `src/skills/web-fetch/SKILL.md`, `src/skills/agent-browser/SKILL.md`
- [ ] Update build script in `package.json` to copy `src/skills` to `dist/skills`
- [ ] Update `CLAUDE.md` with skills architecture notes
- [ ] Build and verify `npm run dev` works

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
- [ ] **`reloadEnv()` / `reloadConfig()`** — hot-reload `.env` and `openwren.json` without restart. Needed when agents can self-modify (install skills, add API keys). Keep env data in a refreshable module-level map so reload is a one-function change