import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { config, BUNDLED_SKILLS_DIR } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillRequires {
  env: string[];
  bins: string[];
  os: string; // "" means any platform
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
// Binary check cache — binaries don't appear/disappear mid-run
// ---------------------------------------------------------------------------

const binCache = new Map<string, boolean>();

function isBinaryAvailable(name: string): boolean {
  // Validate binary name — only safe characters allowed
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    console.warn(`[skills] Invalid binary name "${name}" — skipping`);
    return false;
  }

  if (binCache.has(name)) return binCache.get(name)!;

  try {
    execSync(`which ${name}`, { stdio: "ignore" });
    binCache.set(name, true);
    return true;
  } catch {
    binCache.set(name, false);
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
    },
    body,
    filePath,
  };
}

// ---------------------------------------------------------------------------
// Gate checks
// ---------------------------------------------------------------------------

function passesGates(skill: ParsedSkill): boolean {
  // 1. Frontmatter enabled check
  if (!skill.enabled) {
    console.log(`[skills] ${skill.name}: disabled in frontmatter`);
    return false;
  }

  // 2. Config override: skills.entries.<name>.enabled
  const configEntry = config.skills?.entries?.[skill.name];
  if (configEntry && configEntry.enabled === false) {
    console.log(`[skills] ${skill.name}: disabled in config`);
    return false;
  }

  // 3. OS gate (cheapest — string compare)
  if (skill.requires.os && skill.requires.os !== process.platform) {
    console.log(`[skills] ${skill.name}: requires os=${skill.requires.os}, running ${process.platform}`);
    return false;
  }

  // 4. Env gate — process.env includes .env loaded by dotenv at boot
  for (const key of skill.requires.env) {
    if (!process.env[key]) {
      console.log(`[skills] ${skill.name}: requires env ${key} — not set`);
      return false;
    }
  }

  // 5. Binary gate (most expensive — spawns subprocess)
  for (const bin of skill.requires.bins) {
    if (!isBinaryAvailable(bin)) {
      console.log(`[skills] ${skill.name}: requires binary ${bin} — not found`);
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
 */
export function buildSkillCatalog(agentId: string): SkillLoadResult {
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
    if (!passesGates(skill)) continue;

    if (skill.autoload) {
      autoloaded.push({ name: skill.name, body: skill.body });
      console.log(`[skills] ${skill.name}: autoloaded`);
    } else {
      catalog.push({ name: skill.name, description: skill.description });
      agentCache.set(skill.name, skill);
      console.log(`[skills] ${skill.name}: added to catalog`);
    }
  }

  // Cache catalog skills for load_skill tool
  catalogCache.set(agentId, agentCache);

  return { catalog, autoloaded };
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
