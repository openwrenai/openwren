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

### Phase 9.5 — AI SDK Provider Integration

The project currently has two LLM providers — Anthropic (native) and Ollama (translates to/from OpenAI-compatible format). Adding more providers (Google Gemini, OpenAI, Mistral, etc.) means writing a new translation layer each time. The Vercel AI SDK (`ai` package v6) provides a universal interface across 25+ providers. We integrate it as another provider behind our existing `LLMProvider` interface — same pattern as Ollama. No changes to session format, agent loop, or architecture.

The AI SDK becomes a translation-layer provider: our Anthropic-shaped messages go in, get translated to AI SDK's `ModelMessage` format, call `generateText()`, and the response gets translated back to our `LLMResponse`. Existing session JSONL files, the agent loop, tools, channels — nothing changes.

**Step 1: Install dependencies**
- [x] `npm install ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google @ai-sdk/mistral @ai-sdk/groq @ai-sdk/xai @ai-sdk/deepseek`
- [x] `@ai-sdk/openai` covers Ollama too (OpenAI-compatible base URL)

**Step 2: Create `src/providers/ai-sdk.ts`**
- [x] New class `AiSdkProvider implements LLMProvider`
- [x] Constructor takes `provider` string, `model` string, and `creds` object (API key, base URL — resolved from config by the factory, not read from process.env)
- [x] Model resolution: map provider name → AI SDK provider factory, passing credentials explicitly:
  - `"anthropic"` → `createAnthropic({ apiKey })`
  - `"openai"` → `createOpenAI({ apiKey })`
  - `"google"` → `createGoogle({ apiKey })`
  - `"mistral"` → `createMistral({ apiKey })`
  - `"groq"` → `createGroq({ apiKey })`
  - `"xai"` → `createXai({ apiKey })`
  - `"deepseek"` → `createDeepSeek({ apiKey })`
  - `"ollama"` → `createOpenAI({ baseURL: ollamaBaseUrl + "/v1", apiKey: "ollama" })` — Ollama exposes an OpenAI-compatible endpoint at `/v1`, dummy API key required by the SDK
- [x] `translateMessages()` — convert our `Message[]` to AI SDK `CoreMessage[]`. Field mapping:
  - Our `{ role: "assistant", content: [{ type: "tool_use", id, name, input }] }` → AI SDK `{ role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: name, args: input }] }`
  - Our `{ role: "user", content: [{ type: "tool_result", tool_use_id, content }] }` → AI SDK `{ role: "tool", content: [{ type: "tool-result", toolCallId: tool_use_id, result: content }] }`
  - Our `{ role: "user"|"assistant", content: "text" }` → AI SDK `{ role: "user"|"assistant", content: "text" }` (pass through)
  - Our `{ role: "user"|"assistant", content: [{ type: "text", text }] }` → AI SDK `{ role: "user"|"assistant", content: [{ type: "text", text }] }` (pass through)
  - Reference: `ollama.ts` `translateMessages()` for the same pattern with a different target format
- [x] `translateTools()` — convert our `ToolDefinition[]` to AI SDK format using `jsonSchema()` helper (no Zod needed)
- [x] `translateResponse()` — convert AI SDK result back to our `LLMResponse`: check `result.toolCalls.length > 0` → `{ type: "tool_use", toolCalls }`, else `{ type: "text", text: result.text }`. Also extract `result.usage` → `{ inputTokens, outputTokens }` onto the response (free from AI SDK — avoids touching LLMResponse again in Phase 9.6)
- [x] Error handling: wrap in try/catch, return `{ type: "error", error }` (never throw)
- [x] `chat()` — uses `generateText()` (non-streaming). Returns full `LLMResponse` as today.
- [x] `chatStream()` — uses `streamText()`, returns `AsyncIterable<string>` (text deltas). Only called by interactive channels and Phase 10 WebUI — the agent loop keeps using `chat()`.

**Step 3: Add provider config + generalize validation**
- [x] Add `openai: { apiKey }`, `google: { apiKey }`, `mistral: { apiKey }`, `groq: { apiKey }`, `xai: { apiKey }`, `deepseek: { apiKey }` to `providers` in config type
- [x] Add defaults (empty API keys for all)
- [x] Generalize API key validation — replace the current Anthropic-only check (`config.ts:538-545`) with a loop: collect all provider names referenced in `defaultModel`, `defaultFallback`, and every `agents.*.model` / `agents.*.fallback` chain. For each provider that isn't `"ollama"` (no key needed), verify `providers[name].apiKey` is set. This replaces the hardcoded `usesAnthropic` check.
- [x] API keys passed explicitly via `create*({ apiKey })` factories — the SDK never reads `process.env` directly. Keys flow through the existing `~/.openwren/.env` → `${env:VAR}` → config pipeline.
- [x] Update `src/templates/openwren.json` — add commented-out lines for new provider credentials
- [x] Update `src/templates/env.template` — add commented-out env var placeholders for each new provider key

