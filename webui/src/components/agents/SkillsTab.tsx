import { useEffect, useState, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { api } from "@/lib/api.ts";
import type { AgentSkill, AgentSkillsResponse } from "@/lib/types.ts";

interface SkillsTabProps {
  agentId: string;
}

export function SkillsTab({ agentId }: SkillsTabProps) {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [total, setTotal] = useState(0);
  const [enabledCount, setEnabledCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Track local toggle state (separate from server state for dirty tracking)
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [originalToggles, setOriginalToggles] = useState<Record<string, boolean>>({});

  const fetchSkills = useCallback(async () => {
    try {
      const res = await api.get<AgentSkillsResponse>(`/api/agents/${agentId}/skills`);
      setSkills(res.skills);
      setTotal(res.total);
      setEnabledCount(res.enabled);
      const t: Record<string, boolean> = {};
      for (const s of res.skills) t[s.name] = s.enabled;
      setToggles(t);
      setOriginalToggles(t);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    setLoading(true);
    fetchSkills();
  }, [fetchSkills]);

  // Compute source counts for filter badges
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of skills) {
      counts[s.source] = (counts[s.source] ?? 0) + 1;
    }
    return counts;
  }, [skills]);

  const sourceLabels: Record<string, string> = {
    bundled: "Bundled",
    global: "Global",
    "per-agent": "Agent",
  };

  const filtered = useMemo(() => {
    return skills.filter((s) => {
      if (sourceFilter && s.source !== sourceFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [skills, search, sourceFilter]);

  const localEnabledCount = Object.values(toggles).filter(Boolean).length;

  const isDirty = useMemo(() => {
    return Object.keys(toggles).some((k) => toggles[k] !== originalToggles[k]);
  }, [toggles, originalToggles]);

  function handleToggle(name: string, checked: boolean) {
    setToggles((prev) => ({ ...prev, [name]: checked }));
  }

  function handleEnableAll() {
    const next: Record<string, boolean> = {};
    for (const s of skills) next[s.name] = s.blocked ? false : true;
    setToggles(next);
  }

  function handleDisableAll() {
    const next: Record<string, boolean> = {};
    for (const s of skills) next[s.name] = false;
    setToggles(next);
  }

  async function handleSave() {
    setSaving(true);
    setToast(null);
    try {
      // Only send entries that changed
      const entries: Record<string, { enabled: boolean }> = {};
      for (const [name, enabled] of Object.entries(toggles)) {
        if (enabled !== originalToggles[name]) {
          entries[name] = { enabled };
        }
      }
      if (Object.keys(entries).length === 0) return;

      const res = await api.patch<AgentSkillsResponse>(`/api/agents/${agentId}/skills`, { entries });
      setSkills(res.skills);
      setTotal(res.total);
      setEnabledCount(res.enabled);
      const t: Record<string, boolean> = {};
      for (const s of res.skills) t[s.name] = s.enabled;
      setToggles(t);
      setOriginalToggles(t);
      setToast({ type: "success", text: "Skills saved" });
    } catch {
      setToast({ type: "error", text: "Failed to save skills" });
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-medium">Skills</h3>
          <p className="text-sm text-muted-foreground/60 mt-0.5">
            Per-agent skill list. {localEnabledCount}/{total} enabled.
          </p>
        </div>
        <div className="flex gap-2 items-center shrink-0">
          {toast && (
            <span className={`text-xs ${toast.type === "success" ? "text-green-400" : "text-red-400"}`}>
              {toast.text}
            </span>
          )}
          <Button variant="outline" size="sm" className="text-xs" onClick={handleEnableAll}>
            Enable All
          </Button>
          <Button variant="outline" size="sm" className="text-xs" onClick={handleDisableAll}>
            Disable All
          </Button>
          <Button size="sm" className="text-xs" onClick={handleSave} disabled={!isDirty || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Info banner */}
      {localEnabledCount === total && !isDirty && (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5">
          <p className="text-sm text-emerald-400">
            All skills are enabled. Disabling any skill will create a per-agent allowlist.
          </p>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-sm bg-muted/30 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <span className="text-xs text-muted-foreground/50">{filtered.length} shown</span>
      </div>

      {/* Source filter badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setSourceFilter(null)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            sourceFilter === null
              ? "bg-accent text-accent-foreground"
              : "bg-muted/30 text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50"
          }`}
        >
          All {total}
        </button>
        {Object.entries(sourceCounts).map(([source, count]) => (
          <button
            key={source}
            onClick={() => setSourceFilter(sourceFilter === source ? null : source)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              sourceFilter === source
                ? "bg-accent text-accent-foreground"
                : "bg-muted/30 text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {sourceLabels[source] ?? source} {count}
          </button>
        ))}
      </div>

      {/* Skill cards */}
      <div className="space-y-3">
        {filtered.map((skill) => (
          <Card key={skill.name} className={skill.blocked ? "opacity-60" : ""}>
            <CardContent className="px-4 py-1">
              <div className="flex items-start justify-between gap-4">
                {/* Left: info */}
                <div className="space-y-1.5 min-w-0">
                  <h4 className="font-medium text-sm">{skill.name}</h4>
                  <p className="text-xs text-muted-foreground/60 leading-relaxed">
                    {skill.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground/50">
                      {skill.source}
                    </Badge>
                    {skill.blocked && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-amber-400 border-amber-500/20">
                        blocked
                      </Badge>
                    )}
                  </div>
                  {skill.blocked && skill.blockReason && (
                    <p className="text-xs text-amber-400/70 mt-1">{skill.blockReason}</p>
                  )}
                </div>

                {/* Right: toggle */}
                <div className="shrink-0 pt-0.5">
                  <Switch
                    checked={toggles[skill.name] ?? false}
                    onCheckedChange={(checked) => handleToggle(skill.name, checked)}
                    disabled={skill.blocked}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground/40 text-center py-8">
          No skills match your search.
        </p>
      )}
    </div>
  );
}
