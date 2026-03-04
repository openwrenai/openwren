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
│       └── soul.md   # Atlas personality and instructions
├── memory/           # Persistent memory files
└── sessions/         # Conversation history (per user, per agent)
```

`openwren.json` uses **JSON5** (comments and trailing commas allowed) with **flat dot-notation keys**:

```json5
{
  // Model selection — "provider/model" format
  "defaultModel": "anthropic/claude-sonnet-4-6",
  "defaultFallback": "anthropic/claude-haiku-3-5",

  // Per-agent model override
  "agents.einstein.model": "anthropic/claude-opus-4-6",

  // Timezone for session timestamps
  "timezone": "America/New_York",

  // WebSocket token for CLI chat and status commands
  "gateway.wsToken": "${env:WS_TOKEN}",
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

MIT © Nermin Bajagilovic
