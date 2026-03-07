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

## Left to do Phases

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