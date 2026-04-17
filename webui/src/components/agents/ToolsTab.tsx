import { useEffect, useState, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { Lock } from "lucide-react";
import { api } from "@/lib/api.ts";
import type { AgentTool, AgentToolsResponse } from "@/lib/types.ts";

interface ToolsTabProps {
  agentId: string;
}

export function ToolsTab({ agentId }: ToolsTabProps) {
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [role, setRole] = useState<"manager" | "worker" | null>(null);
  const [managedTeams, setManagedTeams] = useState<string[]>([]);
  const [memberTeams, setMemberTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Local toggle state (BASE tools only — manager/worker are always locked)
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [originalToggles, setOriginalToggles] = useState<Record<string, boolean>>({});

  // Override gate — controls whether BASE toggles are editable
  const [override, setOverride] = useState(false);
  const [originalOverride, setOriginalOverride] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const fetchTools = useCallback(async () => {
    try {
      const res = await api.get<AgentToolsResponse>(`/api/agents/${agentId}/tools`);
      setTools(res.tools);
      setRole(res.role);
      setManagedTeams(res.managedTeams);
      setMemberTeams(res.memberTeams);

      const t: Record<string, boolean> = {};
      for (const tool of res.tools) {
        if (tool.category === "base") t[tool.name] = tool.enabled;
      }
      setToggles(t);
      setOriginalToggles(t);

      // Override on if any BASE tool is disabled (agent already customized)
      const hasDisabled = res.tools.some((tool) => tool.category === "base" && !tool.enabled);
      setOverride(hasDisabled);
      setOriginalOverride(hasDisabled);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    setLoading(true);
    fetchTools();
  }, [fetchTools]);

  const baseTools = useMemo(() => tools.filter((t) => t.category === "base"), [tools]);
  const managerTools = useMemo(() => tools.filter((t) => t.category === "manager"), [tools]);
  const workerTools = useMemo(() => tools.filter((t) => t.category === "worker"), [tools]);

  const localDisabledCount = Object.values(toggles).filter((v) => !v).length;

  const isDirty = useMemo(() => {
    if (override !== originalOverride) return true;
    return Object.keys(toggles).some((k) => toggles[k] !== originalToggles[k]);
  }, [toggles, originalToggles, override, originalOverride]);

  function handleToggle(name: string, checked: boolean) {
    setToggles((prev) => ({ ...prev, [name]: checked }));
  }

  function handleEnableAll() {
    const next: Record<string, boolean> = {};
    for (const t of baseTools) next[t.name] = true;
    setToggles(next);
  }

  function handleDisableAll() {
    const next: Record<string, boolean> = {};
    for (const t of baseTools) next[t.name] = false;
    setToggles(next);
  }

  function handleOverrideChange(checked: boolean) {
    if (!checked && originalOverride) {
      // Unchecking while agent had disabled tools — confirm before wiping
      setClearConfirmOpen(true);
      return;
    }
    setOverride(checked);
    if (!checked) {
      // Re-enable everything locally so save clears the override
      const next: Record<string, boolean> = {};
      for (const t of baseTools) next[t.name] = true;
      setToggles(next);
    }
  }

  function handleConfirmClear() {
    setOverride(false);
    const next: Record<string, boolean> = {};
    for (const t of baseTools) next[t.name] = true;
    setToggles(next);
    setClearConfirmOpen(false);
  }

  async function handleSave() {
    setSaving(true);
    setToast(null);
    try {
      const entries: Record<string, { enabled: boolean }> = {};
      if (override) {
        for (const [name, enabled] of Object.entries(toggles)) {
          entries[name] = { enabled };
        }
      } else {
        // Override off → every BASE tool enabled
        for (const t of baseTools) {
          entries[t.name] = { enabled: true };
        }
      }

      const res = await api.patch<AgentToolsResponse>(`/api/agents/${agentId}/tools`, { entries });
      setTools(res.tools);
      setRole(res.role);
      setManagedTeams(res.managedTeams);
      setMemberTeams(res.memberTeams);

      const t: Record<string, boolean> = {};
      for (const tool of res.tools) {
        if (tool.category === "base") t[tool.name] = tool.enabled;
      }
      setToggles(t);
      setOriginalToggles(t);
      const hasDisabled = res.tools.some((tool) => tool.category === "base" && !tool.enabled);
      setOverride(hasDisabled);
      setOriginalOverride(hasDisabled);

      setToast({ type: "success", text: "Tools saved" });
    } catch {
      setToast({ type: "error", text: "Failed to save tools" });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-medium">Tools</h3>
          <p className="text-sm text-muted-foreground/60 mt-0.5">
            {tools.length} tools available
            {override && localDisabledCount > 0 && (
              <span className="ml-2 text-amber-400">
                Overridden — {localDisabledCount} disabled
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2 items-center shrink-0">
          {toast && (
            <span className={`text-xs ${toast.type === "success" ? "text-green-400" : "text-red-400"}`}>
              {toast.text}
            </span>
          )}
          <Button size="sm" className="text-xs" onClick={handleSave} disabled={!isDirty || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Override gate */}
      <Card>
        <CardContent className="px-4 py-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => handleOverrideChange(e.target.checked)}
              className="mt-0.5 rounded"
            />
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Override default tool access</div>
              <div className="text-xs text-muted-foreground/60">
                {override
                  ? "This agent will deviate from default tool access. Changes apply only to this agent."
                  : "By default, agents get all tools for their role. Enable to disable specific tools below."}
              </div>
            </div>
          </label>
        </CardContent>
      </Card>

      {/* BASE section */}
      {baseTools.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              Base
            </h4>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={handleEnableAll}
                disabled={!override}
              >
                Enable All
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={handleDisableAll}
                disabled={!override}
              >
                Disable All
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            {baseTools.map((tool) => {
              const enabled = toggles[tool.name] ?? true;
              return (
                <Card key={tool.name} className={!override ? "opacity-75" : ""}>
                  <CardContent className="px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1">
                        <h5 className="font-medium text-sm">{tool.name}</h5>
                        <p className="text-xs text-muted-foreground/60 leading-relaxed">
                          {tool.description || "No description"}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-2 pt-0.5">
                        {!override && <Lock className="h-3.5 w-3.5 text-muted-foreground/40" />}
                        <Switch
                          checked={enabled}
                          onCheckedChange={(checked) => handleToggle(tool.name, checked)}
                          disabled={!override}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* MANAGER section */}
      {managerTools.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              Manager
            </h4>
            {managedTeams.length > 0 && (
              <span className="text-xs text-muted-foreground/60">
                From team {managedTeams.join(", ")}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground/50 mb-3">
            These tools are controlled by team membership and cannot be overridden.
          </p>
          <div className="space-y-3">
            {managerTools.map((tool) => (
              <Card key={tool.name} className="opacity-75">
                <CardContent className="px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <h5 className="font-medium text-sm">{tool.name}</h5>
                      <p className="text-xs text-muted-foreground/60 leading-relaxed">
                        {tool.description || "No description"}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2 pt-0.5">
                      <Lock className="h-3.5 w-3.5 text-muted-foreground/40" />
                      <Switch checked={true} disabled />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* WORKER section */}
      {workerTools.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              Worker
            </h4>
            {memberTeams.length > 0 && (
              <span className="text-xs text-muted-foreground/60">
                Member of team {memberTeams.join(", ")}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground/50 mb-3">
            These tools are controlled by team membership and cannot be overridden.
          </p>
          <div className="space-y-3">
            {workerTools.map((tool) => (
              <Card key={tool.name} className="opacity-75">
                <CardContent className="px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <h5 className="font-medium text-sm">{tool.name}</h5>
                      <p className="text-xs text-muted-foreground/60 leading-relaxed">
                        {tool.description || "No description"}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2 pt-0.5">
                      <Lock className="h-3.5 w-3.5 text-muted-foreground/40" />
                      <Switch checked={true} disabled />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {!role && baseTools.length === tools.length && (
        <p className="text-xs text-muted-foreground/50 italic">
          Solo agent — no team memberships. Base tools only.
        </p>
      )}

      {/* Clear-override confirmation */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all tool overrides?</AlertDialogTitle>
            <AlertDialogDescription>
              This will re-enable every base tool for this agent and remove the per-agent override from config. Save to apply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClear}>Clear overrides</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
