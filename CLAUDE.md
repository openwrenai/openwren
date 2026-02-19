# Personal AI Agent Bot — Project Description

## Rules for Claude

- **Never run git commands unless explicitly asked to commit or push.** Editing files is fine; touching git is not unless the user says so.
- **Always briefly summarize what you're about to do before prompting the user for permission.** One or two sentences max — what files, what change, why.
- **Never add `Co-Authored-By` or contributor lines to commit messages.**

## Overview

A self-hosted personal AI assistant bot that you control via Telegram. It runs as a local Node.js gateway on your machine or a VPS, connects to an LLM backend, and can execute tasks on your behalf — reading/writing files, running whitelisted shell commands, and more.

The project is built to be **model-agnostic from day one**, starting with Anthropic's Claude API and adding Ollama support for fully local, offline, privacy-first operation.

---

## Goals

- Chat with your bot from Telegram as if texting a very capable assistant
- The bot can read/write files and run safe shell commands on your behalf
- Switch between cloud (Anthropic) and local (Ollama) models with a config change
- Keep it simple, readable, and hackable — no magic, no framework bloat

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js (v22+) | Async I/O, huge ecosystem |
| Language | TypeScript | Type safety, better DX for tool definitions |
| Messaging | grammY (`grammy`) | Modern Telegram Bot API wrapper, better TS support than Telegraf, actively maintained, used by OpenClaw |
| HTTP | Fastify | Lightweight internal API/webhook server |
| LLM: Cloud | Anthropic SDK (`@anthropic-ai/sdk`) | Claude Sonnet/Opus via official SDK |
| LLM: Local | Ollama REST API | OpenAI-compatible, just a different base URL |
| Web search | Brave Search API | Cheap, no Google dependency (Phase 5) |
| Web fetch | node-fetch + `@mozilla/readability` | Strip HTML, return clean article text (Phase 5) |
| Config | .env + JSON config file | Simple, no over-engineering |

---

## Architecture

```
You (Telegram)
        │
        ▼
  ┌─────────────────────────────┐
  │        Gateway (Fastify)    │  ← webhook receiver, auth, routing
  └────────────┬────────────────┘
               │
        ┌──────▼──────┐
        │  Agent Loop  │  ← conversation history, tool orchestration
        └──────┬───────┘
               │
       ┌───────▼────────┐
       │  LLM Provider  │  ← Anthropic API  OR  Ollama (switchable)
       └───────┬────────┘
               │  tool_use response
       ┌───────▼────────┐
       │  Tool Executor │
       └───────┬────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
shell_exec  read_file  write_file
(whitelist) (sandboxed) (sandboxed)
```

---

## Workspace Directory

The bot uses a workspace directory (`~/.bot-workspace/`) to persist everything that needs to survive restarts. Created on first run if it doesn't exist.

```
~/.bot-workspace/
├── sessions/
│   ├── agent:main.jsonl              # Jarvis conversation history
│   └── agent:researcher.jsonl        # Scout conversation history (separate per agent)
├── memory/
│   ├── jarvis-user-prefs.md          # Saved via save_memory (agents prefix keys by convention)
│   └── scout-python-async.md         # Scout's research findings, readable by all agents
├── agents/
│   ├── main/
│   │   └── soul.md                   # Jarvis personality and instructions
│   ├── einstein/
│   │   └── soul.md                   # Einstein personality and instructions
│   └── personal_trainer/
│       └── soul.md                   # Personal trainer personality and instructions
└── exec-approvals.json               # Shell commands approved once, never asked again
```

Each agent lives in its own directory under `agents/`. Right now that directory only contains `soul.md`, but the structure is intentionally open-ended — you can drop additional files into an agent's directory later without restructuring anything. Per-agent tool configs, few-shot examples, private context files — whatever an agent needs, it goes in its folder.

The agent ID in `config.json` is the directory name. Loading a soul is always `~/.bot-workspace/agents/{agent-id}/soul.md`. No lookup table, no special cases.

