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
### Phase 9.6 — Token Tracking
### Phase 9.7 — Prompt Caching (Anthropic)

---
## Left to do Phases
---

---

### Phase 10 — Web UI (Dashboard)

A local browser dashboard at `http://127.0.0.1:3000`. Opened via `openwren dashboard` (opens browser). The existing Fastify gateway serves the built SPA as static files and handles all backend communication — REST API for data operations, WebSocket for chat.

**Tech stack:** React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui (Radix primitives). React 19 compiler handles memoization automatically — no `useMemo`/`useCallback` needed. shadcn components are copy-pasted into the project (not an npm dependency) — you own the code, full customization.

**Project structure:** `webui/` at the top level with its own `package.json`, separate from the Node.js backend. Clean separation — frontend and backend only communicate via WebSocket and REST API. Never import backend code from frontend or vice versa. This structure also allows wrapping in Electron or Tauri later for a native desktop app (`.dmg`, `.exe`) without any rewrite.

**Step 1 — Scaffolding**
- [x] Create `webui/` with Vite + React 19 + TypeScript — use `npx create-vite@latest webui -t react-ts` (NOT `npm create vite@latest webui -- --template react-ts` — the `--` separator breaks the template flag)
- [x] Run `npx shadcn@latest init` inside `webui/` — configures Tailwind, component system, theming
- [x] Add `@fastify/static` to gateway — serve `webui/dist/` as static files in production
- [x] Vite dev proxy config — forward `/api` and `/ws` to the running Fastify gateway during development
- [x] `openwren dashboard` CLI command — convenience shortcut that opens `http://localhost:3000` in default browser (dashboard is already running with the gateway)
- [x] Log on startup: `[gateway] Dashboard available at http://127.0.0.1:3000`
- [x] Add `webui` build step to project build script
- [x] TanStack Router setup with all routes + grouped sidebar layout + top bar + dark theme

Agent Pause now and let user review progress so far...

**Step 2 — Dashboard**
- [x] `GET /api/status` endpoint — uptime, agent count, active sessions, memory file count, channel status
- [x] System Status card — uptime, agents, sessions, memory files
- [x] Token Usage Today card — input, output, cached, estimated cost (from `GET /api/usage`)
- [x] Channels card — table of connected channels, bot name, status, last message
- [ ] Recent Activity card — reverse-chronological list of recent events (chat, jobs, workflows)
- [x] Scheduled Jobs card — upcoming jobs with next run time and status (from `GET /api/schedules`)
- [x] Auto-refresh every 30 seconds
- [x] Agents card — agent list with name, model, role badge (capped at 10 with "View all" link)
- [x] Token-in-URL auth — `?token=xxx` saved to localStorage, sent as Bearer on all API calls
- [x] `openwren dashboard` CLI includes token in URL

Agent Pause now and let user review progress so far...

**Step 3 — Chat & Sessions (two-mode layout)**

The Chat page is a full-screen experience with its own layout — not a page inside the dashboard sidebar. When navigating to `/chat`, the dashboard sidebar is replaced by a session sidebar (conversation history, agent selector, new chat button). The top bar stays the same in both modes. See `design.md` "Two-Mode Layout" section for wireframes and technical details.

Implementation:
- [x] Refactor root route — TopBar moves to root layout, dashboard sidebar becomes a layout route under root. Chat layout is a sibling layout route under root. Both render TopBar via the shared root.
- [x] `ChatLayout` component — session sidebar (left) + chat area (right). Lives in `components/layout/ChatLayout.tsx`.
- [x] Session sidebar — new chat button, placeholder session list
- [x] TopBar mode toggle — Chat/Dashboard button switches between modes
- [x] Remove Chat from dashboard sidebar
- [x] Backend: WS channel sessionId support — accept `sessionId` in WebSocket messages, route to `{uuid}.jsonl` instead of always using `main.jsonl`. Channel sessions (Telegram, Discord) keep using `main.jsonl`. WebUI sessions use UUID files.
- [x] Frontend: Fix `api.ts` to support request bodies on POST/PATCH/PUT — needed for creating sessions, renaming, etc.
- [x] Frontend: Add types for sessions and WS messages to `lib/types.ts` — session list response, session detail, WS send/receive message shapes
- [x] Frontend: Create `useWebSocket` hook + `WebSocketProvider` context — singleton WS connection at app root, reconnection logic, pages subscribe to specific event types (chat: token/message_out, logs: log events)
- [x] Agent selector — switch between Atlas, Einstein, Wizard, etc.
- [x] Session list — fetch from `GET /api/sessions`, show WebUI UUID sessions filtered by active agent
- [x] Chat interface — send messages via WS with `sessionId`, thinking indicator, message display
- [x] Session header — session title and agent name shown at top of chat area

