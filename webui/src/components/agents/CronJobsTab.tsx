import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Play, Pause, Zap, Clock, Calendar, Timer } from "lucide-react";
import { api } from "@/lib/api.ts";
import type { ScheduleListResponse, ScheduleJob } from "@/lib/types.ts";

interface CronJobsTabProps {
  agentId: string;
  agentName: string;
}

interface RunEntry {
  ts: number;
  status: "ok" | "error";
  durationMs: number;
  error?: string;
}

interface RunHistoryResponse {
  jobId: string;
  runs: RunEntry[];
}

function formatSchedule(schedule: ScheduleJob["schedule"]): { label: string; icon: typeof Clock } {
  if (schedule.cron) return { label: schedule.cron, icon: Clock };
  if (schedule.every) return { label: `Every ${schedule.every}`, icon: Timer };
  if (schedule.at) {
    const d = new Date(schedule.at);
    return { label: `At ${d.toLocaleString()}`, icon: Calendar };
  }
  return { label: "Unknown", icon: Clock };
}

function formatNextRun(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < 0) return "overdue";
  if (diffMs < 60_000) return "< 1 min";
  if (diffMs < 3_600_000) return `in ${Math.round(diffMs / 60_000)} min`;
  if (diffMs < 86_400_000) {
    const h = Math.floor(diffMs / 3_600_000);
    const m = Math.round((diffMs % 3_600_000) / 60_000);
    return `in ${h}h ${m}m`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatRunTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function CronJobsTab({ agentId, agentName }: CronJobsTabProps) {
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Record<string, RunEntry[]>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await api.get<ScheduleListResponse>("/api/schedules");
      setJobs(res.jobs.filter((j) => j.agent === agentId));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  async function fetchHistory(jobId: string) {
    if (runHistory[jobId]) return;
    try {
      const res = await api.get<RunHistoryResponse>(`/api/schedules/${jobId}/history`);
      setRunHistory((prev) => ({ ...prev, [jobId]: res.runs.slice(-5).reverse() }));
    } catch {
      setRunHistory((prev) => ({ ...prev, [jobId]: [] }));
    }
  }

  function toggleExpand(jobId: string) {
    if (expandedJob === jobId) {
      setExpandedJob(null);
    } else {
      setExpandedJob(jobId);
      fetchHistory(jobId);
    }
  }

  async function handleAction(jobId: string, action: "enable" | "disable" | "run") {
    setActionLoading(jobId);
    try {
      await api.post(`/api/schedules/${jobId}/${action}`);
      await fetchJobs();
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground/40">
          Loading...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-base font-medium">Cron Jobs</h3>
          <p className="text-sm text-muted-foreground/60 mt-0.5">
            {jobs.length > 0
              ? `${jobs.length} job${jobs.length > 1 ? "s" : ""} assigned to ${agentName}`
              : `No scheduled jobs for ${agentName}`}
          </p>
        </div>
      </div>

      {jobs.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground/40">
            No scheduled jobs for this agent.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
      {jobs.map((job) => {
        const sched = formatSchedule(job.schedule);
        const ScheduleIcon = sched.icon;
        const isExpanded = expandedJob === job.jobId;
        const history = runHistory[job.jobId];

        return (
          <Card
            key={job.jobId}
            className="cursor-pointer transition-colors hover:bg-muted/20"
            onClick={() => toggleExpand(job.jobId)}
          >
            <CardContent className="px-4 py-1">
              {/* Main row */}
              <div className="flex items-start justify-between gap-4">
                {/* Left: name + badges */}
                <div className="space-y-2.5 min-w-0">
                  <h4 className="font-medium text-sm">{job.name}</h4>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="text-xs font-normal gap-1">
                      <ScheduleIcon className="h-3 w-3" />
                      {sched.label}
                    </Badge>
                    <Badge
                      variant={job.enabled ? "default" : "secondary"}
                      className={`text-xs ${job.enabled ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : ""}`}
                    >
                      {job.enabled ? "enabled" : "disabled"}
                    </Badge>
                    {job.isolated && (
                      <Badge variant="outline" className="text-xs font-normal text-muted-foreground/60">
                        isolated
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Right: next run + actions */}
                <div className="text-right shrink-0 space-y-2">
                  <div className="text-xs text-muted-foreground/60 space-y-0.5">
                    <div>next {formatNextRun(job.nextRun)}</div>
                  </div>
                  <div className="flex gap-1.5 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={actionLoading === job.jobId}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAction(job.jobId, "run");
                      }}
                    >
                      <Zap className="h-3 w-3" />
                      Run Now
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={actionLoading === job.jobId}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAction(job.jobId, job.enabled ? "disable" : "enable");
                      }}
                    >
                      {job.enabled ? (
                        <><Pause className="h-3 w-3" /> Disable</>
                      ) : (
                        <><Play className="h-3 w-3" /> Enable</>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Expanded: prompt + history */}
              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-border space-y-4">
                  {/* Prompt */}
                  <div>
                    <p className="text-xs text-muted-foreground/50 mb-1">Prompt</p>
                    <p className="text-sm text-muted-foreground bg-muted/30 rounded-md px-3 py-2 whitespace-pre-wrap">
                      {job.prompt}
                    </p>
                  </div>

                  {/* Channel */}
                  <div className="flex gap-6 text-xs">
                    <div>
                      <span className="text-muted-foreground/50">Channel: </span>
                      <span className="text-muted-foreground">{job.channel}</span>
                    </div>
                  </div>

                  {/* Run history */}
                  <div>
                    <p className="text-xs text-muted-foreground/50 mb-2">Recent Runs</p>
                    {!history ? (
                      <p className="text-xs text-muted-foreground/40">Loading...</p>
                    ) : history.length === 0 ? (
                      <p className="text-xs text-muted-foreground/40">No runs yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {history.map((run, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-4 text-xs py-1"
                          >
                            <span className="text-muted-foreground/60 w-32 shrink-0">
                              {formatRunTime(run.ts)}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${
                                run.status === "ok"
                                  ? "text-emerald-400 border-emerald-500/20"
                                  : "text-red-400 border-red-500/20"
                              }`}
                            >
                              {run.status}
                            </Badge>
                            <span className="text-muted-foreground/50">
                              {formatDuration(run.durationMs)}
                            </span>
                            {run.error && (
                              <span className="text-red-400/70 truncate">{run.error}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      </div>
    </div>
  );
}
