// ---------------------------------------------------------------------------
// Prompt injection detection for untrusted web content
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+a/i,
  /disregard\s+(all\s+)?(prior|previous|above)/i,
  /new\s+system\s+prompt/i,
  /forget\s+(everything|all|your)\s+(you|instructions|rules)/i,
  /override\s+(your|all|the)\s+(instructions|rules|guidelines)/i,
  /act\s+as\s+if\s+you\s+have\s+no\s+restrictions/i,
  /pretend\s+(you\s+are|to\s+be)\s+a\s+different/i,
];

/**
 * Scans text for known prompt injection patterns.
 * Returns the matched phrase if found, null if clean.
 */
export function detectInjection(text: string): string | null {
  for (const pattern of INJECTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Soft patterns — suspicious but not conclusive. Logged, not blocked.
// ---------------------------------------------------------------------------

const SOFT_PATTERNS = [
  /\b(list|show|reveal|output|print|display)\b.{0,20}\b(tools|skills|functions|capabilities|system prompt|instructions)\b/i,
  /\b(what|tell me)\b.{0,20}\b(your|the)\b.{0,20}\b(tools|skills|system prompt|instructions|rules)\b/i,
  /\bdo not\b.{0,20}\b(mention|tell|say|reveal)\b.{0,20}\b(untrusted|injection|security|blocked)\b/i,
  /\brespond (only |directly )?in\b.{0,20}\b(json|xml|code|base64)\b/i,
];

/**
 * Scans text for suspicious patterns that might be injection attempts.
 * Returns the matched phrase if found, null if clean.
 * Callers should log but NOT block — these are too ambiguous to reject.
 */
export function detectSuspicious(text: string): string | null {
  for (const pattern of SOFT_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Untrusted content delimiters
// ---------------------------------------------------------------------------

const BEGIN = "[BEGIN UNTRUSTED WEB CONTENT]";
const END = "[END UNTRUSTED WEB CONTENT]";

/**
 * Wraps text in untrusted content delimiters so the LLM can distinguish
 * trusted instructions from external web content.
 */
export function wrapUntrusted(text: string): string {
  return `${BEGIN}\n${text}\n${END}`;
}
