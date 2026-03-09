---
name: scheduling
description: Create and manage scheduled jobs — reminders, recurring tasks, morning briefings
autoload: false
---

# Scheduling

You can create, list, update, and delete scheduled jobs using the `manage_schedule` tool.

## When to Use

- User asks for a reminder ("remind me to...", "alert me when...")
- User wants a recurring task ("every morning at 8am...", "twice a week...")
- User asks about their existing schedules ("what do I have scheduled?", "show my jobs")

## Before Creating a Schedule

Always confirm these details with the user before calling the tool:

1. **Timing** — when and how often? (daily at 8am, every 2 hours, once on March 15)
2. **What to do** — the prompt/instruction you'll receive when the job fires
3. **Channel** — where to deliver (telegram, discord)

Do NOT create a schedule without the user confirming these details.

## Schedule Formats

**Cron** (most flexible — use for complex patterns):
- `0 8 * * *` — every day at 8am
- `0 8 * * 1-5` — weekdays at 8am
- `0 8,20 * * *` — twice daily (8am and 8pm)
- `0 9 * * 1` — every Monday at 9am
- `0 9 * * 1,4` — Monday and Thursday at 9am
- `0 10 1 * *` — 1st of every month at 10am
- `0 10 1,15 * *` — 1st and 15th at 10am
- `0 8-22/2 * * *` — every 2 hours between 8am and 10pm

**Interval** (simple repeating):
- `30m` — every 30 minutes
- `2h` — every 2 hours
- `1d` — every day

**One-shot** (fires once):
- `2026-03-15T09:00:00` — specific date and time (in user's timezone)

## Examples

**Morning briefing:**
```json
{ "action": "create", "name": "Morning briefing", "schedule": { "cron": "0 8 * * 1-5" }, "prompt": "Check my memory files for deadlines and projects. Give me a brief morning update.", "channel": "telegram" }
```

**Water reminder:**
```json
{ "action": "create", "name": "Water reminder", "schedule": { "every": "2h" }, "prompt": "Remind me to drink water. Be brief and vary the message.", "channel": "telegram" }
```

**One-time reminder:**
```json
{ "action": "create", "name": "Dentist reminder", "schedule": { "at": "2026-03-14T20:00:00" }, "prompt": "Remind me I have a dentist appointment tomorrow at 10am.", "channel": "telegram", "deleteAfterRun": true }
```

## Managing Jobs

- `{ "action": "list" }` — show all scheduled jobs
- `{ "action": "enable", "jobId": "morning-briefing" }` — re-enable a disabled job
- `{ "action": "disable", "jobId": "morning-briefing" }` — pause a job
- `{ "action": "delete", "jobId": "morning-briefing" }` — permanently remove a job
