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

### Phase 9.1 — Cron / Scheduled Tasks + Heartbeat

Proactive agent messaging: scheduled jobs (cron, interval, one-shot) and periodic heartbeat check-ins. Jobs are agent-bound, not channel-bound. All three creation paths (agent tool, CLI, HTTP API) write to the same `schedules.json` file. Heartbeat is a separate, simpler mechanism driven by a per-agent markdown checklist.

**Research reference:** `openclaw-cron-research.md` in project root — documents OpenClaw's two-tier scheduling (heartbeat + cron), their design decisions, and what we adopted/adapted/avoided.

#### Architecture Overview

```
src/scheduler/
├── index.ts          # Scheduler class: load jobs on startup, create/manage croner timers,
│                     #   CRUD operations (createJob, listJobs, updateJob, deleteJob),
│                     #   in-memory state + file persistence, heartbeat timer management
├── queue.ts          # FIFO job queue: enqueue due jobs, process sequentially (one at a time),
│                     #   prevents parallel LLM calls and rate limit issues
├── runner.ts         # Execute a single job: resolve agent, create session (isolated or main),
│                     #   call agent loop, check HEARTBEAT_OK, deliver to channel, log run history
├── store.ts          # File I/O: read/write schedules.json, append/prune run history JSONL,
│                     #   generateJobId with conflict resolution (slugify + dedupe)
└── heartbeat.ts      # Heartbeat timer: reads heartbeat.md each cycle, injects into agent turn,
                      #   HEARTBEAT_OK suppression, active hours gating
```

```
src/gateway/routes/
└── schedules.ts      # REST API: GET/POST/PATCH/DELETE /api/schedules — thin layer over
                      #   scheduler CRUD functions, used by CLI and future WebUI
```

**Three access paths, one core:**
- Agent tool (`manage_schedule`) → calls scheduler functions directly (in-process)
- CLI (`openwren schedule <cmd>`) → HTTP requests to REST API on running daemon
- WebUI (future) → same REST API endpoints

#### Storage Layout

```
~/.openwren/
├── schedules.json                    # All jobs — single JSON file, loaded into memory on startup
├── schedules/
│   └── runs/
│       ├── morning-briefing.jsonl    # Run history per job (append-only, auto-pruned to 500 lines)
│       └── water-reminder.jsonl
├── agents/
│   ├── atlas/
│   │   ├── soul.md
│   │   └── heartbeat.md             # Heartbeat checklist (read fresh each cycle, never cached)
│   ├── coach/
│   │   └── soul.md
```

**`schedules.json` format** — keyed by jobId (slugified from name, auto-deduped on conflict):
```json
{
  "morning-briefing": {
    "name": "Morning briefing",
    "agent": "atlas",
    "schedule": { "cron": "0 8 * * 1-5" },
    "prompt": "Check my memory files and give me a morning status update.",
    "channel": "telegram",
    "user": "owner",
    "isolated": true,
    "enabled": true,
    "deleteAfterRun": false,
    "createdBy": "owner",
    "createdAt": "2026-03-08T10:00:00Z"
  }
}
```

**Three schedule types:**
- `{ "cron": "0 8 * * 1-5" }` — full 5-field cron expression (parsed by `croner` library). Active hours baked into the expression itself (e.g. `0 8-22/2 * * *` for every 2h between 8am–10pm)
- `{ "every": "2h" }` — simple interval. Supported units: `m` (minutes), `h` (hours), `d` (days). Examples: `"30m"`, `"2h"`, `"1d"`. No weeks/months/years — use cron expressions for those (e.g. `0 9 * * 1` for weekly, `0 10 1 * *` for monthly). Optional `activeHours`: `{ "every": "2h", "activeHours": { "start": "08:00", "end": "22:00" } }`. If outside active hours, skip and wait for next interval
- `{ "at": "2026-03-15T09:00:00" }` — one-shot, fires once. Always interpreted in the user's configured `timezone` from openwren.json. **Timezone suffix stripping:** if the input contains `Z` or `+HH:MM` suffix (from CLI input, agent tool, or manual JSON edit), strip it silently and store bare `"YYYY-MM-DDTHH:MM:SS"`. This prevents timezone misinterpretation — there is no reason for a user to specify a suffix since the timezone comes from config. **Implementation note:** do NOT use `new Date()` to interpret `at` values — it uses the server's system timezone, not the user's configured timezone. Use croner with explicit `{ timezone: config.timezone }` or `Intl.DateTimeFormat` to convert to UTC ms. This ensures correct behavior even when server timezone ≠ user's configured timezone (e.g. server in UTC, user config says `Europe/Stockholm`). Auto-disables after run (`enabled: false`). Optional `"deleteAfterRun": true` to remove entirely

