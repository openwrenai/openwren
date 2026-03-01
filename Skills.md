# Open Wren — Skills System

Compatible with the [Agent Skills specification](https://agentskills.io/specification). Our frontmatter is a superset — we add `requires` gates and `enabled`, the spec's optional fields (`license`, `compatibility`, `metadata`, `allowed-tools`) are supported too.

## What Skills Are

Skills are markdown files that teach an agent *when and how* to use a capability. Not code — just instructions that get loaded on demand when the agent decides it needs them.

Skills are separate from tools. A **tool** is the TypeScript function that actually runs (`search_web` in `tools/search.ts`). A **skill** is the markdown that teaches the agent to use it effectively. Currently, tool knowledge is hardcoded into default soul files — skills replace that with a proper, manageable system.

---

## Directory Structure

```
~/.openwren/
├── skills/                              ← global, visible to all agents
│   └── brave-search/
│       ├── SKILL.md
│       ├── scripts/                     ← optional executable scripts
│       ├── references/                  ← optional detailed docs (loaded on demand)
│       └── assets/                      ← optional static resources (templates, schemas)
└── agents/
    └── einstein/
        ├── soul.md
        └── skills/                      ← per-agent, Einstein only
            └── physics-notation/
                └── SKILL.md
```

Bundled skills ship with the project and are loaded from code — they don't live in `~/.openwren/` but are always available as the lowest-priority fallback.

**Precedence (highest → lowest):**
1. Per-agent skills: `~/.openwren/agents/{agentId}/skills/`
2. Global skills: `~/.openwren/skills/`
3. Bundled skills: shipped with Open Wren

If the same skill name exists in two places, the more specific one wins.

---

## SKILL.md Format

Each skill is a folder containing one `SKILL.md` file with YAML frontmatter and freeform markdown instructions.

```markdown
---
name: brave-search
description: Search the web using Brave Search API. Use when the user asks about current events, recent news, or anything that benefits from a live web search.
requires:
  env: [BRAVE_API_KEY]
---

You have access to a `search_web` tool.

Always cite your sources by including the URL in your response.
Prefer 2-3 focused searches over one broad query.
```

### Frontmatter fields

**Required (Agent Skills spec):**

| Field | Description |
|---|---|
| `name` | Unique identifier, must match folder name. Lowercase + hyphens only, max 64 chars. No leading/trailing/consecutive hyphens. |
| `description` | What the skill does and when to use it, max 1024 chars. This is what the agent sees in the catalog to decide whether to activate the skill — make it specific. |

**Optional (Agent Skills spec):**

| Field | Description |
|---|---|
| `license` | License name or reference to bundled license file (e.g. `Apache-2.0`) |
| `compatibility` | Environment requirements as text (e.g. `Requires git, docker, and internet access`). Max 500 chars. Informational only — not enforced. |
| `metadata` | Arbitrary key-value pairs (e.g. `author: example-org`, `version: "1.0"`) |
| `allowed-tools` | Space-delimited list of pre-approved tools the skill may use. Experimental. |

**Open Wren extensions (our additions):**

| Field | Description |
|---|---|
| `requires.env` | List of env vars that must be set (e.g. `[BRAVE_API_KEY]`). Missing → skill hidden from catalog. |
| `requires.bins` | List of binaries that must be on PATH (e.g. `[ffmpeg, ffprobe]`). Checked via `which`. |
| `requires.os` | Platform lock: `darwin`, `linux`, or `win32`. Checked via `process.platform`. |
| `enabled` | Set to `false` to disable without deleting (default: `true`) |

If any `requires` condition or `enabled` check fails, the skill is silently skipped — it never appears in the catalog.

### Gate examples

**Binary gate** — skill only appears if `ffmpeg` and `ffprobe` are installed:
```yaml
---
name: video-processing
description: Trim, convert, and analyze video files using ffmpeg
requires:
  bins: [ffmpeg, ffprobe]
---
```

**Platform gate** — macOS only:
```yaml
---
name: macos-automation
description: Control macOS apps via AppleScript and Shortcuts
requires:
  os: darwin
---
```

**Combined gates** — needs API key AND binary:
```yaml
---
name: cloud-transcription
description: Transcribe audio files using a cloud speech-to-text API
requires:
  env: [TRANSCRIPTION_API_KEY]
  bins: [ffmpeg]
---
```

**Full spec-compatible example with all optional fields:**
```yaml
---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF documents.
license: Apache-2.0
compatibility: Requires poppler-utils (pdftotext, pdfinfo) installed via system package manager
metadata:
  author: openwren
  version: "1.0"
requires:
  bins: [pdftotext, pdfinfo]
---
```

---

## How Skills Are Loaded (Progressive Disclosure)

Skills use a **two-stage loading model** (per the [Agent Skills spec](https://agentskills.io/specification)). This keeps the system prompt lean — even with hundreds of installed skills, only ~100 tokens per skill go into the initial prompt.

### Stage 1: Catalog (session start)

`src/agent/skills.ts` builds the catalog:

1. Scan bundled skills directory
2. Scan `~/.openwren/skills/` (global)
3. Scan `~/.openwren/agents/{agentId}/skills/` (per-agent)
4. Scan any `skills.load.extraDirs` paths
5. For each skill found, parse frontmatter only
6. Check gate conditions (`requires.env`, `requires.bins`, `requires.os`)
7. Check config overrides (`skills.entries.<name>.enabled`, `skills.allowBundled`)
8. Return list of eligible skill `name` + `description` pairs

Then `src/agent/prompt.ts` appends the catalog to the system prompt:

```
[soul.md content]

---

## Available Skills
You have the following skills available. To activate a skill and get its full
instructions, use the `load_skill` tool with the skill name.

- brave-search: Search the web using Brave Search API. Use when the user asks about current events or recent news.
- agent-browser: Headless browser for web interaction and scraping. Use for pages that need JavaScript or login flows.
- video-processing: Trim, convert, and analyze video files using ffmpeg.
```

### Stage 2: Activation (on demand)

When the agent decides it needs a skill, it calls the `load_skill` tool:

```
load_skill("brave-search")
```

The tool reads the full SKILL.md body and returns it as the tool result. The agent now has the complete instructions and uses them for the rest of the session.

- The agent decides when to activate — it reads the catalog descriptions and picks what's relevant.
- A skill can be activated at any point during the session, not just at the start.
- Once activated, the instructions are in the conversation context for the remainder of the session.
- Multiple skills can be activated in one session.

### Why progressive disclosure?

Loading every skill body into the prompt doesn't scale. With 50 skills at ~500 tokens each, that's 25K tokens of instructions the agent may never need. The catalog is ~100 tokens per skill (~5K for 50 skills), and the agent only loads what it actually uses.

Changes to SKILL.md files take effect on the next new session (catalog is rebuilt at session start).

---

## Config Support

Under `skills` in `~/.openwren/openwren.json`:

```json5
{
  // Whitelist which bundled skills are allowed to load.
  // If omitted, all bundled skills load (subject to their gate conditions).
  // Useful for keeping the system prompt lean.
  "skills.allowBundled": ["memory-management", "brave-search"],

  // Enable/disable a specific skill, overriding its gate conditions.
  // Works for bundled, global, and per-agent skills alike.
  "skills.entries.brave-search.enabled": false,

  // Point to additional skill directories (lowest precedence, after bundled).
  "skills.load.extraDirs": ["~/my-shared-skills"],
}
```

**What we deliberately don't support (by design):**

- **Per-skill API key / env injection in config** — OpenClaw supports `skills.entries.<name>.env` and `skills.entries.<name>.apiKey` to put secrets directly in `openwren.json`. We don't. All secrets stay in `~/.openwren/.env` and are referenced via `${env:VAR}`. The skill's `requires.env` gate handles the rest — the skill only loads when the key is present. Mixing secrets into the config file breaks our security model.
- **`install.preferBrew` / `install.nodeManager`** — skill dependency auto-install. Out of scope.
- **`load.watch`** — live skill reloading without restart. Skills reload on next new session, which is sufficient.

API keys needed by skills live in `~/.openwren/.env`. The skill gate (`requires.env: [KEY_NAME]`) ensures the skill is silently skipped if the key isn't set.

---

## Bundled Skills (shipped with Open Wren)

These are always available and require no setup:

| Skill | Purpose | Gate |
|---|---|---|
| `memory-management` | Teaches agents when/how to use `save_memory` and `memory_search` | none |
| `file-operations` | Teaches agents path conventions and sandboxing for `read_file`/`write_file` | none |
| `brave-search` | Teaches agents when/how to use `search_web` | `BRAVE_API_KEY` |
| `web-fetch` | Teaches agents when/how to use `fetch_url` and how to handle large pages | none |
| `agent-browser` | Teaches agents how to use `agent-browser` CLI for headless browsing | `agent-browser` binary on PATH |

---

## agent-browser Skill

`agent-browser` is a headless browser CLI built by Vercel (`npm install -g agent-browser`). The agent uses it via `shell_exec` — no code changes needed beyond whitelisting the commands.

The skill teaches the agent the command interface:

```markdown
---
name: agent-browser
description: Headless browser for web interaction and scraping
requires:
  bins: [agent-browser]
---

You can control a headless browser using the `agent-browser` CLI via shell commands.

Commands:
- `agent-browser open <url>` — navigate to a URL
- `agent-browser snapshot` — get the page as a compact accessibility tree with element refs
- `agent-browser click @e3` — click an element by its ref
- `agent-browser fill @e5 "text"` — fill an input field
- `agent-browser scroll down` — scroll the page

Element refs (@e1, @e2, ...) come from `snapshot` output. Always snapshot before clicking.
Use agent-browser for tasks that require JavaScript execution, login flows, or pages
that don't render usefully as plain HTML.
```

Implementation: add `agent-browser` commands to the shell whitelist in `src/tools/shell.ts`.

---

## Implementation Plan (Phase 8)

**New files:**
- `src/agent/skills.ts` — catalog builder: scans directories, parses frontmatter only, gate checks, returns `name` + `description` pairs
- `src/tools/skills.ts` — `load_skill` tool: reads full SKILL.md body on demand, returns as tool result
- `src/skills/memory-management/SKILL.md` — bundled skill
- `src/skills/file-operations/SKILL.md` — bundled skill

**Modified files:**
- `src/agent/prompt.ts` — append skill catalog (names + descriptions only) after soul.md
- `src/tools/index.ts` — register `load_skill` tool
- `src/config.ts` — add `skills` config section (`allowBundled`, `entries.<name>.enabled`, `load.extraDirs`)
- `src/workspace.ts` — ensure `~/.openwren/skills/` directory exists at startup
- `src/tools/shell.ts` — add `agent-browser` commands to whitelist (for Phase 9 Web Research)

**Not in scope for Phase 8:**
- WrenHub registry / remote skill installation
- File watcher for live skill reloading
- Web UI skills panel (Phase 11)
- `scripts/`, `references/`, `assets/` directory support (future — agent can reference them once we add it)
