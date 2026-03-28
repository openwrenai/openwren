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

---
## Left to do Phases
---

### Phase 9.5 — Token Tracking

Track real token usage across everything — chat, workflows, jobs, notifications. Record actual input/output token counts from the LLM provider (not character-based estimates). Full design in `docs/Tokens.md`.

**Step 1: Provider interface**
- [ ] Add `usage: { inputTokens, outputTokens }` to provider `chat()` response type
- [ ] Update Anthropic provider — extract `usage.input_tokens`, `usage.output_tokens` from API response
- [ ] Update Ollama provider — extract `prompt_eval_count`, `eval_count`

**Step 2: Database table**
- [ ] Add `tokenUsage` table to `src/orchestrator/schema.ts`
- [ ] Columns: `id`, `agentId`, `model`, `inputTokens`, `outputTokens`, `timestamp`, `source`, `sourceId`, `workflowId`, `userId`
- [ ] Add index on `timestamp`, `source`, `workflowId`
- [ ] Generate new migration

**Step 3: Recording in agent loop**
- [ ] Accumulate token counts across all ReAct iterations in `runAgentLoop()`
- [ ] Insert one `tokenUsage` row when the loop finishes
- [ ] Pass source context: `{ source, sourceId, workflowId, userId }` via `RunLoopOptions`

**Step 4: Wire up callers**
- [ ] Channel adapters — set `source: "chat"`, `userId`
- [ ] Orchestrator runner — set `source: "task"`, `sourceId: task.slug`, `workflowId`
- [ ] Scheduler runner — set `source: "job"`, `sourceId: jobId`
- [ ] Notify — set `source: "notify"`, `workflowId`

**Step 5: Query API**
- [ ] `GET /api/usage` — total usage with filters (date range, agent, model, source)
- [ ] `GET /api/usage/workflow/:id` — per-workflow cost
- [ ] Wire into `src/gateway/routes/`

**Step 6: CLI**
- [ ] `openwren usage` — show today's token usage summary
- [ ] `openwren usage --agent atlas --days 7` — per-agent breakdown

---

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

**Scheduled Tasks (uses Phase 9.1 REST API)**
- [ ] Cron job list — view all scheduled tasks, last run time, next run time (GET /api/schedules)
- [ ] Enable/disable/run-now controls per job (POST /api/schedules/:id/enable|disable|run)
- [ ] Create/edit/delete scheduled jobs via form UI
- [ ] Run history viewer per job
- [ ] Heartbeat checklist editor (edit heartbeat.md per agent)

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
- [ ] Logging and usage tracking (token counts, cost per message)
- [ ] Docker + `docker-compose` for VPS deployment
- [ ] **File access sandbox review** — consider configurable `allowedPaths` so agent can access directories outside workspace without full shell access
- [ ] **Shell path hardening** — validate that shell command arguments resolve inside the workspace before execution. Currently cwd is set to `~/.openwren/` but agents can escape via absolute paths (`ls /etc`) or relative paths (`cat ../../`). Needs per-command path argument validation.
- [ ] **Shell command whitelist review** — make whitelist configurable via `openwren.json` so users can add/remove commands without touching code
- [ ] **`reloadEnv()` / `reloadConfig()`** — hot-reload `.env` and `openwren.json` without restart. Needed when agents can self-modify (install skills, add API keys). Keep env data in a refreshable module-level map so reload is a one-function change
- [ ] **Exact token tracking** — replace character ÷ 4 estimates with exact input/output token counts from Anthropic API `usage` field in responses. Apply to session compaction estimates, run history logging, and future usage dashboard