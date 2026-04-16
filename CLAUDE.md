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

## Preview / Dashboard

`npm run dev` (root) starts both backend + Vite frontend via `concurrently`. `.claude/launch.json` is configured to run this on port 5173.

- **GATEWAY_PORT=3000** is set in `launch.json` env — required because the preview tool injects `PORT=5173`, which the backend would pick up and collide with Vite. The Vite proxy (`vite.config.ts`) forwards `/api` and `/ws` to `127.0.0.1:3000`.
- **Auth token**: The dashboard requires a Bearer token. The token lives in `.env` as `WS_TOKEN`. After starting the preview, set it in the browser: `localStorage.setItem("ow_token", "<token>")` then navigate to `/?token=<token>`. The app saves it to localStorage and strips it from the URL.
- For this project the token is `test123`.

## Gotchas & Conventions

- Nothing reads `process.env` directly (except `PORT` for gateway and `OPENWREN_HOME` for workspace path override)
- Versioning: CalVer `YYYY.M.D` (date-based). Same-day hotfixes: `YYYY.M.D-1`. **Version bump:** update `package.json` first, then `npm install --package-lock-only` to sync lock file
- `quiet` flag on `buildSkillCatalog()` suppresses per-skill log lines — used by scheduler/orchestrator runners to avoid log spam

