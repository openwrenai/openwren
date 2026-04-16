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

Markdown rendering & streaming:
- [x] Streamdown integration — replaced raw `whitespace-pre-wrap` text with `<Streamdown>` component for proper markdown rendering (bold, lists, code blocks, tables). Historical messages render static, streaming text uses `animated isAnimating` props.
- [x] Syntax highlighting — `@streamdown/code` plugin with Shiki (`github-dark` theme). Code blocks render with full syntax colors.
- [x] Code block polish — CSS overrides to remove inner double border, hide download button, keep only copy-to-clipboard. Single-panel code blocks matching Claude.ai style.
- [x] Smooth streaming — `smoothStream({ chunking: "word" })` added to AI SDK `streamText()` call. Tokens arrive word-by-word with 10ms delay instead of character-by-character, creating smoother reading experience.

Chat layout:
- [x] Message layout — both user and assistant messages left-aligned (no split layout). User messages have `bg-card` background, assistant messages transparent. Name labels ("You" / agent name) with colored accents (blue/emerald) and timestamps.
- [x] Content width constraint — messages and input box centered at 60% width via `CHAT_WIDTH` toggle. Session header stays full-width. `ALIGN_MODE` toggle for easy switching between left-aligned and split layouts.
- [x] Sidebar accent color — soft blue tint for active session highlight, adapted for both dark and light themes. Light/dark sidebar backgrounds unified with page background (no visible division).
- [x] Agent picker hidden in active chat mode — agent name already shown in message labels and session header.
- [x] Send button — `SendHorizonal` icon, bumped to `size-8`, uses `bg-accent` for theme-safe styling.

Auto-naming sessions:
- [x] Auto-name on first message — after agent's first response, a background LLM call generates a 4-8 word title from the user's message only (like Claude.ai). Uses same provider/model as the agent. One-shot guard (`label !== "New Chat"`) prevents re-naming. Non-blocking — chat is unaffected if naming fails.
- [x] `SessionRenamedEvent` bus event — broadcast to all WS clients so sidebar and session header update in real-time without page reload.
- [x] Sidebar live refresh — `ChatSidebar` listens for `message_out` (refetches session list to show new sessions) and `session_renamed` (updates label in-place). No more stale sidebar.
- [x] WebUI-only — Telegram, Discord, and CLI channels are unaffected. Guard: `if (sessionId)` only fires for UUID-based WebUI sessions.

- [x] Session header dropdown — clickable label with chevron, DropdownMenu with Rename and Delete. Rename opens modal with pre-filled input, saves via PATCH API. Delete opens confirmation modal, removes session from disk (sessions.json + JSONL file) via DELETE API, navigates to /chat.
- [x] Sidebar session menu — ⋯ button appears on hover per session item, same Rename/Delete dropdown + modals. Sidebar and header stay in sync via DOM CustomEvents (`session-renamed`, `session-deleted`).
- [ ] Read-only fallback — if gateway goes unreachable mid-session, show history but disable input instead of crashing
- [ ] Session actions — reset session, force compaction, view archive list
- [ ] Abort button — cancel agent processing mid-stream

**Step 3.1 — Session Architecture Refactor**

Scrap multi-session UUID approach. One session per agent, all channels share it. Chat becomes a regular dashboard page.

Disk layout (new):
```
sessions/{userId}/{agentId}/
  session.jsonl                          ← one session, all channels
  archives/
    session-2026-04-09_21-30-00.jsonl    ← compaction/clear/reset archives
```

Session picker displays: "Atlas Session", "Einstein Session".

