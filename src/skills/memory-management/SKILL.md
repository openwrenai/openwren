---
name: memory-management
description: Persistent memory system that survives session resets, compaction, and restarts. Use to store and retrieve important facts, preferences, and context.
autoload: true
---

## Memory System

You have a persistent memory system with two tools:

### `save_memory`

Store important information that should survive across sessions.

**When to save:**
- User preferences and personal details they share
- Project names, goals, and key decisions
- Important context worth remembering long-term
- Corrections to your previous assumptions

**When NOT to save:**
- One-off questions or temporary debugging
- Information already in the current conversation
- Trivial facts that won't matter next session

**Key naming:** Prefix keys with your agent name to avoid collisions with other agents.
Examples: `atlas-user-prefs`, `atlas-projects`, `einstein-physics-notes`.

Saving to the same key overwrites — use this to update a memory rather than creating duplicates.

### `memory_search`

Search persistent memory by keyword. Returns full content of every matching file.

**When to search:**
- Start of conversations that reference past context ("my project", "that thing we discussed")
- When the user mentions something you should already know about
- Before making assumptions — check if you've stored relevant context

Search with specific keywords: "user preferences" or "project goals" rather than vague queries.
