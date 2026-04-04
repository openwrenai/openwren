## Completed Phases
### Phase 1 — Project Setup + Core Agent (no messaging yet)
### Phase 2 — Telegram Channel
### Phase 3 — Multi-Agent Routing
### Phase 3.1 — Session Refactor + User System + Timestamps
### Phase 3.2 — Externalize User Config (JSON5 + Dot-Notation)
### Phase 3.5 — Rebrand to Open Wren
### Phase 3.6 — Channel Decoupling (Bindings Pattern)
### Phase 3.7 — Per-Agent Provider/Model with Cascading Fallbacks
### Phase 3.7.1 — Timestamp Date Fix
### Phase 3.8 — Discord Channel
**Manual setup required before running:** Enable "Message Content Intent" in Discord Developer Portal → App → Bot → Privileged Gateway Intents.
Add Discord as a second messaging channel. Each bot hardwired to one agent — no prefix routing. DMs only.
### Phase 3.8.1 — Remove Prefix Routing
### Phase 4 — WebSocket Gateway
### Phase 5 — CLI Commands
### Phase 6 — Installer / npm Packaging
### Phase 6.1 — README v1
### Phase 6.2 — Switch to ES Modules (via tsup bundler)
### Phase 7 — Ollama Support
### Phase 8 — Skills System
### Phase 9 — Web Research (Search + Fetch + Browser)
Add web research tools: search, fetch, and browser. Search uses a provider abstraction (like LLM providers) so backends are swappable via config. Fetch and browser are standalone tools.
### Phase 9.1 — Cron / Scheduled Tasks + Heartbeat
### Phase 9.2 — Shell Security & Confirmation System
### Phase 9.3 — Agent Orchestration: Teams, Delegations & Multi-Level Hierarchy
### Phase 9.4 — Session Refactor
### Phase 9.5 — AI SDK Provider Integration
## Phase 9.6 — Token Tracking
### Phase 9.7 — Prompt Caching (Anthropic)
### Phase 9.8 — Session & Usage Fixes
- [x] Fix provider fallback tracking — added `provider`/`model` fields to `LLMResponse` so usage records the actual provider that served the response, not the primary that failed
- [x] Restore per-agent session paths — sessions moved from `sessions/{userId}/main.jsonl` (shared across all agents) to `sessions/{userId}/{agentId}/main.jsonl` (each agent gets its own session). Fixed regression from Phase 9.4 where Einstein's messages were going to Atlas's session.
- [x] Remove token estimate from scheduler — dropped `tokens` field from `RunResult`/`RunEntry`, removed `Math.ceil(length/4)` fallback. Usage system (Phase 9.6) handles all token tracking now.
- [x] Fix orphaned prompt accumulation — user message is now buffered in memory and only written to session JSONL after the first successful LLM response. If the provider fails, the prompt never hits the file. Prevents session files from filling up with unanswered prompts that confuse the LLM on subsequent runs.
---
## Left to do Phases
---

### Phase 10 — Web UI (Dashboard)

**Full design document:** `development/phases/phase10/design.md` — layout, theme, navigation, config editor behavior, implementation order.
**Page wireframes:** `development/phases/phase10/ui/*.md` — ASCII mockups, component specs, and behavior details for every section.

A local browser dashboard at `http://127.0.0.1:3000`. Always available when OpenWren is running — the Fastify gateway serves the built SPA as static files alongside the REST API and WebSocket. No special command needed to start it. `openwren dashboard` is a convenience shortcut that just opens the browser to the URL. The WebUI communicates with the backend via REST API for data operations and WebSocket for chat.

**Tech stack:** React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui (Radix primitives). React 19 compiler handles memoization automatically — no `useMemo`/`useCallback` needed. shadcn components are copy-pasted into the project (not an npm dependency) — you own the code, full customization.

**Project structure:** `webui/` at the top level with its own `package.json`, separate from the Node.js backend. Clean separation — frontend and backend only communicate via WebSocket and REST API. Never import backend code from frontend or vice versa. This structure also allows wrapping in Electron or Tauri later for a native desktop app (`.dmg`, `.exe`) without any rewrite.

**Setup steps:**
- [ ] Create `webui/` with Vite + React 19 + TypeScript
- [ ] Run `npx shadcn@latest init` inside `webui/` — configures Tailwind, component system, theming
- [ ] Add `@fastify/static` to gateway — serve `webui/dist/` as static files in production
- [ ] Vite dev proxy config — forward `/api` and `/ws` to the running Fastify gateway during development
- [ ] `openwren dashboard` CLI command — convenience shortcut that opens `http://localhost:3000` in default browser (dashboard is already running with the gateway)
- [ ] Log on startup: `[gateway] Dashboard available at http://127.0.0.1:3000`
- [ ] Add `webui` build step to project build script

Agent Pause now and let user review progress so far...

**Chat & Sessions**
- [ ] Chat interface — send messages, stream responses token-by-token, abort runs mid-stream
- [ ] Read-only fallback — if gateway goes unreachable mid-session, show history but disable input instead of crashing
- [ ] Agent selector — switch between Atlas, Einstein, Wizard, etc.
- [ ] Session list — browse all sessions per agent/user with last-active timestamps
- [ ] Session history viewer — read full conversation transcript for any session
- [ ] Session actions — reset session, force compaction, view archive list

Agent Pause now and let user review progress so far...