Backend:
- [x] `src/config.ts` — Add `agentSessionDir(userId, agentId)`, `agentSessionPath(userId, agentId)`, `agentSessionArchiveDir(userId, agentId)`. Remove `userSessionPath` (shared main.jsonl) and `userNamedSessionPath` (UUID sessions). Keep `userSessionDir`.
- [x] `src/agent/history.ts` — Fix `sessionDir`/`sessionPath` to use new config functions (agentId currently ignored via `_agentId`). Update `archiveAndWrite` to use `agentSessionArchiveDir`, name archives `session-{timestamp}.jsonl`.
- [x] `src/channels/websocket.ts` — Remove `autoNameSession()`, UUID session handling, `touchSession`/`getSession`/`updateSession` imports, `session_renamed` from broadcast list, `createProviderChain`/`Message` imports. Remove `sessionId` from WS message handling — client sends `{ type: "message", agentId, text }`. Remove `sessionOpts` — loop uses default path. Keep streaming callbacks in opts.
- [x] `src/channels/commands.ts` — Add `agentId` param to `handleCommand` and `handleNewSession`. Use `agentSessionPath`/`agentSessionArchiveDir` instead of `userSessionPath`/`userSessionArchiveDir`. Update all callers (websocket.ts, telegram.ts, discord.ts) to pass `agentId`.
- [x] `src/events.ts` — Remove `SessionRenamedEvent` interface and `session_renamed` from `BusEvents`.
- [x] `src/gateway/routes/sessions.ts` — Rewrite: `GET /api/sessions` scans `sessions/{userId}/*/session.jsonl`, returns agent list. `GET /api/sessions/:agentId/messages` for paginated history. `POST /api/sessions/:agentId/clear` archives + resets. Remove all UUID CRUD and `sessions/store` imports.
- [x] `src/workspace.ts` — Create `sessions/{userId}/{agentId}/` and `archives/` per configured agent on boot. Remove old flat `sessions/{userId}/archives/` creation.
- [x] `src/sessions/store.ts` — **Delete entirely**. No more UUID session index.
- No changes needed: `telegram.ts`, `discord.ts`, `agent/loop.ts`, `scheduler/runner.ts`, `scratch.ts` — all use default `loadSession(userId, agentId)` which becomes correct after `history.ts` fix.

Frontend:
- [x] **Delete**: `ChatLayout.tsx`, `ChatSidebar.tsx`, `routes/_chat.ts`, `routes/chatSession.ts` — all multi-session UI removed.
- [x] `webui/src/routes/chat.ts` — Re-parent from `chatLayout` to `dashboardLayout`. Path stays `/chat`.
- [x] `webui/src/routeTree.ts` — Remove chat layout + children. Add `chatRoute` under `dashboardLayout`.
- [x] `webui/src/components/layout/Sidebar.tsx` — Add "Chat" nav item (MessageSquare icon) to Control group.
- [x] `webui/src/pages/Chat.tsx` — Rewrite: remove lazy session creation, UUID params, rename/delete modals, `session_renamed` listener, `useNavigate`, ChatSidebar imports. Add session picker dropdown ("Atlas Session", "Einstein Session"). Load messages from `GET /api/sessions/:agentId/messages`. Send messages with just `agentId` (no sessionId). Add "Clear conversation" button → `POST /api/sessions/:agentId/clear`. Filter WS events by `agentId` instead of `sessionId`. Keep streaming, Streamdown markdown, tool cards, scroll-up pagination.
- [x] `webui/src/components/chat/ChatInput.tsx` — Remove `mode` prop (always active). Remove `AgentPicker` component (agent selected via session picker). Just textarea + send button.
- [x] `webui/src/lib/types.ts` — Remove: `SessionEntry`, `SessionListResponse`, `WsSessionRenamedEvent`, `sessionId` from `WsSendMessage`. Add new session list response type. Keep `SessionMessagesResponse`.

Verification:
- [x] Backend + frontend typecheck pass
- [x] Chat with Atlas via WebUI → writes to `sessions/owner/atlas/session.jsonl`
- [ ] Chat with Einstein via WebUI → writes to `sessions/owner/einstein/session.jsonl`
- [x] Telegram message to Atlas → writes to same `sessions/owner/atlas/session.jsonl`
- [ ] `/reset` command → archives session, starts fresh
- [x] Clear conversation button → archives session, chat reloads empty
- [x] Session picker switches between agents, loads correct history
- [ ] Compaction/idle reset/daily reset target correct per-agent file

Cross-channel visibility:
- [x] `webui/src/pages/Chat.tsx` — Add `message_in` handler in WS subscribe callback. When a `message_in` event arrives from a non-websocket channel (Telegram, Discord), inject it into the chat as a user message. Guard with `channel === "websocket"` skip to avoid duplicating messages already added optimistically by the WebUI sender. This makes Telegram/Discord user messages appear in WebUI in real-time.
- [x] `webui/src/lib/types.ts` — Add `WsMessageInEvent` interface to `WsServerEvent` union so TypeScript recognizes `message_in` events.

