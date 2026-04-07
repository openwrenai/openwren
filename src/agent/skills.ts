import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { config, BUNDLED_SKILLS_DIR, getAgentPermissions } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillRequires {
  env: string[];
  bins: string[];
  os: string;      // "" means any platform
  config: string[]; // dot-notation config keys that must be set and truthy
  tools: string[];  // tool names that must be in the agent's permissions
  role: string[];   // agent must have one of these roles
  delegated: boolean | null;  // true = only when agent is running a delegated task, false = only when independent, null = don't care
}

interface ParsedSkill {
  name: string;
  description: string;
  autoload: boolean;
  enabled: boolean;
  requires: SkillRequires;
  body: string;
  filePath: string;
}

export interface CatalogEntry {
  name: string;
  description: string;
}

export interface AutoloadedSkill {
  name: string;
  body: string;
}

export interface SkillLoadResult {
  catalog: CatalogEntry[];
  autoloaded: AutoloadedSkill[];
}

// ---------------------------------------------------------------------------
// Catalog cache — keyed by agentId, used by loadSkillBody()
// Rebuilt on every buildSkillCatalog() call. Agent-keyed so concurrent
// agents don't overwrite each other's catalogs.
// ---------------------------------------------------------------------------

const catalogCache = new Map<string, Map<string, ParsedSkill>>();

// ---------------------------------------------------------------------------
// Binary check cache — 5 minute TTL so newly installed binaries are detected
// ---------------------------------------------------------------------------

const BIN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const binCache = new Map<string, { available: boolean; checkedAt: number }>();

function isBinaryAvailable(name: string): boolean {
  // Validate binary name — only safe characters allowed
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    console.warn(`[skills] Invalid binary name "${name}" — skipping`);
    return false;
  }

  const cached = binCache.get(name);
  if (cached && Date.now() - cached.checkedAt < BIN_CACHE_TTL_MS) {
    return cached.available;
  }

  try {
    execSync(`which ${name}`, { stdio: "ignore" });
    binCache.set(name, { available: true, checkedAt: Date.now() });
    return true;
  } catch {
    binCache.set(name, { available: false, checkedAt: Date.now() });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Frontmatter parser — hand-rolled, no YAML dependency
//
// Supports:
//   key: string_value
//   key: true / false
//   key: [inline, array]
//   parent:
//     child: value
//     child: [array]
//
// Does NOT support multiline values, block scalars (| / >), or nesting
// deeper than one level. That's all we need for SKILL.md frontmatter.
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: string): { frontmatter: Record<string, any>; body: string } | null {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const yamlBlock = match[1];
  const body = match[2].trim();
  const result: Record<string, any> = {};

  let parentKey: string | null = null;

  for (const line of yamlBlock.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    // Top-level key (no indentation)
    if (indent === 0) {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;

      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (value === "") {
        // Start of a nested block
        parentKey = key;
        if (!result[key]) result[key] = {};
        continue;
      }

      parentKey = null;
      result[key] = parseValue(value);
      continue;
    }

    // Indented key (nested under parentKey)
    if (indent > 0 && parentKey) {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;

      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (typeof result[parentKey] !== "object") result[parentKey] = {};
      result[parentKey][key] = parseValue(value);
    }
  }

  return { frontmatter: result, body };
}