**Sessions** are ephemeral and lossy by design — they compact over time. **Memory files** are the permanent record — they survive session resets, restarts, and compaction. Anything the bot needs to remember forever goes in memory, not the session.

---

## Project Structure

```
/
├── src/
│   ├── index.ts               # Entry point, starts gateway + bot
│   ├── gateway/
│   │   └── server.ts          # Fastify server, webhook handling
│   ├── channels/
│   │   └── telegram.ts        # grammY bot setup, message routing, chat ID storage
│   ├── agent/
│   │   ├── loop.ts            # Core ReAct loop (think → tool → think → respond)
│   │   ├── history.ts         # JSONL session persistence, compaction, session locking
│   │   ├── router.ts          # Parses message prefix, resolves which agent handles it
│   │   └── prompt.ts          # Loads soul file for the resolved agent into system prompt
│   ├── providers/
│   │   ├── index.ts           # Provider interface + factory
│   │   ├── anthropic.ts       # Anthropic Claude implementation
│   │   └── ollama.ts          # Ollama implementation (OpenAI-compatible)
│   ├── tools/
│   │   ├── index.ts           # Tool registry, definitions, executor
│   │   ├── shell.ts           # Whitelisted shell command runner
│   │   ├── filesystem.ts      # Safe file read/write operations
│   │   └── memory.ts          # save_memory and memory_search tools
│   └── config.ts              # Config loader, validation
├── .env.example
├── config.json                # Agent definitions, routing, provider config
├── package.json
├── tsconfig.json
└── PROJECT.md
```

---

## Provider Interface

Both Anthropic and Ollama implement the same interface, so the agent loop never needs to know which backend it's talking to:

```typescript
interface LLMProvider {
  chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse>;
  name: string;
}
```

**Switching providers** is a single line in `config.json`:

```json
{
  "provider": "anthropic",   // or "ollama"
  "ollama": {
    "model": "llama3.2",
    "baseUrl": "http://localhost:11434"
  },
  "anthropic": {
    "model": "claude-sonnet-4-6"
  }
}
```

---

## Telegram Setup — How It Works

**No phone number required.** Telegram has an official Bot API designed exactly for this use case.

Setup steps (one time only):
1. Open Telegram and search for `@BotFather`
2. Send `/newbot`, give it a name, get back a token like `7123456789:AAFxxxxxxxx`
3. Put the token in `.env` as `TELEGRAM_BOT_TOKEN`
4. Start a conversation with your bot in Telegram (search for it by username, hit Start)
5. The gateway saves your **chat ID** (a permanent number like `123456789`) to disk

From this point on, both directions work:
- You message the bot → gateway receives it, runs agent loop, replies
- Bot messages you proactively (scheduled tasks, etc.) → gateway calls `bot.api.sendMessage(CHAT_ID, "...")` at any time

**Important:** Telegram bots cannot initiate a conversation — the user must send the first message. After that first message, the bot can reply freely at any time, including hours or days later from a cron job. The chat ID never changes and the token never expires.

**Security:** Store your own Telegram user ID in config (`telegram.allowedUserIds: [123456789]`) and reject all messages from any other sender ID immediately at the channel layer, before they ever reach the agent loop.

### grammY — Why Not Telegraf

Both are community wrappers around Telegram's official Bot API. grammY (`grammy` on npm) is the more modern choice — better TypeScript support, cleaner API, more actively maintained. It is also the library OpenClaw uses. Telegraf is older and more widely known but grammY has largely superseded it for new projects.

```typescript
import { Bot } from "grammy";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

bot.on("message:text", async (ctx) => {
  const response = await agentLoop(ctx.message.text, ctx.from.id);
  await ctx.reply(response);
});

// Proactive message (e.g. from a cron job):
await bot.api.sendMessage(OWNER_CHAT_ID, "Good morning, here's your summary...");

bot.start();
```

---

## Session Management

### Storage Format

Sessions are stored as **JSONL files** (one JSON message per line, append-only) in `~/.bot-workspace/sessions/`. This format is crash-safe — a partial write only corrupts the last line, not the whole file. On startup the file is read line-by-line, any malformed trailing line is discarded.

