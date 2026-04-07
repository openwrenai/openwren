import { useEffect, useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
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
import { Plus, Trash2, Pencil, Crown, Users, ChevronRight } from "lucide-react";
import { api } from "@/lib/api.ts";
import type { Team, TeamListResponse } from "@/lib/types.ts";
import { TeamDialog } from "@/components/teams/TeamDialog.tsx";

// ---------------------------------------------------------------------------
// Hierarchy helpers
// ---------------------------------------------------------------------------

interface HierarchyNode {
  teamName: string;
  displayName: string;
  manager: { id: string; name: string };
  members: Array<{ id: string; name: string }>;
  subTeams: HierarchyNode[];
}

function buildHierarchy(teams: Team[]): HierarchyNode[] {
  // Build a map of agent ID -> team they manage
  const managedBy = new Map<string, Team>();
  for (const t of teams) {
    managedBy.set(t.manager.id, t);
  }

  // Find which teams are sub-teams (their manager is a member of another team)
  const subTeamNames = new Set<string>();
  for (const t of teams) {
    for (const member of t.members) {
      const subTeam = managedBy.get(member.id);
      if (subTeam) {
        subTeamNames.add(subTeam.name);
      }
    }
  }

  function buildNode(team: Team): HierarchyNode {
    const subTeams: HierarchyNode[] = [];
    for (const member of team.members) {
      const subTeam = managedBy.get(member.id);
      if (subTeam) {
        subTeams.push(buildNode(subTeam));
      }
    }
    return {
      teamName: team.name,
      displayName: team.displayName,
      manager: team.manager,
      members: team.members,
      subTeams,
    };
  }

  // Top-level = teams not appearing as sub-teams
  const roots: HierarchyNode[] = [];
  for (const t of teams) {
    if (!subTeamNames.has(t.name)) {
      roots.push(buildNode(t));
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Hierarchy card (recursive)
// ---------------------------------------------------------------------------

function HierarchyCard({ node, depth = 0 }: { node: HierarchyNode; depth?: number }) {
  const regularMembers = node.members.filter(
    (m) => !node.subTeams.some((st) => st.manager.id === m.id)
  );
  const subManagerIds = new Set(node.subTeams.map((st) => st.manager.id));

  return (
    <div className={depth > 0 ? "ml-8 mt-3" : ""}>
      <Card>
        <CardContent className="px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Crown className="h-4 w-4 text-amber-400" />
            <span className="font-medium text-[15px] capitalize">{node.manager.name}</span>
            <Badge variant="outline" className="text-xs">
              manager
            </Badge>
            <Badge variant="outline" className="h-auto text-[13px] font-semibold text-foreground/70 px-3 py-1 rounded-md ml-auto">{node.displayName}</Badge>
          </div>
          {node.members.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-[15px]">
              {node.members.map((m) => (
                <Badge
                  key={m.id}
                  variant="outline"
                  className={`h-auto text-[13px] px-3 py-1 rounded-md capitalize ${
                    subManagerIds.has(m.id)
                      ? "text-amber-400 border-amber-500/30"
                      : "text-foreground/90"
                  }`}
                >
                  {subManagerIds.has(m.id) && <Crown className="h-3.5 w-3.5 mr-1 text-amber-400" />}
                  {m.name}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {node.subTeams.map((st) => (
        <HierarchyCard key={st.teamName} node={st} depth={depth + 1} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teams page
// ---------------------------------------------------------------------------

export function Teams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const fetchTeams = useCallback(async () => {
    try {
      const res = await api.get<TeamListResponse>("/api/teams");
      setTeams(res.teams);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  function openCreate() {
    setEditingTeam(null);
    setDialogOpen(true);
  }

  function openEdit(team: Team) {
    setEditingTeam(team);
    setDialogOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteError("");
    try {
      await api.delete(`/api/teams/${deleteTarget.name}`);
      setDeleteTarget(null);
      await fetchTeams();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete team";
      setDeleteError(msg);
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Teams</h1>
        <p className="text-muted-foreground/60 mt-1">Loading...</p>
      </div>
    );
  }

  const hierarchy = buildHierarchy(teams);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Teams</h1>
        <p className="text-muted-foreground/60 mt-1">
          Create and manage agent teams with delegation hierarchies.
        </p>
      </div>

      <Tabs defaultValue="teams">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="teams">Teams</TabsTrigger>
            <TabsTrigger value="hierarchy">Hierarchy</TabsTrigger>
          </TabsList>

          <Button variant="outline" size="sm" className="gap-1.5" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New Team
          </Button>
        </div>

        {/* Teams tab */}
        <TabsContent value="teams">
          {teams.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground/40">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No teams configured yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {teams.map((team) => (
                <Card
                  key={team.name}
                  className="cursor-pointer hover:border-border/80 transition-colors"
                  onClick={() => openEdit(team)}
                >
                  <CardContent className="px-4 py-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Users className="h-4 w-4 text-muted-foreground/40" />
                          <h4 className="font-medium text-[15px]">{team.displayName}</h4>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-[15px]">
                          <Badge
                            variant="outline"
                            className="h-auto text-[13px] px-3 py-1 rounded-md text-foreground/90 capitalize"
                          >
                            <Crown className="h-3.5 w-3.5 mr-1 text-amber-400" />
                            {team.manager.name}
                          </Badge>
                          {team.members.slice(0, 5).map((m) => (
                            <Badge
                              key={m.id}
                              variant="outline"
                              className="h-auto text-[13px] px-3 py-1 rounded-md text-foreground/90 capitalize"
                            >
                              {m.name}
                            </Badge>
                          ))}
                          {team.members.length > 5 && (
                            <Badge
                              variant="outline"
                              className="h-auto text-[13px] px-3 py-1 rounded-md text-muted-foreground/60 capitalize"
                            >
                              +{team.members.length - 5}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(team);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteError("");
                            setDeleteTarget(team);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Hierarchy tab */}
        <TabsContent value="hierarchy">
          {hierarchy.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground/40">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No teams to visualize.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {hierarchy.map((node) => (
                <HierarchyCard key={node.teamName} node={node} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Team Dialog (create / edit) */}
      <TeamDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={fetchTeams}
        team={editingTeam}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete team "{deleteTarget?.displayName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the team configuration. Agent roles will be cleared if they're
              no longer part of any team. Workflow files on disk are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
