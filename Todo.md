## Phases

### Phase 1 — Project Setup + Core Agent (no messaging yet)

The goal of Phase 1 is a working agent you can test entirely in the terminal before wiring up any messaging channel.

- [x] Init Node.js project with TypeScript (`tsconfig.json`, `package.json`)
- [x] Install core dependencies: `@anthropic-ai/sdk`, `grammy`, `fastify`, `dotenv`
- [x] `config.ts` — load and validate `.env` + `config.json`
- [x] Create workspace directory structure at `~/.bot-workspace/` with `sessions/`, `memory/` subdirs
- [x] Write initial `~/.bot-workspace/SOUL.md` — agent personality and memory instructions
- [x] `providers/anthropic.ts` — implement `LLMProvider` interface against Anthropic API
- [x] `agent/prompt.ts` — load SOUL.md from disk into system prompt on every call
- [x] `agent/history.ts` — JSONL session persistence (append-only, one message per line, keyed by session name)
- [x] `agent/loop.ts` — implement ReAct loop, test it with a hardcoded message in a scratch script
- [x] `tools/shell.ts` — implement whitelisted shell executor, test independently
- [x] `tools/filesystem.ts` — implement sandboxed read/write, test independently
- [x] `tools/memory.ts` — implement `save_memory` and `memory_search` tools
- [x] `tools/index.ts` — tool registry, wire all tools into the agent loop
- [x] End of Phase 1: run `npx ts-node src/scratch.ts` and have a working agent conversation in terminal with persistent history and memory

### Phase 2 — Telegram Channel

Wire the working agent into Telegram. At this point the brain already works, so this phase is purely plumbing.

- [x] Create bot via `@BotFather`, get token, add to `.env`
- [x] `channels/telegram.ts` — grammY bot setup, receive messages, call agent loop, send reply
- [x] Save owner chat ID to disk on first message (so proactive messages work later)
- [x] Whitelist check — reject messages from any sender ID not in `config.allowedUserIds`
- [x] Confirmation flow — handle YES/NO replies for pending destructive commands. Also implement `exec-approvals.json` — stored at `~/.bot-workspace/exec-approvals.json`, a list of shell commands the user has permanently approved (answered "yes, always"). Once a command is in this file it is never asked about again. Checked before prompting the user for confirmation — if the command is already approved, execute silently.
- [x] `gateway/server.ts` — Fastify server, set up Telegram webhook or polling
- [x] `src/index.ts` — wire everything together, start gateway + bot
- [x] **Session locking** — per-session mutex in `history.ts` to prevent race conditions when simultaneous messages arrive (implemented in phase 1 actually)
- [x] **Rate limiting** — per-sender sliding window rate limiter in `channels/telegram.ts`. Tracks message timestamps per sender in memory, drops messages silently if a sender exceeds the configured limit. Configurable via `config.json` (`telegram.rateLimit.maxMessages` and `telegram.rateLimit.windowSeconds`). Applied before the whitelist check so even unknown senders can't flood the process.
- [x] **Context compaction** — add compaction check at the top of every agent turn (estimate tokens, summarize old half if over threshold, overwrite session file)
- [x] **Compaction improvements** — (1) replace `JSON.stringify` token estimator with content-only extraction (walk `MessageContent[]`, pull out `text`, `input`, `content` fields) to avoid over-counting JSON scaffolding by ~17%; (2) compact 100% of messages into a single `role:user` summary — no messages kept verbatim. Anthropic merges the summary with the next incoming user message automatically. Confirmed via Anthropic docs: consecutive user messages are valid and get merged.
- [x] **Compaction notifications** — (1) warning at `thresholdPercent - 5`% (e.g. 75%): notify user context is getting full; (2) after compaction: notify user session was compacted; (3) overflow rejection: if session + new message exceeds 100% of context window, reject the message and tell user to send something shorter. Return status flags from loop, channel layer sends the notifications.
- [x] End of Phase 2: chat with your bot from Telegram on your phone, history persists across restarts