```
{"role":"user","content":"hi my name is John"}
{"role":"assistant","content":"Hi John! How can I help?"}
{"role":"user","content":"I prefer dark mode"}
```

For a single-user personal bot, one session file (`main.jsonl`) is all you need. All conversations flow into the same history regardless of which device or channel you message from.

### Session Locking

If two messages arrive simultaneously (e.g. Telegram and a cron job both fire at the same second), both try to read→modify→write the same session file. This causes a race condition where one write silently overwrites the other.

Fix: a per-session **mutex lock** (`Map<sessionKey, Lock>`) in `history.ts`. Any agent turn that wants to use a session must acquire the lock first and release it when done. A few lines of code, prevents data corruption entirely.

### Context Compaction

Sessions grow forever. After weeks of chatting, the total token count of the JSONL file exceeds the model's context window and the API call fails.

Fix: **compaction** — summarize old messages and replace them with the summary, keeping only recent messages in full. This happens transparently before every agent turn.

**Algorithm:**

1. Load session file into memory
2. Estimate token count (character length ÷ 4 is a good enough approximation — exact tokenizer counts add latency for negligible benefit)
3. If below threshold (e.g. 100k tokens, ~80% of a 128k window), continue normally
4. If above threshold:
   - Split messages in half — `old` and `recent`
   - Call the LLM to summarize `old` into a concise paragraph (preserve: key facts about the user, decisions made, open tasks)
   - Replace `old` with a single synthetic message: `[Previous conversation summary]\n...`
   - Overwrite the session file with `[summary message] + recent`
5. Continue with the (now smaller) session

**What compaction is not:** it does not start a new session. The conversation continues uninterrupted. The user never sees it happen. From the bot's perspective, the session file simply has fewer entries now.

**What compaction loses:** the verbatim early messages are gone forever. The summary captures key facts but not exact wording. This is why the memory system exists — anything worth keeping permanently should be written to a memory file, not left in the session.

**Threshold:** trigger at ~80% of the model's context window, not at 100%. You need headroom for the system prompt, tool definitions, tool results, and the LLM's response itself.

### Session Reset (Optional)

By default sessions never reset — they just compact. But you can configure an idle-based reset:

```json
{
  "session": {
    "idleResetMinutes": 240
  }
}
```

If the last message was more than 240 minutes ago, treat the next message as a fresh session. This is sensible for a daily-driver bot where you want morning conversations to start clean without manually typing `/reset`.

---

## Memory System

Sessions are designed to be ephemeral. Memory is designed to be permanent. They serve different purposes.

### How It Works

Two tools the agent can call at any time:

**`save_memory(key, content)`** — writes `content` to `~/.bot-workspace/memory/{key}.md`. Overwrites if the key already exists (so the agent can update a memory by saving to the same key). Use for facts that should survive session resets: user preferences, project details, recurring tasks, anything the agent might need weeks from now.

**`memory_search(query)`** — scans all `.md` files in the memory directory and returns files whose content contains any word from the query. Simple keyword matching. Returns filename + full content for each match.

This is the same pattern OpenClaw uses. Their production version uses vector embeddings for semantic search (so "auth bug" matches "authentication issues") — keyword search is the right starting point and works well in practice.

### When the Agent Uses These

The SOUL instructs the agent to:
- Run `memory_search` at the start of any conversation that seems to reference past context ("my project", "that thing we discussed", etc.)
- Run `save_memory` whenever the user shares a preference, key fact, or anything they'd be annoyed to repeat next session

The agent decides autonomously when memory is worth saving. This is intentional — you don't want a rigid rule like "save everything" flooding the memory directory with noise.

### Relationship to Compaction

Compaction is lossy. Memory is not. Before compaction runs, the agent should ideally have already saved anything critical to memory files. OpenClaw does an explicit **pre-compaction memory flush** — a silent internal turn telling the agent "you're about to lose detailed context, write anything important to memory now." This is a Phase 2+ refinement; for Phase 1, rely on the agent's own judgment during normal conversation.

### Soul Files

