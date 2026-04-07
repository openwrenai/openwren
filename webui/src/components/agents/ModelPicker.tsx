import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { api } from "@/lib/api.ts";

interface ModelsResponse {
  defaultModel: string;
  providers: Array<{ id: string; models: string[] }>;
}

interface ModelPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (model: string) => void;
}

export function ModelPicker({ open, onClose, onSelect }: ModelPickerProps) {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [search, setSearch] = useState("");
  const [customModel, setCustomModel] = useState("");

  useEffect(() => {
    if (open && !data) {
      api.get<ModelsResponse>("/api/models").then(setData);
    }
  }, [open, data]);

  if (!open) return null;

  const filtered = data?.providers
    .map((p) => ({
      ...p,
      models: p.models.filter((m) =>
        !search || p.id.includes(search.toLowerCase()) || m.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((p) => p.models.length > 0);

  function handleSelect(providerId: string, model: string) {
    onSelect(`${providerId}/${model}`);
    onClose();
  }

  function handleCustom() {
    if (customModel.trim()) {
      onSelect(customModel.trim());
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Model</DialogTitle>
        </DialogHeader>

        <input
          type="text"
          placeholder="Search models..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-muted/30 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          autoFocus
        />

        <div className="flex-1 overflow-y-auto space-y-4 mt-2 min-h-0">
          {!data && <p className="text-sm text-muted-foreground">Loading...</p>}
          {filtered?.map((provider) => (
            <div key={provider.id}>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                {provider.id}
              </p>
              <div className="space-y-0.5">
                {provider.models.map((model) => (
                  <button
                    key={model}
                    onClick={() => handleSelect(provider.id, model)}
                    className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted/50 transition-colors"
                  >
                    {model}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-3 mt-2">
          <p className="text-xs text-muted-foreground mb-2">For models not listed above</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="provider/model"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCustom(); }}
              className="flex-1 bg-muted/30 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button size="sm" onClick={handleCustom} disabled={!customModel.trim()}>
              Use
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