Channel origin tracking:
- [x] `src/providers/index.ts` — Add optional `channel?: string` and `isolated?: boolean` to `Message` interface. `channel` tracks origin (webui, telegram, discord, scheduler). `isolated` marks display-only messages that the LLM should never see.
- [x] `src/agent/loop.ts` — Add `channel?: string` to `RunLoopOptions`. When constructing the user message, attach `channel` from opts.
- [x] `src/agent/history.ts` — When loading messages for the LLM (`loadSession`), filter out messages where `isolated: true`. They exist in the JSONL for display but are invisible to the agent.
- [x] `src/channels/websocket.ts` — Pass `channel: "webui"` in `runAgentLoop` opts.
- [x] `src/channels/telegram.ts` — Pass `channel: "telegram"` in `runAgentLoop` opts.
- [x] `src/channels/discord.ts` — Pass `channel: "discord"` in `runAgentLoop` opts.
- [x] `src/scheduler/runner.ts` — Non-isolated jobs: pass `channel: "scheduler"` in `runAgentLoop` opts (messages already land in main `session.jsonl` via shared session). Isolated jobs: after `runAgentLoop` completes, append both the job prompt (role: "user") and agent response (role: "assistant") to the main `session.jsonl` with `isolated: true` and `channel: "scheduler"`. This is **in addition to** `deliverMessage(job.channel)` which pushes the response to the configured channel (Telegram, Discord, etc.). WebUI gets visibility two ways: persisted in `session.jsonl` (survives reload) and via bus event (live updates). The `deliverMessage` push and `session.jsonl` persistence serve different purposes — push delivers to the user's configured channel, persistence gives WebUI a complete conversation timeline.
- [x] `src/gateway/routes/sessions.ts` — Include `channel` and `isolated` fields in message API response.
- [x] `webui/src/lib/types.ts` — Add `channel?: string` and `isolated?: boolean` to `SessionMessagesResponse` message items. Add `channel?: string` to `WsMessageOutEvent`.
- [x] `webui/src/pages/Chat.tsx` — Store `channel` and `isolated` on `TextItem`. Show "via Telegram" / "via Discord" / "via Scheduler" badge on messages where channel is not webui/undefined. For isolated messages, show additional visual hint (dimmed opacity + dashed border) so user understands Atlas won't remember this if they reply.