Each agent's personality and behavioral instructions live at `~/.bot-workspace/agents/{agent-id}/soul.md`. Loaded on every API call as the system prompt for that agent. Never cache — the user should be able to edit a soul file and see the change on the next message without restarting anything.

The agent ID in `config.json` is the directory name, so the path is always deterministic: `agents/main/soul.md`, `agents/einstein/soul.md`, `agents/personal_trainer/soul.md`. No lookup table needed.

```markdown
# Who You Are
You are Jarvis, a personal AI assistant...

## Memory
You have a persistent memory system.
- Use save_memory to store important facts, preferences, and context worth keeping across sessions.
- Use memory_search at the start of conversations to recall relevant context from previous sessions.
- Memory files persist forever — session history does not.
- Prefix your memory keys with your name (e.g. jarvis-user-prefs) to avoid collisions with other agents.
```

The `agents/{id}/` directory is intentionally open-ended. Right now it only contains `soul.md`, but you can add other files later — per-agent tool configs, few-shot examples, private context — without changing the directory structure.

---

## Tool Definitions

### Memory

Two tools for long-term persistence across sessions:

**`save_memory(key, content)`** — writes a markdown file to `~/.bot-workspace/memory/{key}.md`. Agent uses this to remember user preferences, project context, recurring tasks, anything that shouldn't be lost when a session resets or compacts.

**`memory_search(query)`** — keyword search across all memory files. Returns filename and full content for every file that contains any word from the query. Simple but effective for a personal bot with a modest number of memory files.

The agent is instructed in SOUL.md to use these proactively — saving facts as they come up in conversation, not waiting to be asked.

### Shell (whitelisted)

One generic `shell_exec` tool — the LLM already knows all terminal commands from training and writes them into the `command` field. No need to enumerate individual commands as separate tools. The whitelist is enforced server-side by parsing the command string before execution.

Allowed commands (no `rm`, no `sudo`):

```
ls, find, cat, head, tail, grep, wc, awk, sed, sort, uniq, jq
mkdir, touch, cp, mv
git status, git log, git diff, git pull, git add, git commit, git push
npm run, npx, node
curl (GET only), ping, df, du, ps, lsof
date, echo, which
```

Destructive commands (mv to outside sandbox, cp overwrite, etc.) require a **confirmation step** — the gateway holds the pending command in memory, bot asks you to reply YES/NO, then executes or discards. This is stateful — the channel layer must track that a confirmation is pending for a given chat ID.

### Read / Write File

Safe wrappers — all paths are validated and sandboxed to a configured working directory. Write operations require confirmation before execution.

---

## Agent Loop (ReAct Pattern)

```
1. Receive user message
2. Append to conversation history (keyed by sender ID)
3. Call LLM with history + tool definitions
4. If response is plain text → send to user, done
5. If response is tool_use:
     a. Check if command requires confirmation
     b. If yes → ask user YES/NO, hold pending command, wait for reply
     c. If no (or confirmed) → execute tool
     d. Append tool_result to history
     e. Go to step 3
```

Max iterations capped (e.g. 10) to prevent infinite loops. If cap is hit, send a message to the user explaining the agent got stuck.

---

## Notes for Claude Code

