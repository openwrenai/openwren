---
name: file-operations
description: Read and write files within the workspace sandbox. All paths relative to ~/.openwren/.
autoload: true
---

## File Operations

You have `read_file` and `write_file` tools for working with files in the workspace.

### Sandbox

All file paths are relative to the workspace directory (`~/.openwren/`). You cannot read or write files outside this directory — the sandbox enforces this.

### `read_file`

- Pass a path relative to the workspace root
- Directories return a listing of their contents
- Files over 512 KB are truncated
- Use this to explore the workspace structure or read config/memory files

### `write_file`

- Creates the file and any missing parent directories
- Overwrites existing files — be careful with important files
- Requires user confirmation before execution

### Common paths

- `memory/` — persistent memory files (prefer `save_memory` tool instead)
- `agents/{agent-id}/soul.md` — agent personality files
- `skills/` — user-installed global skills
- `sessions/` — conversation history (JSONL, usually don't need to touch)