Streaming (token-by-token):
- [x] Backend: Add `streamCallback?: (delta: string) => void` option to `runAgentLoop`. When provided and the provider supports `chatStream()`, use streaming instead of `chat()` and call the callback with each text delta. Graceful fallback: if streaming fails (e.g. provider doesn't support `stream:true` with tools), catches the error and falls through to the non-streaming `chat()` path.
- [x] Backend: Add `StreamPart` discriminated union type to `LLMProvider` interface — `text | tool-call | finish`. `chatStream()` changed from `AsyncIterable<string>` to `AsyncIterable<StreamPart>`. Uses AI SDK's `fullStream` to yield both text deltas and tool calls from a single LLM call.
- [x] Backend: In `websocket.ts`, pass `streamCallback` that sends `token` events directly to the requesting WS client via `sendTo()` (not broadcast). Each delta becomes `{ type: "token", payload: { text, sessionId } }`.
- [x] Backend: Add `onToolUse` and `onToolResult` callbacks to `RunLoopOptions`. Tool call iterations stay non-streaming. Emit `tool_use` event when a tool call starts (tool name, args) and `tool_result` when done. These fire in both streaming and non-streaming paths.
- [x] Backend: Add `TokenEvent`, `ToolUseEvent`, `ToolResultEvent` to the event bus type map for type safety (though they are sent via direct `sendTo()`, not `bus.emit()`).
- [x] Frontend: Handle `token`, `tool_use`, and `tool_result` WS events. Token streaming builds text incrementally via `streamingRef` (mutable ref to avoid React StrictMode double-invocation bug). Tool calls render as collapsible `ToolCallCard` components with spinner → checkmark transition.
- [x] Frontend: `ChatItem` union type (`TextItem | ToolCallItem`) replaces flat `ChatMessage`. Items rendered in order creating interleaved flow: text → tool card → text. Streaming text flushed to a message item when a tool call arrives mid-stream.
- [x] Bug fix: React StrictMode double-invoked state updaters that had `setItems()` nested inside `setStreamingText()`, causing duplicate messages. Fixed by using `streamingRef` (mutable ref) for synchronous reads and `setStreamingText` (state) only for re-renders.
- [x] Bug fix: AI SDK `fullStream` emits errors as stream parts (`type: "error"`), not thrown exceptions. Added re-throw in `ai-sdk.ts` so the agent loop's try/catch can handle it and fall back to `chat()`.
- [x] Session isolation: Added `sessionId` to `MessageOutEvent`, `AgentTypingEvent`, `AgentErrorEvent`, `MessageInEvent` in the event bus. WebSocket channel includes `sessionId` in all bus emits and direct `sendTo()` calls. Frontend filters all events by `sessionId` — Telegram/Discord responses (no sessionId) are silently ignored, preventing cross-channel leaks into the WebUI chat.

UX improvements:
- [x] Lazy session creation — "New Chat" navigates to `/chat` (no session file created). Session created via `POST /api/sessions` on first message send. URL updated with `window.history.replaceState()` to avoid route remount (which would destroy component state and WS subscription mid-stream).
- [x] Two-state chat input — **Fresh chat:** textarea centered vertically+horizontally on screen, auto-focused, "How can I help?" heading, send button inside textarea (bottom-right). **Active chat:** textarea pinned to bottom of screen, messages above, session header at top. Transition happens when first message is sent.
- [x] Auto-growing textarea — `useAutoResize` hook adjusts height to fit content on every input change. Fresh chat starts at `rows={3}`. Resets to base height when input is cleared after sending.
Session history loading (paginated):
- [x] Backend: `GET /api/sessions/:id/messages?limit=50` — reads session JSONL from the end, returns the last N messages transformed into ChatItem-compatible shape (TextItem for user/assistant text, ToolCallItem for tool-call/tool-result pairs). Includes total message count in response for pagination awareness.
- [x] Backend: `GET /api/sessions/:id/messages?limit=50&before=<timestamp>` — returns N messages older than the given timestamp. Used for scroll-up pagination to load earlier history.
- [x] Backend: Transform JSONL `Message` objects (AI SDK format with role user/assistant/tool, content arrays with text/tool-call/tool-result blocks) into flat ChatItem array the frontend can render directly. Timestamps stripped from text content.
- [x] Frontend: On session select, fetch last 50 messages and populate `items` state. Show messages immediately (no streaming — these are historical). Skips fetch during lazy creation (items already has user's first message).
- [x] Frontend: Scroll-up pagination with prefetch — when user scrolls past 80% of loaded messages (near the top, not at it), trigger fetch for the next 50 older messages and prepend to `items`. By the time the user reaches the actual top, the batch is already loaded. Maintain scroll position so the view doesn't jump. No loading indicator — prefetch is invisible to the user.
- [x] Ghost session cleanup — no code needed. Lazy session creation prevents new ghosts. Existing empty files manually deleted.
- [x] Bug fix: Timestamp buffering in `websocket.ts` `streamCallback` — buffers first ~18 chars of each streaming response to detect and strip echoed timestamps before they reach the frontend. If first char isn't `[`, flushes immediately (zero latency). After initial check, all subsequent deltas pass through with zero overhead.
- [x] Frontend: `stripTimestamps()` utility in `webui/src/lib/utils.ts` — shared regex for stripping `[Mon DD, HH:MM]` patterns. Applied in `tool_use` flush and `message_out` finalization paths.

ChatInput component:
- [x] Extract `ChatInput` component into `webui/src/components/chat/ChatInput.tsx` — single component used in both fresh and active modes. Props: `mode: "fresh" | "active"`, `agentId`, `onAgentChange`, `agents` list, `disabled`, `onSend`, `connected`.
- [x] Composite container — outer div styled as a single input (border, rounded corners, background). Inside: (1) borderless auto-growing textarea (~3 rows for typing), (2) bottom row with agent dropdown right-aligned.
- [x] Mode `"fresh"`: agent dropdown enabled, user picks which agent to chat with.
- [x] Mode `"active"`: agent dropdown visible but disabled/grayed — shows which agent is locked for this session.
- [x] Remove agent selector from `ChatSidebar` — it moves into `ChatInput`.
- [x] Enter to send, Shift+Enter for newline. No send button in either mode.
- [x] Remove send button from both fresh and active chat states.
- [x] Custom agent dropdown — replaced native `<select>` with custom `AgentPicker` component (button + positioned list with checkmark on selected item, outside-click-to-close). No OS-chrome dropdown.
- [x] Agent state ownership — `agentId` and agent list moved from `ChatLayout`/`ChatSidebar` into `Chat.tsx`. ChatLayout and ChatSidebar simplified (no agent props).
- [x] ChatSidebar cleanup — removed agent filter, shows all sessions sorted by `updatedAt` from API. Removed session icons, compacted item height.
- [x] Fresh chat subtitle — dynamic "Chat with {agentName}" instead of static "Start a conversation".

Theme & visual polish:
- [x] Dark theme — converted from oklch to hex. Background `#12141a`, card `#1e2028`, accent `#30323b`. Warm-neutral tint matching professional dark UIs.
- [x] Light theme — converted from oklch to hex. Off-white background `#f5f5f5`, white cards `#ffffff`, soft borders `#e0e0e0`.
- [x] Sidebar visual separation — background color difference only, no CSS border between sidebar and content area.
- [x] Removed session header border — clean borderless transition from header to messages.
- [x] Assistant message styling — removed bubble background (`bg-card`), softened text to `text-foreground/80`. Assistant text sits directly on page background like modern chat UIs.
- [x] Custom scrollbars — thin (4px), near-invisible at rest (5% opacity), subtle on hover (12%). Replaces thick native browser scrollbar.

Auto-naming sessions:
- [ ] After agent's first response in a new session, make a lightweight LLM call to generate a 3-5 word session title. `PATCH /api/sessions/:id` with the generated label. Session starts as "New Chat", gets renamed automatically. Sidebar refreshes to show the new name.

- [ ] Session header dropdown — clickable with Rename, Delete, Reset, Force compaction actions
- [ ] Read-only fallback — if gateway goes unreachable mid-session, show history but disable input instead of crashing
- [ ] Session actions — reset session, force compaction, view archive list
- [ ] Abort button — cancel agent processing mid-stream

Agent Pause now and let user review progress so far...

**Step 4 — Agents**
- [ ] Agent list — all configured agents with name, model, status
- [ ] Soul file editor — view and edit `~/.openwren/agents/{id}/soul.md` directly in the UI
- [ ] Per-agent model override — change model/fallback without editing config file
- [ ] Model picker — browse available models when selecting per-agent or default model:
  - llmgateway: use `@llmgateway/models` package (cached weekly, includes pricing, context length, feature flags like tool support)
  - Direct providers (anthropic, openai, google, etc.): no model list API available — allow free-text model ID input with known models as suggestions
  - Filter by `tools: true` (OpenWren requires tool calling), group by provider family, show pricing per million tokens
- [ ] Agent creation — add a new agent (creates soul.md stub, adds to config)

Agent Pause now and let user review progress so far...

**Step 5 — Teams**
- [ ] Team list — show all teams with manager and member agents
- [ ] Team editor — create/edit teams: set manager (dropdown filtered to role:manager agents), select members (checkbox list)
- [ ] Team deletion with confirmation
- [ ] Validation: manager must have role:manager, members can't include the manager, team ID must be unique

Agent Pause now and let user review progress so far...

**Step 6 — Config**
- [ ] Config editor — view and edit `~/.openwren/openwren.json` via form or raw JSON5
- [ ] Config validation — show errors before saving, protect against concurrent edits
- [ ] Restart prompt — notify when a config change requires restart to take effect

Agent Pause now and let user review progress so far...

**Step 7 — Schedules (uses Phase 9.1 REST API)**
- [ ] Cron job list — view all scheduled tasks, last run time, next run time (GET /api/schedules)
- [ ] Enable/disable/run-now controls per job (POST /api/schedules/:id/enable|disable|run)
- [ ] Create/edit/delete scheduled jobs via form UI
- [ ] Run history viewer per job
- [ ] Heartbeat checklist editor (edit heartbeat.md per agent)

Agent Pause now and let user review progress so far...

**Step 8 — Usage**
- [ ] Period selector — Today, 7d, 30d, All (sums from summary.json days, no extra API call)
- [ ] Summary cards — total input, output, cached tokens, estimated cost
- [ ] Daily breakdown — horizontal bar chart (cached vs uncached), from summary.json.days
- [ ] By Agent / By Provider / By Source — sorted lists with token counts and percentages
- [ ] Drill-down table — click any bar/row to see per-request entries (GET /api/usage/detail)
- [ ] Cost estimation — per-model pricing (from @llmgateway/models or config map)
- [ ] Auto-refresh every 60 seconds

Agent Pause now and let user review progress so far...

**Step 9 — Memory**
- [ ] Memory file browser — list all files in `~/.openwren/memory/`
- [ ] Memory editor — view and edit individual memory files (markdown)
- [ ] Memory delete — remove stale memory keys

Agent Pause now and let user review progress so far...

**Step 10 — Skills**
- [ ] Skills panel — list all loaded skills, which are active vs gated out, enable/disable toggle

Agent Pause now and let user review progress so far...

**Step 11 — Workflows**
- [ ] Workflow list — active and completed workflows with status badge, manager, started date
- [ ] Status filter — All, Running, Completed, Failed
- [ ] Workflow detail — task tree view showing parent-child hierarchy, status per task, duration, assigned agent
- [ ] Task detail — click a task node to see full info: agent, assigned by, status, duration, result summary, deliverables, error
- [ ] Real-time updates — active workflow task statuses update via WebSocket events (task_completed, task_failed)

Agent Pause now and let user review progress so far...

**Step 12 — Logs**
- [ ] Live log tail — stream `~/.openwren/openwren.log` with text filter

Agent Pause now and let user review progress so far...

**Step 13 — Approvals**
- [ ] Approval panel — view pending shell command confirmations and approve/reject from browser
- [ ] Allowlist editor — view and edit `exec-approvals.json` (permanently approved commands per agent)

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
- [ ] Logging and usage tracking (token counts, cost per message)
- [ ] Docker + `docker-compose` for VPS deployment
- [ ] **File access sandbox review** — consider configurable `allowedPaths` so agent can access directories outside workspace without full shell access
- [ ] **Shell path hardening** — validate that shell command arguments resolve inside the workspace before execution. Currently cwd is set to `~/.openwren/` but agents can escape via absolute paths (`ls /etc`) or relative paths (`cat ../../`). Needs per-command path argument validation.
- [ ] **Shell command whitelist review** — make whitelist configurable via `openwren.json` so users can add/remove commands without touching code
- [ ] **`reloadEnv()` / `reloadConfig()`** — hot-reload `.env` and `openwren.json` without restart. Needed when agents can self-modify (install skills, add API keys). Keep env data in a refreshable module-level map so reload is a one-function change
- [ ] **Exact token tracking** — replace character ÷ 4 estimates with exact input/output token counts from Anthropic API `usage` field in responses. Apply to session compaction estimates, run history logging, and future usage dashboard