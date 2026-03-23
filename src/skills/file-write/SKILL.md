---
name: file-write
description: Write files within the workspace sandbox. Requires user confirmation.
autoload: true
requires:
  tools: [write_file]
---

## File Writing

You have the `write_file` tool for creating and updating files.

### Sandbox

All file paths are relative to the workspace root (`~/.openwren/`). You cannot write files outside this directory.

### Usage

- Creates the file and any missing parent directories
- Overwrites existing files — be careful with important files
- Requires user confirmation before every write
- Your workspace is at `agents/{your-id}/workspace/` — use it for projects, experiments, code, notes

### Write-protected paths

These files cannot be written to, even with user confirmation:

- `agents/*/soul.md` — agent personality files
- `.env` — secrets and API keys
- `security.json` — shell permissions
- `openwren.json` — app configuration
- `exec-approvals.json` — approval state