function parseValue(raw: string): string | boolean | string[] {
  if (raw === "") return "";
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Inline array: [item1, item2, item3]
  const arrayMatch = raw.match(/^\[(.*)\]$/);
  if (arrayMatch) {
    return arrayMatch[1]
      .split(",")
      .map(s => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  // String — strip surrounding quotes if present
  return raw.replace(/^["']|["']$/g, "");
}

// ---------------------------------------------------------------------------
// Extract typed skill data from raw frontmatter
// ---------------------------------------------------------------------------

function extractSkill(
  frontmatter: Record<string, any>,
  body: string,
  filePath: string,
): ParsedSkill | null {
  const name = frontmatter.name;
  const description = frontmatter.description;

  if (!name || typeof name !== "string") {
    console.warn(`[skills] Skipping ${filePath} — missing or invalid "name" field`);
    return null;
  }
  if (!description || typeof description !== "string") {
    console.warn(`[skills] Skipping ${filePath} — missing or invalid "description" field`);
    return null;
  }

  const requires = frontmatter.requires ?? {};

  return {
    name,
    description,
    autoload: frontmatter.autoload === true,
    enabled: frontmatter.enabled !== false, // default: true
    requires: {
      env: Array.isArray(requires.env) ? requires.env : [],
      bins: Array.isArray(requires.bins) ? requires.bins : [],
      os: typeof requires.os === "string" ? requires.os : "",
      config: Array.isArray(requires.config) ? requires.config : [],
      tools: Array.isArray(requires.tools) ? requires.tools : [],
      role: Array.isArray(requires.role) ? requires.role : [],
      delegated: requires.delegated === true ? true : requires.delegated === false ? false : null,
    },
    body,
    filePath,
  };
}

// ---------------------------------------------------------------------------
// Gate checks
//
// quiet=true suppresses all per-skill log lines. Used by scheduled job runs
// to avoid noisy repetitive output when jobs fire frequently. The catalog is
// still rebuilt in full — quiet only affects logging, not behaviour.
// ---------------------------------------------------------------------------

function passesGates(skill: ParsedSkill, agentId: string, quiet = false, hasTaskContext = false): boolean {
  // 1. Frontmatter enabled check
  if (!skill.enabled) {
    if (!quiet) console.log(`[skills] ${skill.name}: disabled in frontmatter`);
    return false;
  }

  // 2. Per-agent override (highest priority) then global config override
  const agentSkillOverride = config.agents[agentId]?.skills?.[skill.name];
  if (agentSkillOverride?.enabled !== undefined) {
    // Per-agent override exists — it wins
    if (agentSkillOverride.enabled === false) {
      if (!quiet) console.log(`[skills] ${skill.name}: disabled for agent ${agentId}`);
      return false;
    }
    // agentSkillOverride.enabled === true — explicitly enabled for this agent, skip global check
  } else {
    // No per-agent override — fall back to global
    const configEntry = config.skills?.entries?.[skill.name];
    if (configEntry && configEntry.enabled === false) {
      if (!quiet) console.log(`[skills] ${skill.name}: disabled in config`);
      return false;
    }
  }

  // 3. OS gate (cheapest — string compare)
  if (skill.requires.os && skill.requires.os !== process.platform) {
    if (!quiet) console.log(`[skills] ${skill.name}: requires os=${skill.requires.os}, running ${process.platform}`);
    return false;
  }

  // 4. Config gate — check dot-notation config keys are set and truthy
  for (const dotPath of skill.requires.config) {
    const value = dotPath.split(".").reduce((obj: any, key) => obj?.[key], config);
    if (!value) {
      if (!quiet) console.log(`[skills] ${skill.name}: requires config ${dotPath} — not set`);
      return false;
    }
  }

  // 5. Role gate — agent must have one of the listed roles
  if (skill.requires.role.length > 0) {
    const agentRole = config.agents[agentId]?.role;
    if (!agentRole || !skill.requires.role.includes(agentRole)) {
      if (!quiet) console.log(`[skills] ${skill.name}: requires role ${skill.requires.role.join("|")} — agent has ${agentRole || "none"}`);
      return false;
    }
  }

  // 6. Delegation gate — load only when agent is delegated or independent
  if (skill.requires.delegated === true && !hasTaskContext) {
    if (!quiet) console.log(`[skills] ${skill.name}: requires delegated=true — agent is not running a delegated task`);
    return false;
  }
  if (skill.requires.delegated === false && hasTaskContext) {
    if (!quiet) console.log(`[skills] ${skill.name}: requires delegated=false — agent is running a delegated task`);
    return false;
  }

  // 7. Tools gate — agent must have all listed tools in its permissions
  if (skill.requires.tools.length > 0) {
    const permissions = getAgentPermissions(agentId);
    // null permissions = no role = all tools available, so all tool gates pass
    if (permissions) {
      for (const tool of skill.requires.tools) {
        if (!permissions.includes(tool)) {
          if (!quiet) console.log(`[skills] ${skill.name}: requires tool ${tool} — not in agent's role permissions`);
          return false;
        }
      }
    }
  }

  // 8. Env gate — process.env includes .env loaded by dotenv at boot
  for (const key of skill.requires.env) {
    if (!process.env[key]) {
      if (!quiet) console.log(`[skills] ${skill.name}: requires env ${key} — not set`);
      return false;
    }
  }

  // 9. Binary gate (most expensive — spawns subprocess)
  for (const bin of skill.requires.bins) {
    if (!isBinaryAvailable(bin)) {
      if (!quiet) console.log(`[skills] ${skill.name}: requires binary ${bin} — not found`);
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Directory scanner — finds all SKILL.md files in a directory
// ---------------------------------------------------------------------------

function scanSkillDir(dir: string): ParsedSkill[] {
  if (!fs.existsSync(dir)) return [];

  const skills: ParsedSkill[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFile = path.join(dir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;

      try {
        const raw = fs.readFileSync(skillFile, "utf-8");
        const parsed = parseFrontmatter(raw);
        if (!parsed) {
          console.warn(`[skills] ${skillFile}: no valid frontmatter found`);
          continue;
        }

        const skill = extractSkill(parsed.frontmatter, parsed.body, skillFile);
        if (!skill) continue;

        // Folder name must match skill name
        if (entry.name !== skill.name) {
          console.warn(
            `[skills] ${skillFile}: folder "${entry.name}" doesn't match skill name "${skill.name}" — skipping`,
          );
          continue;
        }

        skills.push(skill);
      } catch (err) {
        console.warn(`[skills] Error reading ${skillFile}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.warn(`[skills] Error scanning ${dir}: ${(err as Error).message}`);
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Resolve ~ in paths
// ---------------------------------------------------------------------------

function resolvePath(raw: string): string {
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return path.resolve(raw);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scans all skill directories, applies gates, and returns:
 * - catalog: name + description pairs for the system prompt (two-stage loading)
 * - autoloaded: full body text of skills with autoload: true
 *
 * Called from prompt.ts on every loadSystemPrompt() call.
 *
 * Precedence (highest → lowest, same name = higher wins):
 * 1. Per-agent: ~/.openwren/agents/{agentId}/skills/
 * 2. Global:   ~/.openwren/skills/
 * 3. Extra dirs from config
 * 4. Bundled:  shipped with Open Wren (lowest)
 *
 * quiet=true suppresses per-skill log lines (used by scheduled job runner).
 */
export function buildSkillCatalog(agentId: string, quiet = false, hasTaskContext = false): SkillLoadResult {
  // Scan in reverse precedence order — later entries overwrite earlier ones
  const seen = new Map<string, ParsedSkill>();

  // 4. Bundled skills (lowest precedence)
  const allowBundled = config.skills?.allowBundled;
  for (const skill of scanSkillDir(BUNDLED_SKILLS_DIR)) {
    if (allowBundled && !allowBundled.includes(skill.name)) continue;
    seen.set(skill.name, skill);
  }

  // 3. Extra dirs from config
  for (const extraDir of config.skills?.load?.extraDirs ?? []) {
    for (const skill of scanSkillDir(resolvePath(extraDir))) {
      seen.set(skill.name, skill);
    }
  }

  // 2. Global: ~/.openwren/skills/
  for (const skill of scanSkillDir(path.join(config.workspaceDir, "skills"))) {
    seen.set(skill.name, skill);
  }

  // 1. Per-agent (highest): ~/.openwren/agents/{agentId}/skills/
  for (const skill of scanSkillDir(path.join(config.workspaceDir, "agents", agentId, "skills"))) {
    seen.set(skill.name, skill);
  }

  // Apply gates and split into catalog vs autoloaded
  const catalog: CatalogEntry[] = [];
  const autoloaded: AutoloadedSkill[] = [];
  const agentCache = new Map<string, ParsedSkill>();

  for (const skill of seen.values()) {
    if (!passesGates(skill, agentId, quiet, hasTaskContext)) continue;

    if (skill.autoload) {
      autoloaded.push({ name: skill.name, body: skill.body });
      if (!quiet) console.log(`[skills] ${skill.name}: autoloaded`);
    } else {
      catalog.push({ name: skill.name, description: skill.description });
      agentCache.set(skill.name, skill);
      if (!quiet) console.log(`[skills] ${skill.name}: added to catalog`);
    }
  }

  // Cache catalog skills for load_skill tool
  catalogCache.set(agentId, agentCache);

  return { catalog, autoloaded };
}

// ---------------------------------------------------------------------------
// Skill inventory — returns all skills with gate status (for API/UI)
// ---------------------------------------------------------------------------

export interface SkillInfo {
  name: string;
  description: string;
  autoload: boolean;
  enabled: boolean;
  blocked: boolean;
  blockReason: string | null;
  source: string;
}

/**
 * Returns all skills visible to an agent with their gate status.
 * Unlike buildSkillCatalog(), this doesn't filter — it reports.
 */
export function getSkillInventory(agentId: string): SkillInfo[] {
  const seen = new Map<string, { skill: ParsedSkill; source: string }>();

  // Scan in reverse precedence order
  const allowBundled = config.skills?.allowBundled;
  for (const skill of scanSkillDir(BUNDLED_SKILLS_DIR)) {
    if (allowBundled && !allowBundled.includes(skill.name)) continue;
    seen.set(skill.name, { skill, source: "bundled" });
  }

  for (const extraDir of config.skills?.load?.extraDirs ?? []) {
    for (const skill of scanSkillDir(resolvePath(extraDir))) {
      seen.set(skill.name, { skill, source: extraDir });
    }
  }

  for (const skill of scanSkillDir(path.join(config.workspaceDir, "skills"))) {
    seen.set(skill.name, { skill, source: "global" });
  }

  for (const skill of scanSkillDir(path.join(config.workspaceDir, "agents", agentId, "skills"))) {
    seen.set(skill.name, { skill, source: "per-agent" });
  }

  const results: SkillInfo[] = [];

  for (const { skill, source } of seen.values()) {
    const blockReason = getBlockReason(skill, agentId);

    // Determine enabled state: per-agent override > global override > frontmatter default
    const agentOverride = config.agents[agentId]?.skills?.[skill.name];
    const globalEntry = config.skills?.entries?.[skill.name];
    let enabledByConfig: boolean;
    if (agentOverride?.enabled !== undefined) {
      // Per-agent override wins
      enabledByConfig = agentOverride.enabled;
    } else if (globalEntry?.enabled !== undefined) {
      // Global override
      enabledByConfig = globalEntry.enabled !== false;
    } else {
      // Frontmatter default
      enabledByConfig = skill.enabled;
    }

    results.push({
      name: skill.name,
      description: skill.description,
      autoload: skill.autoload,
      enabled: enabledByConfig && !blockReason,
      blocked: !!blockReason,
      blockReason,
      source,
    });
  }

  // Sort: enabled first, then alphabetical
  results.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

/**
 * Checks system gates and returns the first block reason, or null if all pass.
 * Only checks non-togglable gates (OS, config, bins, role, tools, env).
 * Does NOT check the enabled/config-override gates — those are user-toggleable.
 */
function getBlockReason(skill: ParsedSkill, agentId: string): string | null {
  if (skill.requires.os && skill.requires.os !== process.platform) {
    return `Requires OS: ${skill.requires.os}`;
  }
  for (const dotPath of skill.requires.config) {
    const value = dotPath.split(".").reduce((obj: any, key) => obj?.[key], config);
    if (!value) return `Missing: config:${dotPath}`;
  }
  if (skill.requires.role.length > 0) {
    const agentRole = config.agents[agentId]?.role;
    if (!agentRole || !skill.requires.role.includes(agentRole)) {
      return `Requires role: ${skill.requires.role.join(" or ")}`;
    }
  }
  if (skill.requires.tools.length > 0) {
    const permissions = getAgentPermissions(agentId);
    if (permissions) {
      for (const tool of skill.requires.tools) {
        if (!permissions.includes(tool)) return `Missing: tool:${tool}`;
      }
    }
  }
  for (const key of skill.requires.env) {
    if (!process.env[key]) return `Missing: env:${key}`;
  }
  for (const bin of skill.requires.bins) {
    if (!isBinaryAvailable(bin)) return `Missing: bin:${bin}`;
  }
  return null;
}

/**
 * Load the full body of a catalog skill by name.
 * Called by the load_skill tool when the agent activates a skill.
 * Only returns skills that passed gates and are in the catalog (not autoloaded).
 */
export function loadSkillBody(name: string, agentId: string): string | null {
  const agentSkills = catalogCache.get(agentId);
  if (!agentSkills) return null;

  const skill = agentSkills.get(name);
  if (!skill) return null;

  return skill.body;
}
