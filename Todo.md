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

## Left to do Phases

----- If I ASK YOU TO INSERT NEW PHASE INSERT AFTER THIS LINE ------


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