---
name: agent-browser
description: Headless browser for web interaction and scraping. Use for pages that need JavaScript execution, login flows, or interactive web tasks.
requires:
  bins: [agent-browser]
---

You can control a headless browser using the `agent-browser` CLI via shell commands.

**Commands:**
- `agent-browser open <url>` — navigate to a URL
- `agent-browser snapshot` — get the page as a compact accessibility tree with element refs
- `agent-browser click @e3` — click an element by its ref
- `agent-browser fill @e5 "text"` — fill an input field
- `agent-browser scroll down` — scroll the page

**Workflow:**
1. `open` the URL first
2. `snapshot` to see the page structure and get element refs (@e1, @e2, ...)
3. Use `click`, `fill`, `scroll` to interact
4. `snapshot` again to see results

**When to use:**
- Pages that need JavaScript to render content
- Login flows or authenticated pages
- Forms that need to be filled and submitted
- Single-page apps where content loads dynamically

Element refs come from `snapshot` output. Always snapshot before clicking or filling.
