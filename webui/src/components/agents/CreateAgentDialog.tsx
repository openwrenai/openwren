import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { api } from "@/lib/api.ts";

interface CreateAgentDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (agentId: string) => void;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

export function CreateAgentDialog({ open, onClose, onCreated }: CreateAgentDialogProps) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState("worker");
  const [model, setModel] = useState("");
  const [useDefault, setUseDefault] = useState(true);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (!idManuallyEdited) {
      setId(slugify(value));
    }
  }

  function handleIdChange(value: string) {
    setId(value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
    setIdManuallyEdited(true);
  }

  function reset() {
    setId("");
    setName("");
    setDescription("");
    setRole("worker");
    setModel("");
    setUseDefault(true);
    setError("");
    setSubmitting(false);
    setIdManuallyEdited(false);
  }

  async function handleSubmit() {
    if (!id || !name) {
      setError("Agent ID and Name are required");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const body: Record<string, string> = { id, name };
      if (description) body.description = description;
      if (role) body.role = role;
      if (!useDefault && model) body.model = model;

      await api.post("/api/agents", body);
      reset();
      onCreated(id);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create agent";
      if (msg.includes("409")) {
        setError("Agent ID already exists");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Agent</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Agent ID</label>
            <input
              value={id}
              onChange={(e) => handleIdChange(e.target.value)}
              placeholder="e.g. analyst"
              className="w-full bg-muted/30 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground/50">Lowercase, no spaces</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Name</label>
            <input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Display name"
              className="w-full bg-muted/30 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              className="w-full bg-muted/30 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Role</label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="worker">worker</SelectItem>
                <SelectItem value="manager">manager</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useDefault}
                onChange={(e) => setUseDefault(e.target.checked)}
                className="rounded"
              />
              <span className="text-muted-foreground">Use default model</span>
            </label>
            {!useDefault && (
              <div className="flex gap-2">
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="provider/model"
                  className="flex-1 bg-muted/30 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setModelPickerOpen(true)}>
                  Browse
                </Button>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !id || !name}>
              {submitting ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>

        <ModelPicker
          open={modelPickerOpen}
          onClose={() => setModelPickerOpen(false)}
          onSelect={(m) => { setModel(m); setUseDefault(false); }}
        />
      </DialogContent>
    </Dialog>
  );
}
