import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { api } from "@/lib/api.ts";
import type { AgentFilesResponse, AgentFileContentResponse } from "@/lib/types.ts";

interface FilesTabProps {
  agentId: string;
  isManager: boolean;
}

/** Friendly display names for agent files. */
const FILE_LABELS: Record<string, string> = {
  "soul.md": "Soul",
  "heartbeat.md": "Heartbeat",
  "workflow.md": "Workflow",
};

export function FilesTab({ agentId, isManager }: FilesTabProps) {
  const [files, setFiles] = useState<AgentFilesResponse["files"]>([]);
  const [activeFile, setActiveFile] = useState<string>("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const originalContent = useRef("");

  // Fetch file list when agent changes
  useEffect(() => {
    let cancelled = false;
    api.get<AgentFilesResponse>(`/api/agents/${agentId}/files`).then((res) => {
      if (cancelled) return;
      // Filter: only show workflow.md for managers
      const visible = res.files.filter(
        (f) => f.name !== "workflow.md" || isManager
      );
      setFiles(visible);
      // Auto-select first file
      if (visible.length > 0 && (!activeFile || !visible.find((f) => f.name === activeFile))) {
        setActiveFile(visible[0].name);
      }
    });
    return () => { cancelled = true; };
  }, [agentId, isManager]);

  // Fetch file content when active file changes
  useEffect(() => {
    if (!activeFile) return;
    let cancelled = false;
    api.get<AgentFileContentResponse>(`/api/agents/${agentId}/files/${activeFile}`).then((res) => {
      if (cancelled) return;
      setContent(res.content);
      originalContent.current = res.content;
    });
    return () => { cancelled = true; };
  }, [agentId, activeFile]);

  const isDirty = content !== originalContent.current;

  async function handleSave() {
    setSaving(true);
    setToast(null);
    try {
      await api.put(`/api/agents/${agentId}/files/${activeFile}`, { content });
      originalContent.current = content;
      setToast({ type: "success", text: `${activeFile} saved` });
      // Refresh file list to update exists status
      const res = await api.get<AgentFilesResponse>(`/api/agents/${agentId}/files`);
      const visible = res.files.filter(
        (f) => f.name !== "workflow.md" || isManager
      );
      setFiles(visible);
    } catch {
      setToast({ type: "error", text: `Failed to save ${activeFile}` });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  function handleReset() {
    setContent(originalContent.current);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Core Files</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={activeFile} onValueChange={setActiveFile}>
          <TabsList>
            {files.map((f) => (
              <TabsTrigger key={f.name} value={f.name} className="gap-1.5">
                {FILE_LABELS[f.name] ?? f.name}
                {!f.exists && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 text-muted-foreground/50 font-normal">
                    MISSING
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {files.map((f) => (
            <TabsContent key={f.name} value={f.name} className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground/50 font-mono">
                  ~/.openwren/agents/{agentId}/{f.name}
                </p>
                <div className="flex gap-2">
                  {toast && activeFile === f.name && (
                    <span className={`text-xs self-center ${toast.type === "success" ? "text-green-400" : "text-red-400"}`}>
                      {toast.text}
                    </span>
                  )}
                  <Button variant="ghost" size="sm" onClick={handleReset} disabled={!isDirty}>
                    Reset
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={!isDirty || saving}>
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full min-h-[400px] bg-muted/30 border border-border rounded-md p-3 font-mono text-sm text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                spellCheck={false}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
