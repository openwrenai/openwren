---
name: file-read
description: Read files and explore directories within the workspace sandbox.
autoload: true
requires:
  tools: [read_file]
---

## File Reading

You have the `read_file` tool for reading files and exploring directories.

### Sandbox

All file paths are relative to the workspace root (`~/.openwren/`). You cannot read files outside this directory unless explicitly allowed in security config.

### Usage

- Pass a path relative to the workspace root
- Directories return a listing of their contents
- Files over 512 KB are truncated
- Use this to explore the workspace, read config files, or check agent files

### Key paths

- `agents/{agent-id}/workspace/` — your workspace for files and projects
- `agents/{agent-id}/memory/` — persistent memory files (prefer `save_memory` tool)
- `agents/{agent-id}/soul.md` — agent personality file
- `teams/{team-name}/` — shared team deliverables (if you're on a team)
