import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import slugify from "slugify";
import { api } from "@/lib/api.ts";
import type { Team, AgentListItem } from "@/lib/types.ts";

interface TeamDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** If provided, dialog is in edit mode for this team. */
  team?: Team | null;
}

export function TeamDialog({ open, onClose, onSaved, team }: TeamDialogProps) {
  const isEdit = !!team;

  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [managerId, setManagerId] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await api.get<{ agents: AgentListItem[] }>("/api/agents");
      setAgents(res.agents);
    } catch {}
  }, []);

  // Init form when dialog opens or team changes
  useEffect(() => {
    if (!open) return;
    fetchAgents();
    setError("");
    if (team) {
      setDisplayName(team.displayName);
      setManagerId(team.manager.id);
      setMemberIds(team.members.map((m) => m.id));
    } else {
      setDisplayName("");
      setManagerId("");
      setMemberIds([]);
    }
  }, [open, team, fetchAgents]);

  function toSlug(val: string) {
    return slugify(val, { lower: true, strict: true, replacement: "_" });
  }

  function toggleMember(id: string) {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  const availableMembers = agents.filter((a) => a.id !== managerId);

  async function handleSave() {
    setError("");

    if (!displayName.trim()) {
      setError("Team name is required");
      return;
    }
    if (!managerId) {
      setError("Please select a manager");
      return;
    }

    const slug = toSlug(displayName);
    if (!isEdit && !slug) {
      setError("Team name must produce a valid ID (letters, numbers, underscores)");
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/api/teams/${team!.name}`, {
          displayName,
          managerId,
          memberIds,
        });
      } else {
        await api.post("/api/teams", {
          name: slug,
          displayName,
          managerId,
          memberIds,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save team";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${team!.displayName}` : "Create Team"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Display Name */}
          <div>
            <label className="text-sm font-medium text-foreground">Team Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Research Team"
              disabled={false}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {!isEdit && displayName && (
              <p className="text-xs text-muted-foreground/40 mt-1">
                ID: {toSlug(displayName)}
              </p>
            )}
            {isEdit && (
              <p className="text-xs text-muted-foreground/40 mt-1">
                ID: {team!.name}
              </p>
            )}
          </div>

          {/* Manager */}
          <div>
            <label className="text-sm font-medium text-foreground">Manager</label>
            <p className="text-xs text-muted-foreground/40 mt-0.5 mb-1.5">
              The agent that creates workflows and delegates tasks.
            </p>
            <select
              value={managerId}
              onChange={(e) => {
                setManagerId(e.target.value);
                setMemberIds((prev) => prev.filter((m) => m !== e.target.value));
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm capitalize focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select manager...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id} className="capitalize">
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Members */}
          <div>
            <label className="text-sm font-medium text-foreground">Members</label>
            <p className="text-xs text-muted-foreground/40 mt-0.5 mb-1.5">
              Agents that receive delegated tasks from the manager.
            </p>
            {availableMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground/40">
                {managerId ? "No other agents available" : "Select a manager first"}
              </p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {availableMembers.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50 cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={memberIds.includes(a.id)}
                      onCheckedChange={() => toggleMember(a.id)}
                    />
                    <span className="capitalize">{a.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Summary */}
          {managerId && memberIds.length > 0 && (
            <div className="text-xs text-muted-foreground/60">
              {memberIds.length} member{memberIds.length !== 1 ? "s" : ""} reporting to{" "}
              <span className="capitalize">{agents.find((a) => a.id === managerId)?.name ?? managerId}</span>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