- Prefer **explicit over clever** — this codebase should be readable at a glance
- Keep the agent loop in one file (`loop.ts`) so the control flow is obvious
- Tool definitions and their executor functions should live together — don't split them across files
- The provider abstraction is the most important seam — keep it clean, everything else depends on it
- **Shell tool** — implement as one generic `shell_exec` tool with a `command: string` parameter. The whitelist is a server-side check on the command string, not separate tool definitions per command
- **Confirmation flow** — this is stateful. The channel layer (`telegram.ts`) must maintain a `pendingConfirmations: Map<chatId, PendingCommand>` so that when a YES/NO reply arrives it knows what to execute or discard. Don't make the agent loop aware of this — it belongs in the channel layer
- **Multi-agent routing** — the router (`agent/router.ts`) is the only place that knows about agent configs. It returns a resolved agent object to the channel layer. The agent loop receives this object and never knows how routing happened. Keep this separation clean
- **Agent name in replies** — prepend `[AgentName]` to every reply in `telegram.ts`, not in the loop. The loop is channel-agnostic and shouldn't know it's being displayed in Telegram
- **Soul files** — load from `~/.bot-workspace/agents/{agent-id}/soul.md` on every API call. Path is always derived from the agent ID, never stored in config. Never cache in memory — user should be able to edit and see the change immediately without restarting
- **Memory key namespacing** — instruct each agent in its soul file to prefix memory keys with its own name (`einstein-physics`, `jarvis-prefs`). Not enforced in code, just a convention written into each soul file. Prevents agents overwriting each other's memory
- **Adding a new agent** — should require zero code changes. Only: create `~/.bot-workspace/agents/{id}/soul.md`, add an entry to `config.json`. If adding an agent ever requires touching TypeScript, the abstraction is wrong. The `agents/{id}/` directory is intentionally open-ended — future per-agent files (tool configs, examples, private context) go there without restructuring
- **Future: one bot per agent** — the owner has expressed a desire to eventually run each agent as its own dedicated Telegram bot with its own token, rather than routing by prefix command. The architecture should be built with this in mind. The agent loop, soul loading, session management, and tool registry are already agent-agnostic. When this upgrade happens, the channel layer (`telegram.ts`) will be instantiated once per agent with a hardcoded agent config instead of running the router. No changes to `loop.ts`, `history.ts`, `tools/`, or `providers/` will be needed. Keep this seam clean — do not let agent identity leak into the loop or tool layer
- **SOUL.md** — load from `~/.bot-workspace/souls/{agent-id}.md` on every API call. Do not cache it in memory — the user should be able to edit it and see changes immediately without restarting the bot
- **JSONL sessions** — read on load (line by line, skip malformed lines), append on each new message. Never rewrite the whole file on every turn (expensive). Only rewrite when compaction runs
- **Session locking** — use a `Map<sessionKey, Promise>` mutex. Each turn chains on the previous promise for that session key. A few lines, prevents all race conditions
- **Compaction token estimate** — character count of `JSON.stringify(messages)` divided by 4. Do not call the tokenizer API per turn. Good enough approximation, fast, zero dependencies. Trigger at 80% of model context window
- **Memory tools** — `save_memory` overwrites the whole file for a given key. This is correct — the agent updates a memory by saving to the same key with new content. `memory_search` is a simple keyword scan: split query on spaces, check if any word appears in the file content. Not case-sensitive
- **Cron session keys** — any scheduled task must use its own session key (e.g. `cron:morning-briefing`), not the main user session. Otherwise cron job output appears in your conversation history
- **grammY** — use `grammy` (not `telegraf`). Import: `import { Bot } from "grammy"`. For proactive messages use `bot.api.sendMessage(chatId, text)`. Use long polling (`bot.start()`) during development, switch to webhooks for production deployment
- **Chat ID persistence** — save the owner's Telegram chat ID to a local JSON file on first message. This is needed for proactive/scheduled messages. Don't hardcode it
- For Ollama tool_use: test with `qwen3:8b` or `llama3.2` first — best function calling support among open-source models. Smaller models may need the XML fallback
- Token budgeting matters in Phase 5 — web page content must be truncated before being fed back into context, especially with smaller Ollama models
- Core dependencies for Phase 1+2: `@anthropic-ai/sdk`, `grammy`, `fastify`, `dotenv`. That's it. Don't add dependencies you don't need

---

## Security Reminders

- Never run as root
- Bind gateway to `127.0.0.1`, not `0.0.0.0`
- Whitelist Telegram user IDs in config — reject all other senders immediately at the channel layer before touching the agent loop
- Treat all inbound content (web pages, search results) as potentially adversarial — prompt injection is an unsolved problem
- Never expose `ANTHROPIC_API_KEY` or other secrets through the `env` tool or shell
- Sandbox all file operations to a configured working directory — validate and resolve paths before any read/write
- For WhatsApp (Phase 6): only ever install `@whiskeysockets/baileys` — never install forks or similarly named packages

