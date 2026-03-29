/**
 * Session store — manages sessions.json index for WebUI/CLI sessions.
 *
 * Main session (main.jsonl) is implicit and NOT tracked here.
 * This index only tracks additional sessions created from WebUI or CLI.
 *
 * File location: sessions/{userId}/sessions.json
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { userSessionDir, userNamedSessionPath } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata for a single session entry in sessions.json. */
export interface SessionEntry {
  agentId: string;
  label: string;
  source: string;       // "webui" | "cli" | future: "discord:group:123"
  createdAt: number;     // Unix ms
  updatedAt: number;     // Unix ms
}

/** The full sessions.json file structure. */
interface SessionStore {
  version: number;
  sessions: Record<string, SessionEntry>;  // keyed by UUID
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

/**
 * Returns the path to a user's sessions.json index file.
 *
 * @param userId - The user ID (e.g. "owner")
 * @returns Absolute path to sessions.json
 */
function storePath(userId: string): string {
  return path.join(userSessionDir(userId), "sessions.json");
}

/**
 * Load the session store from disk. Returns an empty store if the file
 * doesn't exist or is malformed.
 *
 * @param userId - The user to load sessions for
 * @returns The parsed session store
 */
function loadStore(userId: string): SessionStore {
  const filePath = storePath(userId);
  if (!fs.existsSync(filePath)) {
    return { version: 1, sessions: {} };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.version && parsed.sessions) {
      return parsed as SessionStore;
    }
  } catch {
    console.warn(`[sessions] Failed to parse ${filePath} — starting fresh`);
  }

  return { version: 1, sessions: {} };
}

/**
 * Save the session store to disk. Writes atomically (stringify + writeFile).
 *
 * @param userId - The user to save sessions for
 * @param store - The session store to write
 */
function saveStore(userId: string, store: SessionStore): void {
  const dir = userSessionDir(userId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(storePath(userId), JSON.stringify(store, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a new UUID v4 for session identification.
 *
 * @returns A random UUID string
 */
function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Create a new session and register it in the index.
 * Generates a UUID, creates an empty JSONL file, and adds the entry
 * to sessions.json.
 *
 * @param userId - The user creating the session
 * @param agentId - The agent this session is locked to
 * @param label - Human-readable session name (e.g. "Research chat")
 * @param source - Where the session was created from (e.g. "webui", "cli")
 * @returns The generated session ID (UUID)
 */
export function createSession(
  userId: string,
  agentId: string,
  label: string,
  source: string = "webui",
): string {
  const sessionId = generateSessionId();
  const store = loadStore(userId);
  const now = Date.now();

  store.sessions[sessionId] = {
    agentId,
    label,
    source,
    createdAt: now,
    updatedAt: now,
  };

  saveStore(userId, store);

  // Create empty JSONL file
  const sessionFile = userNamedSessionPath(userId, sessionId);
  if (!fs.existsSync(sessionFile)) {
    fs.writeFileSync(sessionFile, "", "utf-8");
  }

  console.log(`[sessions] Created session ${sessionId} for ${userId} → ${agentId} ("${label}")`);
  return sessionId;
}

/**
 * List all sessions for a user. Returns entries from sessions.json
 * sorted by updatedAt (most recent first).
 *
 * @param userId - The user to list sessions for
 * @returns Array of [sessionId, entry] tuples, sorted by most recent
 */
export function listSessions(userId: string): [string, SessionEntry][] {
  const store = loadStore(userId);
  return Object.entries(store.sessions)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
}

/**
 * Get a specific session entry by ID.
 *
 * @param userId - The user who owns the session
 * @param sessionId - The session UUID to look up
 * @returns The session entry, or null if not found
 */
export function getSession(userId: string, sessionId: string): SessionEntry | null {
  const store = loadStore(userId);
  return store.sessions[sessionId] ?? null;
}

/**
 * Update a session entry. Currently only supports changing the label.
 *
 * @param userId - The user who owns the session
 * @param sessionId - The session UUID to update
 * @param updates - Fields to update (currently just label)
 * @returns True if the session was found and updated, false if not found
 */
export function updateSession(
  userId: string,
  sessionId: string,
  updates: { label?: string },
): boolean {
  const store = loadStore(userId);
  const entry = store.sessions[sessionId];
  if (!entry) return false;

  if (updates.label !== undefined) {
    entry.label = updates.label;
  }
  entry.updatedAt = Date.now();

  saveStore(userId, store);
  return true;
}

/**
 * Update the updatedAt timestamp for a session. Called on every message
 * to keep the session list sorted by recency.
 *
 * @param userId - The user who owns the session
 * @param sessionId - The session UUID to touch
 */
export function touchSession(userId: string, sessionId: string): void {
  const store = loadStore(userId);
  const entry = store.sessions[sessionId];
  if (!entry) return;

  entry.updatedAt = Date.now();
  saveStore(userId, store);
}

/**
 * Delete a session — removes the entry from sessions.json and deletes
 * the JSONL file from disk.
 *
 * @param userId - The user who owns the session
 * @param sessionId - The session UUID to delete
 * @returns True if the session was found and deleted, false if not found
 */
export function deleteSession(userId: string, sessionId: string): boolean {
  const store = loadStore(userId);
  if (!store.sessions[sessionId]) return false;

  delete store.sessions[sessionId];
  saveStore(userId, store);

  // Delete the JSONL file
  const sessionFile = userNamedSessionPath(userId, sessionId);
  if (fs.existsSync(sessionFile)) {
    fs.unlinkSync(sessionFile);
  }

  console.log(`[sessions] Deleted session ${sessionId} for ${userId}`);
  return true;
}