Isolated job timestamp fix:
- [x] `src/agent/history.ts` — Add optional `timestamp` parameter to `appendMessage`. When provided, uses it instead of `Date.now()`. All existing callers unaffected (parameter is optional).
- [x] `src/scheduler/runner.ts` — Pass `startMs` as timestamp for isolated job prompt copy. Response copy uses `Date.now()` (correct — it's when the job finished). Ensures WebUI displays the actual job execution time, not when the copy happened.

Chat bubble polish:
- [x] "via Channel" badge — purple neon pill (`bg-purple-500/10 text-purple-400`), right-aligned in message header.
- [x] Job label — scheduler user messages show "Job: {name}" in amber (`text-amber-400`) instead of "You". Job name extracted from `[prefix]` in content, prefix stripped from displayed text.
- [x] Isolated card merge — isolated job prompt + response merged into single card. Prompt shown as muted sub-line (`text-xs`), response rendered below with Streamdown. Prevents two dashed-border cards glued together.
- [x] Non-isolated scheduler assistant messages — show agent name (Atlas) instead of "Job: {name}". The `[prefix]` is still stripped from displayed text. Only `role === "user"` scheduler messages get the "Job:" label.

**Step 4a — Agent Page: Dropdown, Tabs & File Editor**

Single `/agents` page with dropdown picker at the top to select an agent, tabbed content below. No table, no modal, no detail page navigation. Inspired by OpenClaw's agent management pattern. See `development/phases/phase10/ui/agents.md` for wireframes.

Packages to install:
- None (backend already has everything needed)

Backend (`src/gateway/routes/agents.ts` — new file):
- [x] `GET /api/agents` — returns lightweight list: `{ agents: Array<{ id, name }> }`. Just enough for the dropdown picker.
- [x] `GET /api/agents/:id` — returns full agent detail: `{ id, name, model, fallback, role, description, defaultModel, defaultFallback }`. `model`/`fallback` are the agent's own overrides (string or null). `defaultModel`/`defaultFallback` are the global defaults (for "Use default (currently: X)" labels). 404 if agent ID not found.
- [x] `GET /api/agents/:id/files` — returns list of known agent files with existence status: `{ files: Array<{ name: string, exists: boolean }> }`. Checks for: `soul.md`, `heartbeat.md`, `workflow.md`. Reads from `~/.openwren/agents/{id}/`. 404 if agent not in config.
- [x] `GET /api/agents/:id/files/:filename` — reads file content, returns `{ name: string, content: string }`. Returns empty string content if file doesn't exist yet (allows creating new files). Whitelisted filenames only: `soul.md`, `heartbeat.md`, `workflow.md` — 400 for anything else. 404 if agent not in config.
- [x] `PUT /api/agents/:id/files/:filename` — accepts `{ content: string }`, writes to `~/.openwren/agents/{id}/{filename}`. Creates parent directory if missing (`mkdirSync recursive`). Same filename whitelist as GET. No config reload needed — `loadSystemPrompt()` reads soul.md fresh from disk on every message. 404 if agent not in config, 400 if filename not whitelisted.
- [x] Auth: copy the `authenticate()` pattern from other route files (Bearer token + `timingSafeEqual`). Same pattern as `sessions.ts`, `status.ts`, etc.
- [x] Register in `src/gateway/server.ts` — import `registerAgentRoutes`, call after `registerStatusRoutes`.

Frontend — Types:
- [x] `webui/src/lib/types.ts` — add `AgentListItem` (`{ id, name }`), `Agent` type: `{ id, name, model: string | null, fallback: string | null, role: string | null, description: string | null, defaultModel?: string, defaultFallback?: string }`. Add `AgentListResponse`, `AgentFile`, `AgentFilesResponse`, `AgentFileContentResponse`.

Frontend — Agents page rewrite:
- [x] `webui/src/pages/Agents.tsx` — replace placeholder. Layout:
  - **Header row**: page title "Agents", agent dropdown picker (populated from `GET /api/agents`), "+ New Agent" button, "Delete" button.
  - **Tabs**: Overview, Files, Skills, Channels, Cron Jobs. Implemented using shadcn `Tabs` component.
  - Agent dropdown defaults to first agent in list. Changing dropdown fetches detail from `GET /api/agents/:id`.
  - Skills, Channels, Cron Jobs tabs show "Coming soon" placeholder.

Frontend — Overview tab (`webui/src/components/agents/OverviewTab.tsx`):
- [x] Editable form with TanStack Form (`useForm`). Fields: name, description, role (select), model + fallback (text inputs with Browse buttons), "Use default model/fallback" checkboxes. Save sends PATCH with only changed fields. Cancel reverts form.

Frontend — Files tab (`webui/src/components/agents/FilesTab.tsx`):
- [x] Fetches `GET /api/agents/:id/files` on mount to get file list with exists/missing status.
- [x] Renders sub-tabs for each known file: Soul, Heartbeat (and Workflow if agent role is manager). Files that don't exist show "MISSING" badge.
- [x] Per-file textarea editor with Save/Reset buttons. Save writes via `PUT /api/agents/:id/files/:filename`.
- [x] If file is missing, textarea starts empty. Saving creates the file on disk.

**Step 4b — Agent Config Editing, Creation & Deletion**

Mutating operations — convert read-only Overview tab to editable form, add create/delete, model picker.

Packages to install:
- `comment-json` (backend, in root `package.json`) — parses JSON with comments, preserves them through stringify. Used for safe read-modify-write of `openwren.json` without losing user comments.
- `@tanstack/react-form` (frontend, in `webui/package.json`) — form state management with dirty field tracking. Used across all form pages (agents, teams, config, schedules).

Backend — Config write utility (`src/config-writer.ts` — new file):
- [x] `readRawConfig()` — reads `openwren.json` with `comment-json`'s `parse()`. Returns the flat dot-notation object with comments preserved in symbols.
- [x] `writeConfigKeys(entries: Record<string, unknown>)` — reads raw config, sets each key (dot-notation, e.g. `"agents.atlas.model": "openai/gpt-4o"`), writes back with `comment-json`'s `stringify(obj, null, 2)`. Atomic: read → modify → write in one call.
- [x] `removeConfigKeys(keys: string[])` — reads raw config, deletes each key, writes back. Used when clearing a model override or deleting an agent.
- [x] All writes go to `path.join(config.workspaceDir, "openwren.json")`.

Backend — Hot reload (`src/config.ts`):
- [x] Refactor: extracted `parseConfig()` pure function from `loadConfig()`. `loadConfig()` calls `ensureWorkspace()` then `parseConfig()`.
- [x] `reloadConfig()` — exported function. Calls `parseConfig()`, then `Object.assign(config, freshConfig)`. All modules see updates immediately. Called after every config write (PATCH, POST, DELETE).

Backend — Agent CRUD routes (added to `src/gateway/routes/agents.ts`):
- [x] `PATCH /api/agents/:id` — accepts partial body: any subset of `{ name, description, role, model, fallback }`. Only writes provided fields as dot-notation keys. `null` or empty values remove the key (clears override). Calls `reloadConfig()`. Returns updated agent. 404 if not found.
- [x] `POST /api/agents` — accepts `{ id, name, description?, role?, model?, fallback? }`. Validates ID format. Writes dot-notation keys, calls `reloadConfig()`, creates on-disk structure (agent dir, soul.md stub, memory, workspace, sessions). 409 if exists.
- [x] `DELETE /api/agents/:id` — removes all `agents.{id}.*` keys. Calls `reloadConfig()`. Preserves files on disk. 400 if referenced in a team. 404 if not found.

Backend — Models endpoint (added to `src/gateway/routes/agents.ts`):
- [x] `GET /api/models` — returns `{ defaultModel, providers: Array<{ id, models[] }> }`. All supported providers listed. Ollama dynamic from local API. llmgateway is union of all. Free-text always allowed in frontend.

Frontend — Overview tab editable (`OverviewTab.tsx`):
- [x] Editable form using TanStack Form `useForm`. Fields: name, description, role (select), model + fallback (text inputs with Browse buttons).
- [x] "Use default model" and "Use default fallback" checkboxes. When checked: field disabled, shows `defaultModel`/`defaultFallback` as placeholder. Save sends `null` to clear override.
- [x] Save (PATCH with changed fields only) and Cancel buttons.

Frontend — Create Agent Dialog (`CreateAgentDialog.tsx`):
- [x] Modal with Agent ID (auto-slug from Name), Name, Description, Role, Model (use default checkbox + Browse). On submit: `POST /api/agents`. On success: close, refetch, auto-select. On 409: error.

Frontend — Delete Agent:
- [x] Delete button in page header. Confirmation dialog via shadcn `AlertDialog`. On confirm: `DELETE /api/agents/:id`. On success: refetch, select first. On 400 (team ref): error toast.

Frontend — Model Picker Dialog (`ModelPicker.tsx`):
- [x] Fetches `GET /api/models`, caches. Search filter, provider-grouped list, free-text input for unlisted models. On select: closes dialog, sets form field.

**Step 4c — Cron Jobs Tab (Agent Page)**

Enable the Cron Jobs tab on the Agents page. Read-only display of jobs assigned to the selected agent with enable/disable/run-now controls. Job creation/editing deferred to Step 7 (full Schedules page).

Backend:
- [x] No new endpoints — `GET /api/schedules` already returns all jobs with `agent` field. Frontend filters client-side. Enable/disable/run-now endpoints already exist.

Frontend — Types:
- [x] `webui/src/lib/types.ts` — expanded `ScheduleJob` type with `schedule` (cron/every/at), `channel`, `isolated` fields.

Frontend — Cron Jobs tab (`webui/src/components/agents/CronJobsTab.tsx` — new):
- [x] Fetches `GET /api/schedules`, filters to `job.agent === agentId`.
- [x] Card per job showing: name (bold), schedule badge (Every/Cron/At with icon), enabled/disabled badge (green/gray), isolated badge, next run time.
- [x] Per-job "Run Now" button + ••• dropdown menu with Enable/Disable toggle.
- [x] Click card to expand: shows prompt text, channel, and last 5 run history entries from `GET /api/schedules/:id/history` (timestamp, ok/error badge, duration, error message).
- [x] Empty state: "No scheduled jobs for {agentName}".
- [x] Tab enabled in `Agents.tsx`, wired with `agentId` and `agentName` props.

Agent Pause now and let user review progress so far...

**Step 4d — Skills Tab (Agent Page)**

Per-agent skill list with enable/disable toggles. Shows all skills that pass gates for the selected agent, with status indicators for blocked skills (missing binaries, config, etc.).

Per-agent skill overrides — stored as `agents.{id}.skills.{name}.enabled` in `openwren.json`. Smart write/delete: only store the key when per-agent choice differs from global. Delete when it matches (no stale keys). Precedence: per-agent override > global override (`skills.entries`) > frontmatter default.

Backend:
- [x] `AgentConfig` in `config.ts` — added optional `skills?: Record<string, { enabled?: boolean }>` field.
- [x] `passesGates()` in `skills.ts` — checks per-agent override before global `skills.entries` override. Per-agent `enabled: true` can re-enable a globally disabled skill for that agent.
- [x] `getSkillInventory()` in `skills.ts` — exported function that scans all skill directories, runs gate checks, returns `SkillInfo[]` with `enabled`, `blocked`, `blockReason`, `source` per skill.
- [x] `GET /api/agents/:id/skills` — returns `{ skills, total, enabled }` using `getSkillInventory()`.
- [x] `PATCH /api/agents/:id/skills` — accepts `{ entries: Record<string, { enabled: boolean }> }`. Smart logic: if toggle matches global state, deletes the per-agent key (clean). If differs, writes `agents.{id}.skills.{name}.enabled`. Calls `reloadConfig()`.
- [x] Binary cache TTL — `isBinaryAvailable()` cache now expires after 5 minutes so newly installed binaries are detected without restart.

Frontend:
- [x] `AgentSkill` and `AgentSkillsResponse` types in `types.ts`.
- [x] `SkillsTab.tsx` — card per skill with name, description, source badge, enable/disable toggle. Blocked skills dimmed with amber badge and reason. Search filter. Source filter badges (All / Bundled / Agent). Enable All / Disable All / Save buttons. Dirty tracking.
- [x] Tab enabled in `Agents.tsx`.

Agent Pause now and let user review progress so far...

**Step 4e — Channels Tab (Agent Page)**

Read-only display of messaging channels bound to this agent. Only shows channels with actual bindings in `config.bindings` (Telegram, Discord). WebSocket is not listed — it's a transport layer, not a per-agent channel binding.

Backend:
- [x] `GET /api/agents/:id/channels` — scans `config.bindings` for entries where this agent has a binding. Returns `{ channels: Array<{ name: string }> }`.

Frontend:
- [x] `AgentChannel` and `AgentChannelsResponse` types in `types.ts`.
- [x] `ChannelsTab.tsx` — card per channel with capitalized name, "Connected" badge, message icon. Empty state for agents with no bindings.
- [x] Tab enabled in `Agents.tsx`.

**Step 5 — Teams**

Manage agent teams — create, edit, delete. Teams define manager-worker delegation hierarchies. A team has one manager and N members. Roles are tied to team membership — they are assigned automatically and only meaningful while an agent is part of a team:

- **Assigned as manager** → role set to "manager" (grants delegation tools: create_workflow, delegate_task, etc.)
- **Added as member** → role set to "worker" (grants task tools: log_progress, complete_task, etc.)
- **Removed from all teams** → role cleared (no role = all tools available, backwards compatible)

Any agent can be picked as manager — no pre-filtering. Role assignment happens on save, not before.

Sub-manager behavior: if a manager from team Bravo is added as a **member** of team Alpha, they become a sub-manager. Their team (Bravo) becomes a sub-team — Bravo can't create independent workflows; only the top-level manager (Alpha's manager) creates workflows in the database. Sub-managers receive delegated tasks and can further sub-delegate to their own team members.