**Step 4: Wire into provider factory**
- [x] Route ALL providers through AI SDK — replace the switch in `createProviderFromSpec()` with: resolve credentials from `config.providers[spec.provider]`, then `return new AiSdkProvider(spec.provider, spec.model, creds)`. All 7 providers + Ollama go through the same path.
- [x] Add `chatStream?()` to `LLMProvider` interface as optional method — only `AiSdkProvider` implements it. Callers check `if ('chatStream' in provider)` before using.
- [x] Add `usage?: { inputTokens: number; outputTokens: number }` to `LLMResponse` — populated by `AiSdkProvider.translateResponse()` from AI SDK's `result.usage`. Phase 9.6 Step 1 becomes zero work.
- [x] Native `anthropic.ts` and `ollama.ts` files stay in the codebase (not deleted, just unused) — can be removed later when confident
- [x] ProviderChain, fallback logic, agent config — all work unchanged

**Step 5: Adopt AI SDK session format**

Switch internal message types from Anthropic's format to AI SDK's format. Eliminates the translation layer in `ai-sdk.ts` — messages flow directly from session to `generateText()`. Delete existing session files (project is in beta, no backwards compatibility needed).

- [x] Update `MessageContent` type in `src/providers/index.ts` — replaced flat interface with three discriminated union types (`TextContent`, `ToolCallContent`, `ToolResultContent`) matching AI SDK's `TextPart`, `ToolCallPart`, `ToolResultPart` exactly
- [x] Update `Message` role — added `role: "tool"` for tool results (AI SDK uses `role: "tool"` instead of stuffing results into `role: "user"`)
- [x] Update `src/agent/loop.ts` — tool call and tool result block construction uses new field names and `output: { type: "text", value }` structure
- [x] Update `src/agent/history.ts` — `estimateTokensContent()` uses discriminated type checks (`block.type === "text"` etc.) to access the correct fields
- [x] Delete `translateMessages()` from `src/providers/ai-sdk.ts` — messages now pass directly as `ModelMessage[]`
- [x] Delete all existing session files (`~/.openwren/sessions/`)
- [x] `npx tsc --noEmit` + `npm run build` pass
- [x] Verify: send a message, confirm tool calls work end-to-end with new format — tested chat + tool calls (save_memory, memory_search) via Telegram, and a full multi-agent workflow with delegation, blocking deps, and auto-completion

**What changed and why:** The old `MessageContent` was a single flat interface with optional fields for all three block types (`text`, `tool_use`, `tool_result`) using Anthropic's naming (`id`, `name`, `input`, `tool_use_id`, `content`). This required a ~70-line `translateMessages()` function in `ai-sdk.ts` to convert between our format and the AI SDK's format on every LLM call.

The new format uses three discriminated union types (`TextContent`, `ToolCallContent`, `ToolResultContent`) that mirror the AI SDK's `TextPart`, `ToolCallPart`, `ToolResultPart` exactly — same field names, same structure. Tool results use `output: { type: "text", value: string }` (not a plain string) and live in `role: "tool"` messages (not `role: "user"`). This means messages pass directly from session JSONL → `generateText()` with a `as ModelMessage[]` cast and no runtime translation. The `translateMessages()` function was deleted entirely.

The `MessageContent` type went from a loose bag of optional fields to properly typed discriminated unions, which gives TypeScript narrowing on `block.type` checks — no more `!` assertions on fields that might not exist.

**Step 6: Add LLM Gateway support**

llmgateway.io is a unified LLM gateway — one API key, 25+ providers. It has a native AI SDK provider package (`@llmgateway/ai-sdk-provider`) that exports `createLLMGateway()`. Model IDs are raw names (`claude-sonnet-4-6`, `gpt-5.4-mini`) — the gateway resolves the actual provider internally.

Implementation notes:
- `createProviderFromSpec()` in `src/providers/index.ts` is a 2-liner that passes `config.providers[spec.provider]` to `AiSdkProvider` — no changes needed there, llmgateway flows through automatically as long as config has `llmgateway: { apiKey }`
- The change goes in `resolveModel()` inside `src/providers/ai-sdk.ts` — add `case "llmgateway"` to the switch, import `createLLMGateway` from `@llmgateway/ai-sdk-provider`, call `createLLMGateway({ apiKey: this.creds.apiKey })(this.model)`
- No baseURL handling needed (unlike ollama) — the package handles routing internally

