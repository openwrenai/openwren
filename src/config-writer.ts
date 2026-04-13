/**
 * Config writer — safe read-modify-write of openwren.json.
 *
 * Uses comment-json to preserve user comments and formatting.
 * All keys are flat dot-notation (e.g. "agents.atlas.model").
 */

import * as fs from "fs";
import * as path from "path";
import { parse, stringify } from "comment-json";
import { config } from "./config";

function configPath(): string {
  return path.join(config.workspaceDir, "openwren.json");
}

/** Reads openwren.json preserving comments. Returns the raw flat object. */
export function readRawConfig(): Record<string, unknown> {
  const raw = fs.readFileSync(configPath(), "utf-8");
  return parse(raw) as Record<string, unknown>;
}

/** Sets dot-notation keys in openwren.json, preserving comments. */
export function writeConfigKeys(entries: Record<string, unknown>): void {
  const obj = readRawConfig();
  for (const [key, value] of Object.entries(entries)) {
    obj[key] = value;
  }
  fs.writeFileSync(configPath(), stringify(obj, null, 2) + "\n", "utf-8");
}

/** Removes dot-notation keys from openwren.json, preserving comments. */
export function removeConfigKeys(keys: string[]): void {
  const obj = readRawConfig();
  for (const key of keys) {
    delete obj[key];
  }
  fs.writeFileSync(configPath(), stringify(obj, null, 2) + "\n", "utf-8");
}