**Run history JSONL** — `schedules/runs/{jobId}.jsonl`:
```jsonl
{"ts":1709801400000,"status":"ok","durationMs":12300,"tokens":850,"delivered":true}
{"ts":1709816000000,"status":"ok","durationMs":5100,"tokens":430,"delivered":false,"suppressed":"HEARTBEAT_OK"}
{"ts":1709823200000,"status":"error","error":"rate_limit","errorType":"transient","durationMs":0,"delivered":false}
{"ts":1709823230000,"status":"ok","durationMs":15000,"tokens":900,"delivered":true,"retry":1}
```

Auto-pruned: keep last 500 lines (configurable via `scheduler.runHistory.maxLines`).

**`durationMs`** — wall-clock time around the agent loop call (`Date.now()` before/after). Includes network latency, LLM thinking, tool calls.
**`tokens`** — rough estimate using character count ÷ 4 (same approach as session compaction). Good enough for Phase 9.1. Upgrade to exact Anthropic API `usage` field tracking planned for Phase 12.

#### Session Isolation

- **Isolated** (default for cron jobs, `"isolated": true`) — job gets its own session file: `sessions/{userId}/{agentId}/cron-{jobId}.jsonl`. No conversation history, fresh start with soul file + job prompt. Agent can still read memory files via tools. Each run appends to the same session file (so the agent can reference previous runs of the same job)
- **Main session** (`"isolated": false`, always used by heartbeat) — job runs inside `sessions/{userId}/{agentId}/active.jsonl`, same as user conversations. Agent has full context of prior chat. Used when the job needs awareness of what the user has been discussing

#### Config Keys (openwren.json)

Only global scheduler and heartbeat settings. Individual jobs live in `schedules.json`, not here.

```json5
{
  // Heartbeat
  "heartbeat.enabled": true,
  "heartbeat.every": "30m",
  "heartbeat.activeHours.start": "08:00",
  "heartbeat.activeHours.end": "22:00",

  // Scheduler globals
  "scheduler.enabled": true,
  "scheduler.runHistory.maxLines": 500,
}
```

#### Heartbeat

Periodic check-in where the agent wakes up, reads `~/.openwren/agents/{agentId}/heartbeat.md`, processes the checklist in a single turn within the main session, and either messages the user or stays silent.

- Config: `heartbeat.enabled`, `heartbeat.every` (interval), `heartbeat.activeHours` (start/end)
- File: `~/.openwren/agents/{agentId}/heartbeat.md` — user-editable checklist, read fresh each cycle
- Runs in main session (full conversation context)
- HEARTBEAT_OK suppression: agent responds with exactly `HEARTBEAT_OK` if nothing to report → our code swallows it, no message delivered to user
- Active hours: heartbeat skipped if current time is outside configured window
- Per-agent: each agent can have its own `heartbeat.md` with different concerns. Agents without a `heartbeat.md` file are silently skipped

#### HEARTBEAT_OK Flow

```
1. Timer fires (every 30m)
2. Check active hours → if outside window, skip
3. Read ~/.openwren/agents/{agentId}/heartbeat.md → if missing, skip
4. Inject checklist content into agent turn (main session)
5. Agent thinks, checks memory/files, processes checklist
6. Agent responds:
   ├── "HEARTBEAT_OK" → swallow response, don't deliver, log as suppressed
   └── Anything else  → deliver to user's bound channel
7. Log run to heartbeat run history
```