**Agents**
- [ ] Agent list — all configured agents with name, model, status
- [ ] Soul file editor — view and edit `~/.openwren/agents/{id}/soul.md` directly in the UI
- [ ] Per-agent model override — change model/fallback without editing config file
- [ ] Model picker — browse available models when selecting per-agent or default model:
  - llmgateway: use `@llmgateway/models` package (cached weekly, includes pricing, context length, feature flags like tool support)
  - Direct providers (anthropic, openai, google, etc.): no model list API available — allow free-text model ID input with known models as suggestions
  - Filter by `tools: true` (OpenWren requires tool calling), group by provider family, show pricing per million tokens
- [ ] Agent creation — add a new agent (creates soul.md stub, adds to config)

Agent Pause now and let user review progress so far...

**Teams**
- [ ] Team list — show all teams with manager and member agents
- [ ] Team editor — create/edit teams: set manager (dropdown filtered to role:manager agents), select members (checkbox list)
- [ ] Team deletion with confirmation
- [ ] Validation: manager must have role:manager, members can't include the manager, team ID must be unique

Agent Pause now and let user review progress so far...

**Workflows**
- [ ] Workflow list — active and completed workflows with status badge, manager, started date
- [ ] Status filter — All, Running, Completed, Failed
- [ ] Workflow detail — task tree view showing parent-child hierarchy, status per task, duration, assigned agent
- [ ] Task detail — click a task node to see full info: agent, assigned by, status, duration, result summary, deliverables, error
- [ ] Real-time updates — active workflow task statuses update via WebSocket events (task_completed, task_failed)

Agent Pause now and let user review progress so far...

**Memory**
- [ ] Memory file browser — list all files in `~/.openwren/memory/`
- [ ] Memory editor — view and edit individual memory files (markdown)
- [ ] Memory delete — remove stale memory keys

Agent Pause now and let user review progress so far...

**Config**
- [ ] Config editor — view and edit `~/.openwren/openwren.json` via form or raw JSON5
- [ ] Config validation — show errors before saving, protect against concurrent edits
- [ ] Restart prompt — notify when a config change requires restart to take effect

Agent Pause now and let user review progress so far...

**Channels & Status**
- [ ] Channel status panel — show which channels are connected (Telegram, Discord) and their bot usernames
- [ ] Per-channel connection health — last message received, error state if login failed

Agent Pause now and let user review progress so far...

**Skills**
- [ ] Skills panel — list all loaded skills, which are active vs gated out, enable/disable toggle

Agent Pause now and let user review progress so far...

**Usage & Monitoring**
- [ ] Usage dashboard — token counts and estimated cost per session/agent/day
- [ ] Live log tail — stream `~/.openwren/openwren.log` with text filter
- [ ] System health — uptime, active agents, memory file count, session count

Agent Pause now and let user review progress so far...

**Execution Approvals**
- [ ] Approval panel — view pending shell command confirmations and approve/reject from browser
- [ ] Allowlist editor — view and edit `exec-approvals.json` (permanently approved commands per agent)

Agent Pause now and let user review progress so far...

**Scheduled Tasks (uses Phase 9.1 REST API)**
- [ ] Cron job list — view all scheduled tasks, last run time, next run time (GET /api/schedules)
- [ ] Enable/disable/run-now controls per job (POST /api/schedules/:id/enable|disable|run)
- [ ] Create/edit/delete scheduled jobs via form UI
- [ ] Run history viewer per job
- [ ] Heartbeat checklist editor (edit heartbeat.md per agent)

Agent Pause now and let user review progress so far...

Agent Pause now and let user review progress so far...

### Phase 11 — WhatsApp (Optional, Proceed with Caution)

WhatsApp support via `@whiskeysockets/baileys`. Unofficial, reverse-engineers WhatsApp Web protocol.

**Risks:** violates WhatsApp ToS (ban possible), can break on protocol updates, supply chain risk — only ever install `@whiskeysockets/baileys`, never forks. A malicious clone was caught stealing session tokens in late 2025.

- [ ] `src/channels/whatsapp.ts` — Baileys socket setup, QR code auth, message routing
- [ ] Persistent auth state (scan QR once, stays logged in)
- [ ] Reconnection logic (Baileys drops connection occasionally)
- [ ] Wire into `channels/index.ts` alongside Telegram and Discord

### Phase 12 — Polish + Deployment

- [ ] **Pre-compaction memory flush** — before compacting, run a silent agent turn to save critical context to memory files
- [ ] **Semantic memory search** — upgrade from keyword matching to vector embeddings so "auth bug" matches "authentication issues"
- [ ] Docker + `docker-compose` for VPS deployment
- [ ] **File access sandbox review** — consider configurable `allowedPaths` so agent can access directories outside workspace without full shell access
- [ ] **Shell path hardening** — validate that shell command arguments resolve inside the workspace before execution. Currently cwd is set to `~/.openwren/` but agents can escape via absolute paths (`ls /etc`) or relative paths (`cat ../../`). Needs per-command path argument validation.
- [ ] **Shell command whitelist review** — make whitelist configurable via `openwren.json` so users can add/remove commands without touching code
- [ ] **`reloadEnv()` / `reloadConfig()`** — hot-reload `.env` and `openwren.json` without restart. Needed when agents can self-modify (install skills, add API keys). Keep env data in a refreshable module-level map so reload is a one-function change