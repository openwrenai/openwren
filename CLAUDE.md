# Open Wren — Personal AI Agent Bot

## Rules for Claude

- **Never run git commands unless explicitly asked to commit or push.** Editing files is fine; touching git is not unless the user says so.
- **Always briefly summarize what you're about to do before prompting the user for permission.** One or two sentences max — what files, what change, why.
- **Never add `Co-Authored-By` or contributor lines to commit messages.**
- **Commit message format:** Subject line is `Phase X.Y: short title` (no conventional commits prefix like `feat:` or `fix:`). Body bullet-points what changed and why.

## Overview

A self-hosted personal AI assistant bot controlled via messaging channels (Telegram, Discord, with WhatsApp planned). Runs as a local Node.js gateway with WebSocket support, connects to an LLM backend (Anthropic Claude or Ollama), and can execute tasks on your behalf — reading/writing files, running whitelisted shell commands, persistent memory across sessions.

Multiple agents with distinct personalities (Atlas, Einstein, Wizard, Coach). Agents are decoupled from channels — bindings connect agents to channels with credentials.

---

## Configuration

All defaults live in code (`defaultConfig` in `config.ts`). User overrides go in `~/.openwren/openwren.json` — a JSON5 file with flat dot-notation keys. Secrets reference env vars via `${env:VAR}` syntax, resolved from `~/.openwren/.env`.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js (v22+), TypeScript |
| Messaging: Telegram | grammY (`grammy`) — modern Telegram Bot API wrapper |
| Messaging: Discord | discord.js (`discord.js`) — DM-only, one bot per agent, Message Content Intent required |
| HTTP/WS | Fastify + `@fastify/websocket` — HTTP server with WebSocket upgrade for CLI/Web UI |
| LLM: Cloud | Anthropic SDK (`@anthropic-ai/sdk`) — per-agent model selection with cascading fallbacks |
| LLM: Local | Ollama REST API (Phase 7) |
| Config | JSON5 (`json5`) — `~/.openwren/openwren.json` with dot-notation keys |
| Env | `dotenv` — secrets in `~/.openwren/.env` |
| Database | SQLite (`better-sqlite3`) + Drizzle ORM (`drizzle-orm`) — orchestrator workflow state |

Core dependencies: `@anthropic-ai/sdk`, `grammy`, `discord.js`, `fastify`, `@fastify/websocket`, `dotenv`, `json5`, `better-sqlite3`, `drizzle-orm`. Dev: `drizzle-kit` (migration generation).

---

## Build

Project uses **tsup** (esbuild-based) for compilation, not raw `tsc`. Package type is `"module"` (ESM).

| Command | What it does |
|---|---|
| `npm run build` | `tsup` → copies `src/templates/`, `src/skills/`, and `drizzle/` into `dist/` (runtime assets) |
| `npm run typecheck` | `tsc` (type-check only, `noEmit: true`) |
| `npm run dev` | `tsx src/index.ts` — runs directly, no build step |
| `npm run cli -- <cmd>` | `tsx src/cli.ts` — CLI commands during dev |

> **Important:** Run `npx tsc --noEmit` (no file args) for type-checking — passing individual files bypasses `tsconfig.json` settings.

---

## Notes for Claude Code

- Nothing reads `process.env` directly (except `PORT` for the gateway and `OPENWREN_HOME` for workspace path override)
- Run `npx tsc --noEmit` (no file args) for type-checking — passing individual files bypasses `tsconfig.json` settings
- Versioning: CalVer `YYYY.M.D` (date-based). Same-day hotfixes: `YYYY.M.D-1`. **Version bump procedure:** update `package.json` first, then `npm install --package-lock-only` to sync lock file
- `quiet` flag on `buildSkillCatalog()` suppresses per-skill log lines — used by scheduler and orchestrator runners to avoid log spam on frequent/parallel runs

> **For implementation details on all subsystems — see `ARCHITECTURE.md` and source code.**

