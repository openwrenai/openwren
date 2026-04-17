import { useEffect, useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import {
  Clock,
  Bot,
  FileText,
  Database,
  Wifi,
  WifiOff,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Archive,
  DollarSign,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { api } from "@/lib/api.ts";
import type { StatusResponse, UsageSummary, ScheduleListResponse } from "@/lib/types.ts";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function formatNextRun(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < 0) return "overdue";

  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "< 1m";
  if (diffMin < 60) return `${diffMin}m`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ${diffMin % 60}m`;

  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today ${time}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;

  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [schedules, setSchedules] = useState<ScheduleListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [s, u, j] = await Promise.all([
        api.get<StatusResponse>("/api/status"),
        api.get<UsageSummary>("/api/usage?days=1"),
        api.get<ScheduleListResponse>("/api/schedules"),
      ]);
      setStatus(s);
      setUsage(u);
      setSchedules(j);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const today = todayKey();
  const todayUsage = usage?.days[today];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground/60 mt-1">System overview and health status.</p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Top stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Uptime</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground/50" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {status ? formatUptime(status.uptime) : "—"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Agents</CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground/50" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {status ? status.agentCount : "—"}
            </div>
            <p className="text-xs text-muted-foreground/50 mt-1">configured</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sessions</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground/50" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {status ? status.sessionCount : "—"}
            </div>
            <p className="text-xs text-muted-foreground/50 mt-1">active</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Memory Files</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground/50" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {status ? status.memoryFileCount : "—"}
            </div>
            <p className="text-xs text-muted-foreground/50 mt-1">across all agents</p>
          </CardContent>
        </Card>
      </div>

      {/* Token usage today + Channels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Token Usage Today</CardTitle>
          </CardHeader>
          <CardContent>
            {todayUsage ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <ArrowUpRight className="h-4 w-4 text-blue-400" />
                  <div>
                    <div className="text-lg font-semibold">{formatTokens(todayUsage.in)}</div>
                    <div className="text-xs text-muted-foreground/50">Input</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ArrowDownRight className="h-4 w-4 text-emerald-400" />
                  <div>
                    <div className="text-lg font-semibold">{formatTokens(todayUsage.out)}</div>
                    <div className="text-xs text-muted-foreground/50">Output</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Archive className="h-4 w-4 text-amber-400" />
                  <div>
                    <div className="text-lg font-semibold">{formatTokens(todayUsage.cachedIn ?? 0)}</div>
                    <div className="text-xs text-muted-foreground/50">Cached</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-purple-400" />
                  <div>
                    <div className="text-lg font-semibold">—</div>
                    <div className="text-xs text-muted-foreground/50">Est. cost</div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/40">No usage data yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Channels</CardTitle>
          </CardHeader>
          <CardContent>
            {status ? (
              <div className="space-y-3">
                {status.channels.map((ch) => (
                  <div key={ch.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {ch.configured ? (
                        <Wifi className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <WifiOff className="h-4 w-4 text-muted-foreground/30" />
                      )}
                      <span className="text-sm capitalize">{ch.name}</span>
                    </div>
                    {ch.configured ? (
                      <Badge variant="default" className="text-xs">Connected</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground/30">Not configured</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/40">Loading...</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Scheduled Jobs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Scheduled Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {schedules && schedules.jobs.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Job</TableHead>
                    <TableHead className="text-xs">Agent</TableHead>
                    <TableHead className="text-xs">Next Run</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.jobs.slice(0, 5).map((job) => (
                    <TableRow key={job.jobId}>
                      <TableCell className="text-sm font-medium">{job.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{job.agent}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatNextRun(job.nextRun)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={job.enabled ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {job.enabled ? "Active" : "Paused"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground/40">No scheduled jobs.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Agents</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground/50" />
          </CardHeader>
          <CardContent>
            {status && status.agents.length > 0 ? (
              <div className="space-y-3">
                {status.agents.slice(0, 10).map((agent) => (
                  <div key={agent.id} className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{agent.name}</div>
                      <div className="text-xs text-muted-foreground/50">
                        {agent.model ?? "default model"}
                      </div>
                    </div>
                  </div>
                ))}
                {status.agents.length > 10 && (
                  <Link to="/agents" className="text-xs text-muted-foreground hover:text-foreground transition-colors no-underline">
                    View all {status.agents.length} agents →
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/40">No agents configured.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
