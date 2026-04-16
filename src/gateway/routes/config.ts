/**
 * REST API routes for config management.
 *
 * GET  /api/config     — full config with sensitive fields masked
 * GET  /api/config/raw — raw openwren.json file content as string
 * PATCH /api/config    — partial update via { set, remove }
 * PUT  /api/config/raw — overwrite raw file content (validates JSON5)
 *
 * Auth: Same Bearer token as the WebSocket gateway.
 */

import * as fs from "fs";
import * as path from "path";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config, reloadConfig, getDefaultConfig } from "../../config";
import { readRawConfig, writeConfigKeys, removeConfigKeys } from "../../config-writer";
import { timingSafeEqual } from "crypto";
import JSON5 from "json5";

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function authenticate(request: FastifyRequest, reply: FastifyReply): boolean {
  const tok = config.gateway.wsToken;
  if (!tok) {
    reply.code(503).send({ error: "Gateway not configured" });
    return false;
  }

  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing or invalid Authorization header" });
    return false;
  }

  const provided = auth.slice(7);
  const a = Buffer.from(tok, "utf-8");
  const b = Buffer.from(provided, "utf-8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reply.code(401).send({ error: "Invalid credentials" });
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Keys whose values should be masked in GET /api/config. */
const SENSITIVE_PATTERNS = [
  /^providers\.\w+\.apiKey$/,
  /^gateway\.wsToken$/,
  /^bindings\.\w+\.\w+$/,
  /^search\.\w+\.apiKey$/,
];

const MASK = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(key));
}

function maskValue(val: unknown): string {
  if (typeof val !== "string" || !val) return "";
  if (val.length >= 8) {
    return val.slice(0, 3) + "..." + val.slice(-3);
  }
  return MASK;
}

function configPath(): string {
  return path.join(config.workspaceDir, "openwren.json");
}

/** Flatten a nested object into dot-notation keys. Skips agents/teams/users/bindings (managed elsewhere). */
function flattenDefaults(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const SKIP = ["agents", "teams", "users", "bindings", "workspaceDir"];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (!prefix && SKIP.includes(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenDefaults(value as Record<string, unknown>, full));
    } else {
      result[full] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/config — returns flat config with sensitive fields masked.
   * Also returns _meta.sensitiveKeys so the frontend knows which values are masks.
   */
  app.get("/api/config", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const raw = readRawConfig();
    const sensitiveKeys: string[] = [];

    for (const key of Object.keys(raw)) {
      if (isSensitiveKey(key) && raw[key]) {
        sensitiveKeys.push(key);
        raw[key] = maskValue(raw[key]);
      }
    }

    const defaults = flattenDefaults(getDefaultConfig() as Record<string, unknown>);

    return { config: raw, defaults, _meta: { sensitiveKeys } };
  });

  /**
   * GET /api/config/raw — returns the raw file content as a string.
   */
  app.get("/api/config/raw", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const content = fs.readFileSync(configPath(), "utf-8");
    return { content };
  });

  /**
   * PATCH /api/config — partial update.
   * Body: { set?: Record<string, unknown>, remove?: string[] }
   * Skips any key in `set` whose value matches a mask placeholder.
   */
  app.patch("/api/config", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const body = request.body as {
      set?: Record<string, unknown>;
      remove?: string[];
    } | null;

    if (!body) {
      reply.code(400).send({ error: "Request body required" });
      return;
    }

    // Apply sets — skip masked values so unchanged secrets aren't overwritten
    if (body.set && Object.keys(body.set).length > 0) {
      const filtered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body.set)) {
        if (typeof value === "string" && (value === MASK || /^.{3}\.\.\..{3}$/.test(value))) {
          continue; // Skip — this is still the masked placeholder
        }
        filtered[key] = value;
      }
      if (Object.keys(filtered).length > 0) {
        writeConfigKeys(filtered);
      }
    }

    // Apply removes
    if (body.remove && body.remove.length > 0) {
      removeConfigKeys(body.remove);
    }

    reloadConfig();

    // Return updated config (re-read and mask)
    const raw = readRawConfig();
    const sensitiveKeys: string[] = [];
    for (const key of Object.keys(raw)) {
      if (isSensitiveKey(key) && raw[key]) {
        sensitiveKeys.push(key);
        raw[key] = maskValue(raw[key]);
      }
    }

    const defaults = flattenDefaults(getDefaultConfig() as Record<string, unknown>);
    return { config: raw, defaults, _meta: { sensitiveKeys } };
  });

  /**
   * PUT /api/config/raw — overwrite raw file content.
   * Validates JSON5 before writing. Returns 400 if malformed.
   */
  app.put("/api/config/raw", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const body = request.body as { content?: string } | null;

    if (!body || typeof body.content !== "string") {
      reply.code(400).send({ error: "Request body must include 'content' string" });
      return;
    }

    // Validate JSON5
    try {
      JSON5.parse(body.content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid JSON5";
      reply.code(400).send({ error: `Invalid JSON5: ${msg}` });
      return;
    }

    fs.writeFileSync(configPath(), body.content, "utf-8");
    reloadConfig();

    return { ok: true };
  });

  // -----------------------------------------------------------------------
  // POST /api/config/provider — add a provider (writes .env + openwren.json)
  // -----------------------------------------------------------------------

  /** Canonical env var names per provider. */
  const PROVIDER_ENV_VARS: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
    mistral: "MISTRAL_API_KEY",
    groq: "GROQ_API_KEY",
    xai: "XAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    llmgateway: "LLM_GATEWAY_API_KEY",
  };

  app.post("/api/config/provider", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const body = request.body as {
      provider?: string;
      apiKey?: string;
      baseUrl?: string;
    } | null;

    if (!body || !body.provider) {
      reply.code(400).send({ error: "provider is required" });
      return;
    }

    const { provider } = body;

    // Ollama: just write baseUrl directly to config
    if (provider === "ollama") {
      const url = body.baseUrl || "http://localhost:11434";
      writeConfigKeys({ "providers.ollama.baseUrl": url });
      reloadConfig();
      const raw = readRawConfig();
      const defaults = flattenDefaults(getDefaultConfig() as Record<string, unknown>);
      return { config: raw, defaults, _meta: { sensitiveKeys: [] } };
    }

    // All other providers: write API key to .env and reference to config
    if (!body.apiKey) {
      reply.code(400).send({ error: "apiKey is required" });
      return;
    }

    const envVar = PROVIDER_ENV_VARS[provider];
    if (!envVar) {
      reply.code(400).send({ error: `Unknown provider: ${provider}` });
      return;
    }

    // Append to .env
    const envPath = path.join(config.workspaceDir, ".env");
    const envLine = `${envVar}=${body.apiKey}\n`;
    fs.appendFileSync(envPath, envLine, "utf-8");

    // Write config reference
    writeConfigKeys({ [`providers.${provider}.apiKey`]: `\${env:${envVar}}` });

    // Reload picks up new .env var + config change
    reloadConfig();

    // Return updated config
    const raw = readRawConfig();
    const sensitiveKeys: string[] = [];
    for (const key of Object.keys(raw)) {
      if (isSensitiveKey(key) && raw[key]) {
        sensitiveKeys.push(key);
        raw[key] = maskValue(raw[key]);
      }
    }
    const defaults = flattenDefaults(getDefaultConfig() as Record<string, unknown>);

    return { config: raw, defaults, _meta: { sensitiveKeys } };
  });
}
