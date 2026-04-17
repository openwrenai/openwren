import { useEffect, useState, useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Button } from "@/components/ui/button.tsx";
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
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api.ts";
import type { Agent, AgentListItem, AgentListResponse } from "@/lib/types.ts";
import { OverviewTab } from "@/components/agents/OverviewTab.tsx";
import { FilesTab } from "@/components/agents/FilesTab.tsx";
import { CreateAgentDialog } from "@/components/agents/CreateAgentDialog.tsx";
import { CronJobsTab } from "@/components/agents/CronJobsTab.tsx";
import { SkillsTab } from "@/components/agents/SkillsTab.tsx";
import { ToolsTab } from "@/components/agents/ToolsTab.tsx";
import { ChannelsTab } from "@/components/agents/ChannelsTab.tsx";

function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function Agents() {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const fetchAgents = useCallback(async () => {
    try {
      const res = await api.get<AgentListResponse>("/api/agents");
      setAgents(res.agents);
      setSelectedId((prev) => {
        if (!prev || !res.agents.find((a) => a.id === prev)) {
          return res.agents[0]?.id ?? "";
        }
        return prev;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch agent detail when selection changes
  const fetchAgentDetail = useCallback(async (id: string) => {
    if (!id) { setSelectedAgent(null); return; }
    try {
      const agent = await api.get<Agent>(`/api/agents/${id}`);
      setSelectedAgent(agent);
    } catch {
      setSelectedAgent(null);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    fetchAgentDetail(selectedId);
  }, [selectedId, fetchAgentDetail]);

  async function handleDelete() {
    if (!selectedId) return;
    setDeleteError("");
    try {
      await api.delete(`/api/agents/${selectedId}`);
      setDeleteOpen(false);
      setSelectedId("");
      setSelectedAgent(null);
      await fetchAgents();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete agent";
      if (msg.includes("400")) {
        setDeleteError("Cannot delete — agent is referenced in a team. Remove from team first.");
      } else {
        setDeleteError(msg);
      }
    }
  }

  async function handleUpdated() {
    await fetchAgents();
    await fetchAgentDetail(selectedId);
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Agents</h1>
        <p className="text-muted-foreground/60 mt-1">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Agents</h1>
        <p className="text-muted-foreground/60 mt-1">Manage your AI agents, models, and soul files.</p>
      </div>

      {/* Agent picker row */}
      <div className="flex items-center gap-3 mb-6">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select an agent">
              {(value) => {
                const a = agents.find((x) => x.id === value);
                return a ? capitalizeFirst(a.name) : "Select an agent";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {capitalizeFirst(a.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New Agent
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-destructive"
          onClick={() => { setDeleteError(""); setDeleteOpen(true); }}
          disabled={!selectedAgent}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </div>

      {/* Tabs */}
      {selectedAgent && (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="channels">Channels</TabsTrigger>
            <TabsTrigger value="cron">Cron Jobs</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6">
            <OverviewTab key={selectedAgent.id} agent={selectedAgent} onUpdated={handleUpdated} />
          </TabsContent>

          <TabsContent value="files" className="mt-6">
            <FilesTab agentId={selectedAgent.id} isManager={selectedAgent.isManager} />
          </TabsContent>

          <TabsContent value="skills" className="mt-6">
            <SkillsTab agentId={selectedAgent.id} />
          </TabsContent>

          <TabsContent value="tools" className="mt-6">
            <ToolsTab key={selectedAgent.id} agentId={selectedAgent.id} />
          </TabsContent>

          <TabsContent value="channels" className="mt-6">
            <ChannelsTab agentId={selectedAgent.id} agentName={selectedAgent.name} />
          </TabsContent>

          <TabsContent value="cron" className="mt-6">
            <CronJobsTab agentId={selectedAgent.id} agentName={selectedAgent.name} />
          </TabsContent>
        </Tabs>
      )}

      {/* Create Agent Dialog */}
      <CreateAgentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(newId) => {
          setSelectedId(newId);
          fetchAgents();
        }}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedAgent?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the agent from your configuration. Soul file and memory are preserved on disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
