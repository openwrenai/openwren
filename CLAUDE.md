# Open Wren — Claude Instructions

## Rules

- **Always read `Todo.md` at the start of every session.** It contains the full project roadmap, completed phases, and current work — essential context for any task.
- **Never run git commands unless explicitly asked to commit or push.**
- **Never add `Co-Authored-By` or contributor lines to commit messages.**
- **Commit message format:** Subject line is `Phase X.Y: short title` (no conventional commits prefix). Body bullet-points what changed and why.

## Build & Dev

Project uses **tsup** (esbuild-based), package type `"module"` (ESM).

| Command | What it does |
|---|---|
| `npm run build` | `tsup` → copies `src/templates/`, `src/skills/`, and `drizzle/` into `dist/` |
| `npm run typecheck` | `tsc` (type-check only, `noEmit: true`) |
| `npm run dev` | `tsx src/index.ts` — runs directly, no build step |
| `npm run cli -- <cmd>` | `tsx src/cli.ts` — CLI commands during dev |

> **Important:** Run `npx tsc --noEmit` (no file args) — passing individual files bypasses `tsconfig.json` settings.

## Gotchas & Conventions

- Nothing reads `process.env` directly (except `PORT` for gateway and `OPENWREN_HOME` for workspace path override)
- Versioning: CalVer `YYYY.M.D` (date-based). Same-day hotfixes: `YYYY.M.D-1`. **Version bump:** update `package.json` first, then `npm install --package-lock-only` to sync lock file
- `quiet` flag on `buildSkillCatalog()` suppresses per-skill log lines — used by scheduler/orchestrator runners to avoid log spam