#### Error Handling

- **Transient errors** (rate limit, timeout, 5xx) → exponential backoff retry (30s, 1m, 5m), job stays enabled
- **Permanent errors** (auth failure, validation) → job auto-disabled, logged
- **One-shot (`at`) jobs** → up to 3 retries on transient errors, then disable
- **Recurring jobs** → backoff before next scheduled run, reset backoff after success

#### Job Lifecycle

```
              ┌──────────┐
  create ────►│ enabled  │
              └────┬─────┘
                   │
      ┌────────────┼─────────────┐
      ▼            ▼             ▼
 user/agent     one-shot      user/agent
 disables      completes      deletes
      │            │             │
      ▼            ▼             ▼
 ┌──────────┐  ┌──────────┐  removed from
 │ disabled │  │ disabled │  schedules.json
 └────┬─────┘  │(or deleted│  + run history
      │        │if delete  │    deleted
      ▼        │AfterRun)  │
 user/agent    └───────────┘
 deletes
      │
      ▼
 removed entirely
```

#### Agent Tool — `manage_schedule`

Single tool with actions: `create`, `list`, `update`, `delete`, `enable`, `disable`.

For `create` — required: `name`, `schedule`, `prompt`. Optional: `agent` (defaults to current agent), `channel` (defaults to current channel), `isolated` (default true), `deleteAfterRun` (default false), `user` (default current user).

Tool description instructs the agent: "Before creating a schedule, confirm with the user: the schedule timing, which agent should run it, and what the prompt should say. Do not create a schedule without explicit user confirmation of these details."

#### CLI Commands

```
openwren schedule list                     # List all jobs (id, name, schedule, enabled, last run, next run)
openwren schedule create                   # Interactive: prompts for name, schedule, agent, prompt, channel
openwren schedule enable <jobId>           # Enable a disabled job
openwren schedule disable <jobId>          # Disable a job (keeps in file)
openwren schedule delete <jobId>           # Remove job + run history
openwren schedule history <jobId>          # Show recent runs for a job
openwren schedule run <jobId>              # Trigger a job immediately (bypass schedule)
```

CLI sends HTTP requests to REST API on the running daemon (same pattern as `openwren status` uses WS gateway).

#### Dependencies

- `croner` — zero-dep cron expression parser + scheduler. ESM native, timezone support, 5/6-field expressions. Handles `cron` schedule type. For `every` and `at` types, we use simple `setTimeout`/`setInterval` with our own parsing

#### Implementation Tasks

**Step 1: Scaffold + Storage**
- [x] Create `src/scheduler/` directory
- [x] `store.ts` — read/write `schedules.json`, `generateJobId()` with slugify + conflict resolution, append run history JSONL, prune run history by max lines. Include `normalizeAtValue()` — strips timezone suffixes (Z, +HH:MM, -HH:MM) from `at` schedule values on all input paths (agent tool, CLI, REST API). All three creation paths call this before storing
- [x] Add `schedules/` and `schedules/runs/` to workspace directory creation in `workspace.ts`
- [x] Add `scheduler.enabled`, `scheduler.runHistory.maxLines`, `heartbeat.*` keys to `defaultConfig` in `config.ts`

**Step 2: Queue + Runner**
- [x] `queue.ts` — FIFO queue class: `enqueue(job)`, sequential `processNext()`, one job at a time, event or callback on completion
- [x] `runner.ts` — execute a single job: resolve agent config, determine session path (isolated vs main), call agent loop with job prompt as user message, return agent response
- [x] Handle HEARTBEAT_OK suppression in runner (string check on response, skip delivery)
- [x] Delivery: add `sendMessage()` to Channel interface, implement in TelegramChannel and DiscordChannel, add `deliverMessage()` to channels barrel