### Phase 3 — Multi-Agent Routing

Add support for multiple agents with different personalities, each with their own soul file and isolated conversation history. All agents share the same tool registry and memory directory.

**How it works:** Each agent is defined in `config.json` with a name, session prefix, and optional trigger prefix. The soul is always loaded from `~/.bot-workspace/agents/{agent-id}/soul.md` — derived from the agent ID, never stored in config. Incoming messages are checked against all configured trigger prefixes — a match routes to that agent and strips the prefix before passing the message to the loop. If no prefix matches, the default agent handles it.

**Config structure:**

```json
{
  "agents": {
    "main": {
      "name": "Jarvis",
      "sessionPrefix": "agent:main"
    },
    "einstein": {
      "name": "Einstein",
      "sessionPrefix": "agent:einstein",
      "triggerPrefix": "/einstein"
    },
    "personal_trainer": {
      "name": "Coach",
      "sessionPrefix": "agent:personal_trainer",
      "triggerPrefix": "/coach"
    }
  },
  "defaultAgent": "main"
}
```

Note there is no `soulFile` field — the soul path is always derived from the agent ID: `~/.bot-workspace/agents/{agent-id}/soul.md`. Keeping it implicit means one less thing to misconfigure.

**Session isolation:** Each agent gets its own session file keyed by its `sessionPrefix`. Jarvis and Scout never share conversation history. Their sessions compact independently. But they read from and write to the same `memory/` directory — Scout can save research findings that Jarvis can retrieve later via `memory_search`.

**Memory key convention:** Instruct each agent in its soul file to prefix memory keys with its own name (e.g. `scout-python-async`, `jarvis-user-prefs`). This avoids collisions and makes it clear which agent wrote what. Not enforced technically — just a convention in the soul file instructions.

**Agent name in replies:** The channel layer prepends the agent name to every reply: `[Scout] Here's what I found...`. This makes it obvious which personality is responding, especially useful when switching between agents in the same Telegram conversation. Done in `telegram.ts`, not in the agent loop.

**Implementation checklist:**

- [ ] Create `~/.bot-workspace/agents/` directory with one subdirectory per agent, each containing `soul.md`
- [ ] Update `config.json` schema to support `agents` map and `defaultAgent` (no `soulFile` field — path derived from agent ID)
- [ ] `agent/router.ts` — parse incoming message text, match against `triggerPrefix` fields, return `{ agentConfig, strippedMessage }`. Falls back to `defaultAgent` if no prefix matches
- [ ] Update `agent/prompt.ts` — accept agent config, load soul from `~/.bot-workspace/agents/{agent-id}/soul.md`
- [ ] Update `agent/loop.ts` — accept resolved agent config, use `sessionPrefix` as session key, load correct soul
- [ ] Update `channels/telegram.ts` — call router before agent loop, prepend agent name to reply
- [ ] Write initial soul files: at minimum `agents/main/soul.md` (general assistant) and one specialist agent to validate routing works
- [ ] **Per-agent exec approvals** — update `exec-approvals.json` to key approvals by agent ID (e.g. `{ "main": ["mkdir ..."], "einstein": [] }`). Update `isApproved(agentId, command)` and `permanentlyApprove(agentId, command)` in `tools/approvals.ts`. Pass `agentId` through the confirm callback in `telegram.ts`. This ensures "always" approvals granted to one agent don't automatically apply to others.
- [ ] End of Phase 3: `/research what is ReAct prompting?` routes to Scout with her own history; plain messages go to Jarvis; both can find each other's memory

**Example interaction:**

```
You: What's the weather like today?
[Jarvis] I don't have live weather access, but I can check if you give me your city.

You: /research Best practices for TypeScript error handling
[Scout] On it — searching now...
[Scout] Here's what I found: [uses web_search, saves findings to memory as scout-ts-errors]

You: What did Scout find about TypeScript?
[Jarvis] [uses memory_search for "typescript"]
[Jarvis] Scout found that the key practices are: using Result types, avoiding raw try/catch...
```

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