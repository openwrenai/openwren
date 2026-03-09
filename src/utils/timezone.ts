/**
 * Timezone utility functions.
 *
 * JavaScript has no built-in getUtcOffset(timezone) or "parse this string
 * in a specific IANA timezone" function. These helpers use Intl.DateTimeFormat
 * to bridge that gap — they work regardless of the server's system timezone
 * and handle DST transitions automatically.
 */

/**
 * Convert a local datetime string to UTC milliseconds.
 *
 * Given "2026-03-10T23:40:00" in "Europe/Stockholm", returns the UTC ms
 * for that exact moment (Mar 10 22:40 UTC, since Stockholm is UTC+1).
 *
 * JavaScript has no getUtcOffset(timezone) function, so we use an Intl
 * round-trip: intentionally create a "wrong" UTC timestamp, ask Intl what
 * that instant looks like in the target timezone, and measure the gap.
 * That gap is the timezone offset. Works for any timezone, any server
 * location, and handles DST transitions.
 *
 * Example: localToUtcMs("2026-03-10T23:40:00", "Europe/Stockholm")
 *   Step 1: Pretend 23:40 is UTC → guessMs = Mar 10 23:40 UTC
 *   Step 2: Intl says guessMs in Stockholm = Mar 11 00:40 (UTC+1 shifts it forward)
 *   Step 3: Offset = 00:40(observed) - 23:40(guess) = +1h
 *           Real UTC = 23:40 - 1h = 22:40 UTC ✓
 *
 * @param localDateTime - Bare datetime string "YYYY-MM-DDTHH:MM:SS" (no timezone suffix)
 * @param timezone - IANA timezone string (e.g. "Europe/Stockholm", "America/New_York")
 * @returns UTC milliseconds (suitable for setTimeout, Date comparison, etc.)
 */
export function localToUtcMs(localDateTime: string, timezone: string): number {
  const [datePart, timePart] = localDateTime.split("T");
  if (!datePart || !timePart) {
    throw new Error(`Invalid datetime: "${localDateTime}" — expected YYYY-MM-DDTHH:MM:SS`);
  }
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);

  // Step 1: Create a UTC timestamp treating the local time components as if
  // they were UTC. This is intentionally wrong — it's a reference point for
  // offset calculation. Date.UTC() is always UTC regardless of server timezone.
  const guessMs = Date.UTC(year, month - 1, day, hour, minute, second || 0);

  // Step 2: Ask Intl what this UTC instant looks like in the target timezone.
  // The difference between what we put in and what Intl observes IS the offset.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(guessMs));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);

  // Reconstruct the observed local time as a UTC-based ms value for comparison.
  // Using full date+time (not just hours) avoids midnight-crossing bugs.
  const h = get("hour") === 24 ? 0 : get("hour"); // Intl may return 24 for midnight
  const observedMs = Date.UTC(get("year"), get("month") - 1, get("day"), h, get("minute"), get("second"));

  // Step 3: offset = observed - guess. Subtract offset from guess to get real UTC.
  const offsetMs = observedMs - guessMs;
  return guessMs - offsetMs;
}

/**
 * Get the current time in a specific IANA timezone as an "HH:MM" string.
 *
 * Uses Intl.DateTimeFormat instead of Date methods because the server's
 * system timezone may differ from the target timezone.
 * Example: server in UTC, timezone = "Europe/Stockholm" → returns Stockholm time.
 */
export function currentTimeInTimezone(timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date());
}

/**
 * Check if the current time falls within an active hours window.
 *
 * Both start and end are "HH:MM" strings in the given timezone.
 * Empty strings mean no restriction (always active).
 */
export function isWithinActiveHours(start: string, end: string, timezone: string): boolean {
  if (!start || !end) return true;

  const now = currentTimeInTimezone(timezone);
  // Simple string comparison works because HH:MM is zero-padded
  return now >= start && now < end;
}
