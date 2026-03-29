# Open Wren

A self-hosted personal AI assistant bot you control via messaging apps. Runs locally, connects to Anthropic Claude, and acts on your behalf — reading files, running whitelisted shell commands, maintaining persistent memory across sessions.

Multiple agents with distinct personalities (Atlas, Einstein, Wizard, Coach). Each agent gets its own bot per channel, isolated conversation history, and a plain-text soul file you can edit without touching code.

---

## Features

- **Multi-agent** — run several AI personalities simultaneously, each with its own soul file and session history
- **Multi-channel** — Telegram, Discord (DM-only), and WebSocket for CLI/Web UI
- **Persistent memory** — agents save facts to markdown files that survive session resets and restarts
- **Session compaction** — long conversations are summarized automatically; originals are archived
- **Persistent shell approval** — approve shell commands once per agent, stored in `exec-approvals.json`
- **CLI management** — start, stop, restart, tail logs, and chat interactively from your terminal
- **Scheduled tasks** — cron jobs, interval timers, and one-shot reminders. Agents can create schedules on your behalf
- **Heartbeat** — periodic agent check-ins with smart suppression (silent when nothing to report)
- **Zero code changes to add agents** — create a soul file and add config keys, that's it

---

## Prerequisites

- **Node.js 22+**
- **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com)
- **Telegram bot token** — create a bot via [@BotFather](https://t.me/BotFather) on Telegram
- *(Optional)* **Discord bot token** — create an app at [discord.com/developers](https://discord.com/developers/applications)

---

## Install & Setup

```sh
npm install -g openwren
openwren init
```

This creates `~/.openwren/` with template config and `.env` files. Then:

**1. Add your secrets to `~/.openwren/.env`:**

```sh
ANTHROPIC_API_KEY=sk-ant-...
OWNER_TELEGRAM_ID=123456789        # your Telegram numeric user ID
TELEGRAM_BOT_TOKEN=123:ABC...      # from BotFather
```

**2. Edit `~/.openwren/openwren.json`:**

```json5
{
  "providers.anthropic.apiKey": "${env:ANTHROPIC_API_KEY}",
  "users.owner.displayName": "Your Name",
  "users.owner.channelIds.telegram": "${env:OWNER_TELEGRAM_ID}",
  "bindings.telegram.atlas": "${env:TELEGRAM_BOT_TOKEN}",
}
```

**3. Start the bot:**

```sh
openwren start
```

Message your Telegram bot — Atlas responds.

---

## CLI Commands

| Command | What it does |
|---|---|
| `openwren init` | Create `~/.openwren/` with template config, `.env`, and default Atlas soul file |
| `openwren start` | Start the bot as a background daemon |
| `openwren stop` | Stop the daemon |
| `openwren restart` | Stop + start |
| `openwren status` | Show agents, channels, and uptime |
| `openwren logs` | Tail the daemon log file |
| `openwren chat [agent]` | Interactive terminal chat via WebSocket |

For development, run in the foreground instead:

```sh
npm run dev
```

---

## Configuration

All config lives in `~/.openwren/`:

```
~/.openwren/
├── openwren.json     # User config — safe to share publicly
├── .env              # Secrets — never share this
├── agents/
│   └── atlas/
│       ├── soul.md   # Atlas personality and instructions
│       └── skills/   # Per-agent skills (Atlas only)
├── skills/           # Global skills (all agents)
├── memory/           # Persistent memory files
└── sessions/         # Conversation history (per user, per agent)
```

`openwren.json` uses **JSON5** (comments and trailing commas allowed) with **flat dot-notation keys**:

```json5
{
  // Model selection — "provider/model" format
  "defaultModel": "anthropic/claude-sonnet-4-6",
  "defaultFallback": "anthropic/claude-haiku-4-5",

  // Per-agent model override
  "agents.einstein.model": "anthropic/claude-opus-4-6",

  // Timezone for session timestamps
  "timezone": "America/New_York",

  // WebSocket token for CLI chat and status commands
  "gateway.wsToken": "${env:WS_TOKEN}",

  // Web search (Brave, Zenserp, SearXNG, etc.)
  "search.provider": "brave",
  "search.brave.apiKey": "${env:SEARCH_API_KEY}",
}
```

Secrets are never written directly into `openwren.json`. Use `${env:VAR_NAME}` — the value is resolved from `~/.openwren/.env` at startup.

---

## Adding Agents

No code changes required. Create a soul file and add bindings:

**1. Create `~/.openwren/agents/wizard/soul.md`:**

```markdown
You are Wizard, a wise and mystical assistant who speaks with ancient wisdom.
You enjoy using metaphors and occasionally reference arcane knowledge.
```

**2. Add to `openwren.json`:**

```json5
{
  "bindings.telegram.wizard": "${env:WIZARD_TELEGRAM_TOKEN}",
}
```

**3. Add `WIZARD_TELEGRAM_TOKEN` to `.env` and restart.**

That's it. Wizard now has his own Telegram bot, isolated session history, and shared access to the memory and tool system.

---

## Skills

Skills are markdown files that teach agents when and how to use capabilities. They use a two-stage loading model — the agent sees a lightweight catalog at session start and loads full instructions on demand.

**Bundled skills** ship with Open Wren:

| Skill | Type | Gate |
|---|---|---|
| `memory-management` | autoloaded | none |
| `file-operations` | autoloaded | none |
| `web-search` | on-demand | `search.provider` config key |
| `web-fetch` | on-demand | none |
| `agent-browser` | on-demand | `agent-browser` binary |

**Autoloaded** skills inject into every prompt automatically. **On-demand** skills appear in a catalog — the agent calls `load_skill` to activate them when relevant.

### Custom skills

Create a `SKILL.md` in any of these locations:

```
~/.openwren/skills/my-skill/SKILL.md              # global — all agents see it
~/.openwren/agents/atlas/skills/my-skill/SKILL.md  # per-agent — only Atlas
```

**SKILL.md format:**

```markdown
---
name: my-skill
description: What this skill does and when to use it.
---

Instructions the agent receives when it activates this skill.
```

Optional frontmatter fields: `autoload: true` (inject into every prompt), `requires.env: [VAR_NAME, ...]` (env vars that must be set), `requires.bins: [binary, ...]` (binaries that must be on PATH), `requires.config: [key.path, ...]` (config keys that must be set), `requires.os: darwin|linux|win32`, `enabled: false`.

### Skills config

```json5
{
  // Only allow specific bundled skills (omit to allow all):
  "skills.allowBundled": ["memory-management", "file-operations"],

  // Disable a specific skill:
  "skills.entries.web-fetch.enabled": false,

  // Load skills from additional directories:
  "skills.load.extraDirs": ["~/my-shared-skills"],
}
```

Per-agent skills override global skills with the same name. Global skills override bundled skills.

---

## Web Research

Agents can search the web and fetch URLs. Search uses a provider abstraction — swap backends via config without changing code.

### Search setup (Brave)

1. Get a free API key at [brave.com/search/api](https://brave.com/search/api) (2,000 queries/month free)
2. Add the key to `~/.openwren/.env`:
   ```
   SEARCH_API_KEY=your_key_here
   ```
3. Enable in `~/.openwren/openwren.json`:
   ```json5
   {
     "search.provider": "brave",
     "search.brave.apiKey": "${env:SEARCH_API_KEY}",
   }
   ```

The `web-search` skill activates automatically when `search.provider` is set. Agents get a `search_web` tool for live web searches.

### Fetch

The `fetch_url` tool is always available — no config needed. Agents can fetch any URL, and the content is extracted using readability (navigation, ads, and sidebars are stripped). Results are truncated to ~40K characters to prevent context window overflow.

### Browser (optional)

For pages that need JavaScript rendering, install [agent-browser](https://github.com/nickarellano/agent-browser) and it becomes available via the `agent-browser` skill. Agents control it through shell commands (`agent-browser open`, `snapshot`, `click`, `fill`, `scroll`).

---

## Scheduled Tasks

Agents can run tasks on a schedule — morning briefings, recurring reminders, one-shot alerts. Three schedule types:

- **Cron** — `0 8 * * 1-5` (weekdays at 8am), `0 */2 * * *` (every 2 hours)
- **Interval** — `30m`, `2h`, `1d` (simple repeating timer)
- **One-shot** — `2026-03-15T09:00:00` (fires once, auto-disables)

Create schedules three ways:
- **Ask your agent** — "remind me to drink water every 2 hours"
- **CLI** — `openwren schedule create` (interactive prompts)
- **REST API** — `POST /api/schedules` (for automation)

Manage via CLI: `openwren schedule list`, `enable`, `disable`, `delete`, `run`, `history`.

### Heartbeat

A periodic check-in where agents read a checklist and only message you if something matters. Create `~/.openwren/agents/atlas/heartbeat.md` with your checklist, then enable in config:

```json5
{
  "heartbeat.enabled": true,
  "heartbeat.every": "30m",
  "heartbeat.activeHours.start": "08:00",
  "heartbeat.activeHours.end": "22:00",
}
```

If the agent has nothing to report, it stays silent (HEARTBEAT_OK suppression).

---

## Teams & Workflows

Agents can form teams with manager-worker relationships. A manager agent creates a full DAG (directed acyclic graph) of tasks with declared dependencies, then a deterministic orchestrator executes it — no LLM involved in dependency resolution or scheduling.

**How it works:**

1. You tell your manager agent (e.g. Atlas) to run a workflow — "Run the daily project report"
2. Atlas reads its `workflow.md`, creates all tasks with dependencies in one shot, then goes idle
3. The orchestrator resolves dependencies, runs tasks in parallel where possible, and handles failures
4. Workers execute in isolated task sessions — your conversation with Atlas stays clean
5. When done, Atlas delivers a summary back to your channel

**Key features:**

- **DAG-first** — the entire task graph is planned upfront, then executed mechanically. No LLM in the loop for scheduling
- **Multi-level hierarchy** — a mid-level manager (both worker and manager) creates its own sub-DAG when its task starts. Sub-DAGs roll up into the parent workflow
- **Parallel execution** — independent tasks run concurrently. Dependent tasks wait until their prerequisites complete
- **Shared team folders** — all team members write deliverables to `~/.openwren/teams/{team}/{workflow-slug}/`
- **Tool profiles** — managers get delegation tools, workers get execution tools (shell, files, fetch, search). Enforced at the tool level, not just in the prompt
- **SQLite state** — all workflow and task state lives in `~/.openwren/data/workflows.db` via Drizzle ORM

**Config example:**

```json5
{
  // Define a team
  "teams.alpha.manager": "atlas",
  "teams.alpha.members": ["researcher", "analyst", "writer", "editor"],

  // Agent roles and descriptions (shown to managers via system prompt)
  "agents.researcher.description": "Gathers information and produces research summaries",
  "agents.researcher.role": "worker",
  "agents.editor.description": "Reviews and polishes written content",
  "agents.editor.role": "worker",
}
```

Each team member needs a `soul.md` in `~/.openwren/agents/{name}/`. Managers also get a `workflow.md` that describes their orchestration logic — what tasks to create, in what order, with what dependencies.

---

## Security

Open Wren treats all inbound web content as potentially adversarial. Three layers of defense protect agents from prompt injection:

1. **Pattern detection** — known jailbreak phrases ("ignore previous instructions", "you are now a", etc.) are detected and blocked before reaching the LLM. Suspicious but ambiguous patterns are logged for review but not blocked.

2. **Untrusted content delimiters** — all web content (fetched pages, search snippets) is wrapped in `[BEGIN UNTRUSTED WEB CONTENT]...[END UNTRUSTED WEB CONTENT]` markers, priming the LLM to treat embedded instructions with skepticism.

3. **LLM judgment** — Claude is trained to recognize injection attempts. Combined with the untrusted delimiters, even novel injection attempts that bypass pattern detection are reliably rejected.

Additional security measures:
- Gateway binds to `127.0.0.1` only — not exposed to the network
- WebSocket auth via constant-time token comparison
- File operations sandboxed to the workspace directory
- Shell commands restricted to a whitelist (agents can call `list_shell_commands` to see what's allowed)
- All secrets stay in `~/.openwren/.env`, never in config files

---

## Discord Setup

Before running a Discord bot, enable **Message Content Intent** in the Discord Developer Portal:

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Select your app → **Bot**
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**
4. Save

Without this, the bot receives no message text.

Add the bot token to your config:

```json5
{
  "bindings.discord.atlas": "${env:DISCORD_BOT_TOKEN}",
}
```

Discord bots respond to DMs only.

---

## License

MIT © Nermin Bajagilovic / Reimagined Works AB
