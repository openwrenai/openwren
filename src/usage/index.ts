/**
 * Token usage tracking — file-based approach.
 *
 * Two components:
 * 1. Daily JSONL logs (~/.openwren/usage/YYYY-MM-DD.jsonl) — append-only, one line per agent loop run
 * 2. Accumulated summary (~/.openwren/usage/summary.json) — running totals, updated atomically per run
 *
 * Daily files are the source of truth. Summary is a derived cache for instant dashboard reads.
 * If summary is missing or corrupt, it can be rebuilt by scanning all daily files.
 */

import * as fs from "fs";
import * as path from "path";
import { config } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageEntry {
  ts: number;
  agent: string;
  provider: string;
  model: string;
  in: number;
  out: number;
  cachedIn?: number;
  source: "chat" | "task" | "job" | "notify";
  sourceId: string | null;
  workflowId: number | null;
  userId: string;
  sessionId: string;
}

interface TokenPair {
  in: number;
  out: number;
  cachedIn?: number;
}

interface SessionTokenPair extends TokenPair {
  lastActive: string;
}

export interface UsageSummary {
  days: Record<string, TokenPair>;
  byAgent: Record<string, TokenPair>;
  byProvider: Record<string, TokenPair>;
  bySession: Record<string, SessionTokenPair>;
}

/** Context passed by callers to identify the source of usage. */
export interface UsageContext {
  source: "chat" | "task" | "job" | "notify";
  sourceId?: string | null;
  workflowId?: number | null;
  userId: string;
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function usageDir(): string {
  return path.join(config.workspaceDir, "usage");
}

function dailyFilePath(date: string): string {
  return path.join(usageDir(), `${date}.jsonl`);
}

function summaryFilePath(): string {
  return path.join(usageDir(), "summary.json");
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Ensure directory exists
// ---------------------------------------------------------------------------

function ensureUsageDir(): void {
  const dir = usageDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Record usage — append to daily file + update summary
// ---------------------------------------------------------------------------

export function recordUsage(entry: UsageEntry): void {
  ensureUsageDir();

  // 1. Append to daily JSONL
  const date = todayString();
  const filePath = dailyFilePath(date);
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");

  // 2. Update summary
  const cached = entry.cachedIn ?? 0;

  const summary = loadSummaryRaw();
  const day = summary.days[date] ?? { in: 0, out: 0 };
  day.in += entry.in;
  day.out += entry.out;
  if (cached) day.cachedIn = (day.cachedIn ?? 0) + cached;
  summary.days[date] = day;

  const agent = summary.byAgent[entry.agent] ?? { in: 0, out: 0 };
  agent.in += entry.in;
  agent.out += entry.out;
  if (cached) agent.cachedIn = (agent.cachedIn ?? 0) + cached;
  summary.byAgent[entry.agent] = agent;

  const provider = summary.byProvider[entry.provider] ?? { in: 0, out: 0 };
  provider.in += entry.in;
  provider.out += entry.out;
  if (cached) provider.cachedIn = (provider.cachedIn ?? 0) + cached;
  summary.byProvider[entry.provider] = provider;

  const sessionKey = entry.sessionId;
  const session = summary.bySession[sessionKey] ?? { in: 0, out: 0, lastActive: date };
  session.in += entry.in;
  session.out += entry.out;
  if (cached) session.cachedIn = (session.cachedIn ?? 0) + cached;
  session.lastActive = date;
  summary.bySession[sessionKey] = session;

  writeSummary(summary);
}

// ---------------------------------------------------------------------------
// Load summary — for dashboards and CLI
// ---------------------------------------------------------------------------

export function loadSummary(): UsageSummary {
  const summary = loadSummaryRaw();
  // If empty and daily files exist, rebuild
  if (Object.keys(summary.days).length === 0) {
    const dir = usageDir();
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      if (files.length > 0) {
        return rebuildSummary();
      }
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Load daily entries — for detail drill-down
// ---------------------------------------------------------------------------

export function loadDailyEntries(date: string): UsageEntry[] {
  const filePath = dailyFilePath(date);
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
  const entries: UsageEntry[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip corrupt lines
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Rebuild summary — scans all daily files, regenerates summary.json
// ---------------------------------------------------------------------------

export function rebuildSummary(): UsageSummary {
  ensureUsageDir();
  const dir = usageDir();

  const summary: UsageSummary = {
    days: {},
    byAgent: {},
    byProvider: {},
    bySession: {},
  };

  if (!fs.existsSync(dir)) return summary;

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();

  for (const file of files) {
    const date = file.replace(".jsonl", "");
    const entries = loadDailyEntries(date);

    for (const entry of entries) {
      const cached = entry.cachedIn ?? 0;

      // days
      const day = summary.days[date] ?? { in: 0, out: 0 };
      day.in += entry.in;
      day.out += entry.out;
      if (cached) day.cachedIn = (day.cachedIn ?? 0) + cached;
      summary.days[date] = day;

      // byAgent
      const agent = summary.byAgent[entry.agent] ?? { in: 0, out: 0 };
      agent.in += entry.in;
      agent.out += entry.out;
      if (cached) agent.cachedIn = (agent.cachedIn ?? 0) + cached;
      summary.byAgent[entry.agent] = agent;

      // byProvider
      const provider = summary.byProvider[entry.provider] ?? { in: 0, out: 0 };
      provider.in += entry.in;
      provider.out += entry.out;
      if (cached) provider.cachedIn = (provider.cachedIn ?? 0) + cached;
      summary.byProvider[entry.provider] = provider;

      // bySession
      const sessionKey = entry.sessionId;
      const session = summary.bySession[sessionKey] ?? { in: 0, out: 0, lastActive: date };
      session.in += entry.in;
      session.out += entry.out;
      if (cached) session.cachedIn = (session.cachedIn ?? 0) + cached;
      session.lastActive = date;
      summary.bySession[sessionKey] = session;
    }
  }

  writeSummary(summary);
  console.log(`[usage] Summary rebuilt from ${files.length} daily file(s)`);
  return summary;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function emptySummary(): UsageSummary {
  return { days: {}, byAgent: {}, byProvider: {}, bySession: {} };
}

function loadSummaryRaw(): UsageSummary {
  const filePath = summaryFilePath();
  if (!fs.existsSync(filePath)) return emptySummary();
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    // Corrupt — will be rebuilt on next loadSummary() call
    return emptySummary();
  }
}

function writeSummary(summary: UsageSummary): void {
  ensureUsageDir();
  fs.writeFileSync(summaryFilePath(), JSON.stringify(summary, null, 2), "utf-8");
}