- [x] `npm install @llmgateway/ai-sdk-provider`
- [x] Add `import { createLLMGateway } from "@llmgateway/ai-sdk-provider"` to `src/providers/ai-sdk.ts`
- [x] Add `case "llmgateway": return createLLMGateway({ apiKey: this.creds.apiKey })(this.model)` to `resolveModel()` switch in `src/providers/ai-sdk.ts`
- [x] Add `llmgateway: { apiKey: string }` to `providers` in config type (`src/config.ts`) + add default (empty apiKey)
- [x] Validation already works — the generalized API key check loops all providers in the chain and verifies `providers[name].apiKey` is set. No new validation code needed, just ensure `llmgateway` is in the config type.
- [x] Update `src/templates/openwren.json` — add `// "providers.llmgateway.apiKey": "${env:LLM_GATEWAY_API_KEY}",`
- [x] Update `src/templates/env.template` — add `# LLM_GATEWAY_API_KEY=llmgtwy_...`
- [x] Test: `"defaultModel": "llmgateway/claude-haiku-4-5"` — verified chat + tool use (save_memory) works through the gateway
- [x] Test: `"defaultModel": "llmgateway/gpt-5.4-mini"` — verified chat + tool use (save_memory) through OpenAI via gateway
- [ ] Test: `"defaultModel": "llmgateway/gemini-2.5-flash"` — verify Google Gemini through the gateway
- [x] Test: `"defaultModel": "llmgateway/deepseek-v3.1"` — verified chat + tool use (save_memory) through DeepSeek via gateway
- [ ] Test: `"defaultModel": "llmgateway/mistral-large-latest"` — verify Mistral through the gateway

**Step 7: Test**
- [x] Config: `"defaultModel": "anthropic/claude-sonnet-4-6"` — verify Anthropic works through AI SDK (same config, different plumbing)
- [ ] Config: `"defaultModel": "google/gemini-2.5-flash"` or `"openai/gpt-5.4-mini"` — verify chat works via AI SDK
- [ ] Config: `"defaultModel": "ollama/llama3.2"` — verify Ollama works through AI SDK
- [ ] Test tool use: ask agent to read a file — verify tool call/result round-trip
- [ ] Test fallback: mixed chain (e.g., `"google/gemini-2.5-flash, anthropic/claude-haiku-4-5"`) — both go through AI SDK
- [ ] Test streaming: interactive channel gets streamed response

**Design decisions:**
- All providers route through AI SDK — one translation layer, one code path. Native provider files kept but unused.
- No Zod — AI SDK's `jsonSchema()` helper accepts raw JSON Schema, which we already use
- Streaming via `chatStream()` (Option A) — `chat()` stays non-streaming (agent loop), `chatStream()` added as optional method for interactive callers (channels, Phase 10 WebUI)
- Token usage added to `LLMResponse` now — AI SDK returns it for free, saves touching the interface again in Phase 9.6
- No `maxTokens` config — omit it from `generateText()` calls and let each provider/model use its own default
- LLM Gateway is just another AI SDK provider — uses `@llmgateway/ai-sdk-provider` package, no special gateway/routing abstraction needed

**What does NOT change:** Session JSONL format, agent loop, `Message` / `MessageContent` / `ToolDefinition` / `ToolCall` types, channels, scheduler, orchestrator, skills, CLI, gateway.

---

### Phase 9.6 — Token Tracking

Track real token usage across everything — chat, workflows, jobs, notifications. File-based approach: daily JSONL logs as source of truth + accumulated summary for instant dashboard reads. No database — keeps the architecture simple.

**IMPORTANT: Read `docs/Tokens.md` before starting.** It contains the full design — file formats, summary structure, resilience strategy, recording point, and implementation notes. Everything you need is there.

**Step 1: Provider interface** — ALREADY DONE (Phase 9.5)
- [x] `usage: { inputTokens, outputTokens }` already on `LLMResponse` (Phase 9.5 Step 4)
- [x] `AiSdkProvider.translateResponse()` already populates usage from AI SDK's `result.usage`
- [x] AI SDK normalizes token counts across all providers — no per-provider extraction logic needed

**Step 2: Usage file layer**

Create `src/usage/` module with two files:
- Daily JSONL log: `~/.openwren/usage/YYYY-MM-DD.jsonl` — append-only, one line per loop run
- Accumulated summary: `~/.openwren/usage/summary.json` — running totals, updated atomically per run