**Step 3: Scheduler Core**
- [x] Install `croner` dependency
- [x] `index.ts` — Scheduler class: `start()` loads `schedules.json`, creates `Cron` timer per enabled job, `stop()` cancels all timers
- [x] Handle three schedule types: `cron` → `new Cron(expr, ...)`, `every` → `setInterval` with active hours check, `at` → `setTimeout` to target date
- [x] On timer fire: enqueue job into the queue
- [x] One-shot (`at`) jobs: auto-disable after successful run, optionally delete if `deleteAfterRun`
- [x] CRUD operations: `createJob()`, `updateJob()`, `deleteJob()`, `enableJob()`, `disableJob()` — update in-memory state, persist to file, create/cancel timers as needed
- [x] `listJobs()` — return all jobs with next run time (croner provides `.nextRun()`)
- [x] Timezone: pass `config.timezone` to croner for all `cron` type jobs. For `at` type: strip any timezone suffix (Z, +HH:MM) from input, interpret bare datetime string in `config.timezone` using croner or Intl.DateTimeFormat — never `new Date()`. For `every` with `activeHours`: check current time in `config.timezone` before firing. Comment all timezone-related functions clearly explaining why `new Date()` is avoided

**Step 4: Heartbeat**
- [x] `heartbeat.ts` — heartbeat timer using `setInterval` based on `heartbeat.every` config
- [x] On each cycle: check active hours → read `heartbeat.md` for each agent that has one → enqueue as a main-session job with the checklist as the prompt
- [x] Instruct agent via system message prefix: "If nothing is worth reporting, respond with exactly HEARTBEAT_OK"
- [x] Start/stop heartbeat timer alongside scheduler in `index.ts`

**Step 5: Error Handling + Retry**
- [x] Classify errors as transient (rate limit, timeout, 5xx) or permanent (auth, validation)
- [x] Transient: exponential backoff retry (30s, 1m, 5m) — re-enqueue with delay
- [x] Permanent: auto-disable job, log error
- [x] One-shot: max 3 retries, then disable
- [x] Log all runs (success + failure) to run history JSONL

**Step 6: Agent Tool**
- [x] `src/tools/schedule.ts` — `manage_schedule` tool definition + executor
- [x] Actions: `create`, `list`, `update`, `delete`, `enable`, `disable`
- [x] Tool description: instruct agent to gather required details before creating
- [x] Register in `src/tools/index.ts`

**Step 7: REST API**
- [x] `src/gateway/routes/schedules.ts` — REST endpoints on Fastify
- [x] `GET /api/schedules` — list all jobs with status/next run
- [x] `POST /api/schedules` — create job (validate required fields)
- [x] `PATCH /api/schedules/:id` — update job fields
- [x] `DELETE /api/schedules/:id` — delete job + run history
- [x] `POST /api/schedules/:id/run` — trigger immediate execution
- [x] `POST /api/schedules/:id/enable` and `/disable`
- [x] `GET /api/schedules/:id/history` — run history for a job
- [x] Register routes in `gateway/server.ts`

**Step 8: CLI Schedule Commands**
- [x] Add `schedule` subcommand to `src/cli.ts`
- [x] `openwren schedule list` — GET /api/schedules, format as table
- [x] `openwren schedule create` — interactive prompts (name, agent, schedule, prompt, channel), POST /api/schedules
- [x] `openwren schedule enable/disable <id>` — POST to enable/disable endpoints
- [x] `openwren schedule delete <id>` — DELETE /api/schedules/:id
- [x] `openwren schedule history <id>` — GET /api/schedules/:id/history, format as table
- [x] `openwren schedule run <id>` — POST /api/schedules/:id/run

**Step 9: Integration + Boot**
- [x] Start scheduler in `src/index.ts` after channels are started (scheduler needs channels for delivery)
- [x] Stop scheduler in graceful shutdown (cancel all timers before closing channels)
- [x] Add scheduler status to `openwren status` output (enabled, job count, next run)
- [x] Emit scheduler events on event bus: `schedule_run`, `schedule_error` (for WS clients and future WebUI)

