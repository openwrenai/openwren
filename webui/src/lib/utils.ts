import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Strips injected timestamp prefixes that the model sometimes echoes back.
 * Timestamps are injected into messages sent to the LLM (via injectTimestamps
 * in agent/history.ts) so the model has time awareness, but they should never
 * appear in the UI. Format: [Mon DD, HH:MM] e.g. [Apr 8, 02:49]
 */
const TIMESTAMP_RE = /\[(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{2}:\d{2}\]\s*/g;

export function stripTimestamps(text: string): string {
  return text.replace(TIMESTAMP_RE, "");
}