- [x] Create `src/usage/index.ts`:
  - `recordUsage(entry)` — appends line to today's daily file + updates summary.json
  - `loadSummary()` — reads summary.json (for dashboards, CLI)
  - `rebuildSummary()` — scans all daily files and regenerates summary.json (resilience — called on startup if summary is missing/corrupt)
- [x] Daily log line format: `{ ts, agent, provider, model, in, out, source, sourceId, workflowId, userId, sessionId }`
- [x] Summary format: `{ days: { "YYYY-MM-DD": { in, out } }, byAgent: { ... }, byProvider: { ... }, bySession: { ... } }`
- [x] Atomic summary writes — read → update counters → write whole file
- [x] Ensure `~/.openwren/usage/` directory is created if missing
- [ ] Optional: configurable retention — prune daily files older than N days, drop stale entries from summary

**Step 3: Recording in agent loop**
- [x] Accumulate token counts across all ReAct iterations in `runAgentLoop()` — sum `response.usage.inputTokens` / `response.usage.outputTokens` from each LLM call
- [x] Extract provider and model from `provider.name` (format `"provider/model"` — split on `/`)
- [x] Call `recordUsage()` when the loop finishes
- [x] Pass source context: `{ source, sourceId, workflowId, userId, sessionId }` via `RunLoopOptions`
- [x] Add `usage?: { inputTokens: number; outputTokens: number }` to `LoopResult` — so channels/WebUI can display per-turn token counts in real-time without reading files

**Step 4: Wire up callers**
- [x] Channel adapters — set `source: "chat"`, `userId`, `sessionId`
- [x] Orchestrator runner — set `source: "task"`, `sourceId: task.slug`, `workflowId`
- [x] Scheduler runner — set `source: "job"`, `sourceId: jobId`
- [x] Notify — set `source: "notify"`, `workflowId`
- [x] Update scheduler runner to use real token counts from `LoopResult.usage` instead of `Math.ceil(rawText.length / 4)` estimate

**Step 5: Query API**
- [x] `GET /api/usage` — reads summary.json, returns totals with optional filters (date range, agent, model, provider, source)
- [x] `GET /api/usage/detail?date=2026-03-31` — reads daily JSONL file, returns per-run entries for drill-down
- [x] Wire into `src/gateway/routes/`

**Step 6: CLI**
- [x] `openwren usage` — show today's token usage summary (reads summary.json)
- [x] `openwren usage --agent atlas --days 7` — per-agent breakdown from summary

---

### Phase 9.7 — Prompt Caching (Anthropic)

Optimize token costs by enabling Anthropic's prompt caching. System prompt + tool definitions + conversation history are largely static between ReAct iterations — caching them reduces input token costs to 0.1x on cache hits (vs 1.25x on cache writes). Anthropic-specific — other providers unaffected.

- [ ] Add `cache_control: { type: "ephemeral" }` via AI SDK's `providerOptions.anthropic.cacheControl` on `generateText()` / `streamText()` calls
- [ ] Only apply when provider is `"anthropic"` — other providers ignore it
- [ ] Verify cache hits in Anthropic dashboard / response headers
- [ ] Consider marking system prompt + tool definitions as cacheable (stable across iterations) vs conversation tail (changes each turn)
- [ ] Minimum cacheable size: 1,024 tokens (Sonnet), 4,096 tokens (Haiku 4.5 / Opus) — skip caching for very short prompts

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
- [x] Chat interface — send messages via WS with `sessionId`, stream responses token-by-token, thinking indicator
- [x] Session header — session title and agent name shown at top of chat area
- [ ] Lazy session creation — "New Chat" shows a blank centered chat (like Claude.ai) without creating a file. Session is only created after first message is sent and agent replies. Agent auto-names the session.
- [ ] Two-state chat input — **Fresh chat:** textarea centered vertically+horizontally on screen, auto-focused, agent picker inside the input area (bottom-right, like Claude.ai's model picker). **Active chat:** textarea pinned to bottom of screen, agent picker hidden (agent locked for session), messages above.
- [ ] Auto-growing textarea — textarea expands upward as user adds lines with Shift+Enter. Works in both centered (fresh) and bottom-pinned (active) states. In active state, growing textarea shrinks the message area above it. No fixed height limit.
- [ ] Session history loading — load conversation transcript from session JSONL when selecting an existing session
- [ ] Clean up ghost sessions — delete empty session files created by the eager "New Chat" approach
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