**Step 10: Skill + Documentation**
- [x] Create bundled skill `src/skills/scheduling/SKILL.md` — teaches agents how to use `manage_schedule` tool effectively, with examples of cron expressions, best practices for gathering requirements
- [x] Update `CLAUDE.md` with scheduler architecture notes
- [x] Update `README.md` with scheduled tasks section
- [x] Update Phase 10 (WebUI) todo already references scheduler REST API for schedule management UI

**Step 11: Testing**
- [x] Manual test: create job via CLI, verify it fires at scheduled time
- [x] Manual test: create job via agent conversation, verify agent asks for details
- [x] Manual test: heartbeat with `heartbeat.md`, verify HEARTBEAT_OK suppression
- [x] Manual test: one-shot job fires and auto-disables
- [x] Manual test: disable/enable/delete jobs via CLI
- [x] Manual test: `openwren schedule run <id>` triggers immediate execution
- [x] Manual test: error handling — stop Anthropic API, verify transient retry and logging
- [x] Verify run history JSONL is written and auto-pruned

### Phase 9.2 — Shell Approval Hardening

The current shell approval system has security gaps: only 4 commands (`mv`, `cp`, `mkdir`, `touch`) require user confirmation, while potentially dangerous commands (`git`, `npm`, `node`, `sed`, `curl`) run freely. Scheduled jobs bypass confirmation entirely since the `confirm` callback comes from channels and is unavailable in the scheduler's runner.

#### Tiered Whitelist

Split the existing flat whitelist into two tiers:

**Safe commands** — read-only or harmless, run freely everywhere (interactive + scheduled):
`ls`, `find`, `cat`, `head`, `tail`, `grep`, `wc`, `sort`, `uniq`, `jq`, `date`, `echo`, `which`, `ping`, `df`, `du`, `ps`, `lsof`

**Privileged commands** — can modify state, require confirmation:
`git`, `npm`, `npx`, `node`, `curl`, `sed`, `awk`, `mv`, `cp`, `mkdir`, `touch`, `agent-browser`

#### Approval Model

- **Interactive mode** (Telegram/Discord/WS): privileged commands prompt yes/always/no (expanding current behavior from 4 commands to all privileged ones)
- **Scheduled jobs**: privileged commands check `exec-approvals.json` only — if not pre-approved, hard block (return error to agent, log it). No async confirmation dance
- **`exec-approvals.json`**: change from exact command strings to **binary-level** approval. Approving `git status` once with "always" approves `git` for that agent — all subcommands. Per-agent scoping preserved

#### exec-approvals.json Format (binary-level)

```json
{
  "atlas": ["git", "curl", "npm"],
  "einstein": ["git"]
}
```

#### Implementation Tasks

- [ ] Rename `DESTRUCTIVE_COMMANDS` → `PRIVILEGED_COMMANDS` in `shell.ts`, expand the set
- [ ] Update `approvals.ts` — `isApproved()` checks binary name (not full command string), `permanentlyApprove()` stores binary name. Add migration from old exact-command format
- [ ] Update `tools/index.ts` — apply privileged check to the expanded set
- [ ] Update `runner.ts` or `loop.ts` — when no `confirm` callback is available (scheduled jobs), check approvals for privileged commands, hard block if not approved
- [ ] Update `list_shell_commands` tool output — indicate which commands are privileged and require approval
- [ ] Manual test: interactive approval flow with expanded privileged set
- [ ] Manual test: scheduled job blocked from running unapproved privileged command
- [ ] Manual test: scheduled job runs pre-approved privileged command successfully

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
- [ ] **Shell command whitelist review** — make whitelist configurable via `openwren.json` so users can add/remove commands without touching code
- [ ] **`reloadEnv()` / `reloadConfig()`** — hot-reload `.env` and `openwren.json` without restart. Needed when agents can self-modify (install skills, add API keys). Keep env data in a refreshable module-level map so reload is a one-function change
- [ ] **Exact token tracking** — replace character ÷ 4 estimates with exact input/output token counts from Anthropic API `usage` field in responses. Apply to session compaction estimates, run history logging, and future usage dashboard