Files to read before starting:
- `src/config.ts` — TeamConfig, team helpers (getTeamsForAgent, canDelegateTo, getTeamMembers), validateTeams(), reloadConfig()
- `src/config-writer.ts` — writeConfigKeys(), removeConfigKeys()
- `src/gateway/server.ts` — route registration pattern
- `src/gateway/routes/agents.ts` — auth pattern, CRUD pattern, config-writer + reloadConfig usage
- `src/workspace.ts` — team directory creation on boot
- `src/tools/orchestrate.ts` — delegation flow, sub-manager behavior (understand, don't modify)
- `webui/src/pages/Agents.tsx` — page layout, tabs, dropdown, dialog wiring
- `webui/src/pages/Teams.tsx` — placeholder to replace
- `webui/src/lib/types.ts` — where to add team types
- `webui/src/lib/api.ts` — API client
- `webui/src/components/agents/CronJobsTab.tsx` — card layout pattern to match
- `webui/src/components/agents/SkillsTab.tsx` — card padding, badge styling reference
- `~/.openwren/openwren.json` — actual team entries (teams.alpha.*, teams.editing.*)

Backend (`src/gateway/routes/teams.ts` — new file):
- [x] `GET /api/teams` — returns all teams with `displayName`, manager `{ id, name }`, members `Array<{ id, name }>`. Resolves agent names from config for display.
- [x] `GET /api/teams/:name` — single team detail. Same shape as list item. 404 if not found.
- [x] `POST /api/teams` — create new team. Accepts `{ name, displayName?, managerId, memberIds }`. Validates: name format, not duplicate, manager/members exist, manager not in members. Writes config keys + auto-sets roles. Creates team directory. Calls `reloadConfig()`.
- [x] `PATCH /api/teams/:name` — update team. Accepts partial `{ displayName?, managerId?, memberIds? }`. Same validations. Auto-manages roles on manager/member changes (clears roles for agents removed from all teams). Calls `reloadConfig()`.
- [x] `DELETE /api/teams/:name` — delete team. Removes `teams.{name}.*` keys. Clears roles for agents no longer in any team. Preserves `teams/{name}/` directory on disk. Calls `reloadConfig()`.
- [x] Register in `src/gateway/server.ts`.

Frontend — Types:
- [x] Add `Team` (with `displayName`), `TeamMember`, `TeamListResponse` to `types.ts`.

Packages installed:
- [x] `slugify` (webui) — international character transliteration for team ID generation (ö→o, ä→a, å→a, etc.)
- [x] `shadcn checkbox` + `label` components

Frontend — Teams page (`webui/src/pages/Teams.tsx` — rewrite placeholder):
Follow the same design patterns established on the Agents page — cards, badges, spacing (`space-y-3`), button styles, dialog patterns. Consistent look across all management pages.

Two tabs: **Teams** (default) and **Hierarchy**.

Teams tab:
- [x] Card per team showing: display name, manager (crown icon) + all members as badges in one row, edit + delete icon buttons.
- [x] "+ New Team" button → opens Create Team dialog.
- [x] Click team card or edit icon → opens Edit Team dialog (same dialog, pre-filled).
- [x] Delete button per team card → confirmation dialog with role cleanup warning.

Hierarchy tab:
- [x] Nested cards showing the full organizational tree. Top-level teams rendered as cards with manager name and member list. Sub-teams (where a member is also a manager of another team) rendered as indented nested cards below. No graph library — pure CSS indentation with existing Card components.
- [x] Read-only visualization — editing happens on the Teams tab.
- [x] Sub-manager detection — members who manage other teams shown with "sub-manager" amber badge.

Frontend — Team Dialog (`webui/src/components/teams/TeamDialog.tsx` — new):
- [x] Shared dialog for create and edit modes.
- [x] Fields: Display Name (editable in both modes), ID shown below (auto-slug in create, read-only in edit), Manager (dropdown of ALL agents), Members (shadcn Checkbox list excluding selected manager).
- [x] Auto-slug via `slugify` package — international character support (ö→o, ä→a, å→a, ñ→n, etc.), underscores as separator.
- [x] Create: `POST /api/teams`, Edit: `PATCH /api/teams/:name`.
- [x] On success: close dialog, refetch team list.


**Step 6 — Config**

Editor for `~/.openwren/openwren.json`. Two modes: **Form** (structured sections with proper inputs) and **Raw** (code editor showing the actual file with comments). The Config page manages settings NOT covered by Agents or Teams pages — those pages already handle their own CRUD.

Scope — what the Config page manages:
- Default model + fallback
- Provider API keys (masked display, editable)
- Channel settings (unauthorized behavior, rate limits)
- Bindings (agent ↔ channel mappings)
- Gateway settings (WS token — masked)
- Search provider configuration
- Scheduler settings (enabled, log/session retention)
- Heartbeat settings (enabled, interval, active hours)
- Session settings (idle reset, daily reset time)
- Agent loop tuning (max iterations, compaction threshold)
- Skills (global enable/disable, extra load dirs)
- Timezone
- Roles (manager/worker tool permission lists)

NOT managed here (owned by other pages): agents.*, teams.*

Files to read before starting:
- `src/config.ts` — Config interface, defaultConfig, parseConfig(), reloadConfig()
- `src/config-writer.ts` — readRawConfig(), writeConfigKeys(), removeConfigKeys()
- `src/gateway/routes/agents.ts` — auth pattern, route registration pattern
- `webui/src/pages/Teams.tsx` — page layout pattern (tabs, cards)
- `webui/src/components/agents/OverviewTab.tsx` — form pattern (inputs, selects, save/cancel)
- `webui/src/lib/api.ts` — API client
- `webui/src/lib/types.ts` — where to add types
- `~/.openwren/openwren.json` — actual config file with comments and sections

Backend (`src/gateway/routes/config.ts` — new file):
- [x] `GET /api/config` — returns the full flat config object from `readRawConfig()`. Sensitive fields (provider API keys, gateway.wsToken, binding credentials) returned as masked strings (e.g. `"sk-...abc"` — first 3 + last 3 chars, or `"••••••"` if shorter than 8). Also returns a `_meta.sensitiveKeys` array listing which keys are masked so the frontend knows not to send them back unchanged. Also returns `defaults` (flattened `defaultConfig` minus agents/teams/users/bindings/workspaceDir) so the form can show effective values for keys not explicitly set in the user's file.
- [x] `GET /api/config/raw` — returns the raw file content as a string. Implemented but currently not wired to the UI (Raw tab hidden — see below).
- [x] `PATCH /api/config` — accepts `{ set: Record<string, unknown>, remove: string[] }`. Calls `writeConfigKeys(set)` and `removeConfigKeys(remove)`. Skips any key in `set` whose value matches the masked placeholder (so unchanged secrets aren't overwritten with mask text). Calls `reloadConfig()`. Returns updated config (same shape as GET, including `defaults`).
- [x] `PUT /api/config/raw` — implemented, validates JSON5 before writing. Not wired to UI yet.
- [x] `POST /api/config/provider` — new endpoint not in original spec. Adds a provider end-to-end: appends `ENV_VAR=value` to `~/.openwren/.env` and writes `providers.{id}.apiKey: "${env:ENV_VAR}"` to `openwren.json`. For Ollama, writes `baseUrl` directly. Calls `reloadConfig()`.
- [x] Auth: same Bearer token pattern as other route files.
- [x] Register in `src/gateway/server.ts`.

Frontend — Types:
- [x] Added `ConfigResponse`, `ConfigRawResponse` types to `types.ts`.

Frontend — Config page (`webui/src/pages/Config.tsx`):
Originally Form + Raw tabs. Raw tab is **hidden** for now (code retained behind `{false && ...}` gate for future re-enable). Tabs UI removed — page goes straight to the form.

Form — collapsible sections:
- [x] **Model Defaults** — `defaultModel` + `defaultFallback` text inputs with Browse buttons opening `ModelPicker`. The `/api/models` endpoint was updated to only return providers with a configured API key (plus Ollama if its local API responds).
- [x] **Providers** — one row per configured provider. Masked password input with eye toggle. Ollama shows its `baseUrl`. "Add provider" button opens `AddProviderDialog` — modal with provider picker, API key input, and a live preview showing `.env -> OPENAI_API_KEY=...` and `config -> providers.openai.apiKey: "${env:OPENAI_API_KEY}"`. Submitting writes both files.
- [x] **Search** — provider select (brave, zenserp, searxng shown but only brave is implemented in backend), API key masked input for selected provider.
- [x] **Gateway** — WS token masked input with warning text.
- [x] **Scheduler** — enabled toggle, logRetention, sessionRetention inputs.
- [x] **Heartbeat** — enabled toggle, interval, active hours start/end. Fields disabled when enabled=false.
- [x] **Session** — idleResetMinutes, dailyResetTime inputs.
- [x] **Agent Loop** — maxIterations, compaction toggle, contextWindowTokens, thresholdPercent.
- [x] **Channel Settings** — unauthorizedBehavior select, rateLimit maxMessages + windowSeconds.
- [x] **Timezone** — text input with auto-detected default as placeholder.
- [x] Collapsible Cards; all start collapsed except Model Defaults.
- [x] Global Save + Cancel buttons at top and bottom of form. Save sends PATCH with dirty-detection diff; shows success/warn toast (amber for changes needing restart).
- [ ] **Bindings** — deferred. Channel/agent/credential mapping table not implemented. Telegram/Discord tokens currently only editable via openwren.json directly.
- [ ] **Skills** — deferred. Global skill entries and extra load dirs not implemented.
- [~] **Roles** — section was implemented then hidden (commented out) because exposing role permission editing to users is dangerous (tool allowlist footgun). Rework in Step 6.a — role/permissions become fully derived from team membership, not user-editable at all.

Raw tab (deferred):
- [~] Full-file code editor, Save/Revert buttons, JSON5 validation. Code exists but is not rendered (behind `{false && ...}`). Re-enable when we have a proper code editor (syntax highlighting, line numbers).

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
- [ ] **Hierarchy graph visualization** — replace nested cards on Teams → Hierarchy tab with interactive graph using `react-organizational-chart` (or React Flow). Nodes are clickable React components (open agent detail modal on click). Tree structure data already built via `buildHierarchy()` in Teams.tsx.
