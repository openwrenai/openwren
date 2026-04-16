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
import { Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api.ts";
import type { ConfigResponse } from "@/lib/types.ts";

interface AddProviderDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: (res: ConfigResponse) => void;
  configuredProviders: string[];
}

const PROVIDERS = [
  { key: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY" },
  { key: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
  { key: "google", label: "Google", envVar: "GOOGLE_API_KEY" },
  { key: "mistral", label: "Mistral", envVar: "MISTRAL_API_KEY" },
  { key: "groq", label: "Groq", envVar: "GROQ_API_KEY" },
  { key: "xai", label: "xAI", envVar: "XAI_API_KEY" },
  { key: "deepseek", label: "DeepSeek", envVar: "DEEPSEEK_API_KEY" },
  { key: "ollama", label: "Ollama", envVar: null },
  { key: "llmgateway", label: "LLM Gateway", envVar: "LLM_GATEWAY_API_KEY" },
] as const;

export function AddProviderDialog({ open, onClose, onAdded, configuredProviders }: AddProviderDialogProps) {
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const available = PROVIDERS.filter((p) => !configuredProviders.includes(p.key));
  const selected = PROVIDERS.find((p) => p.key === provider);
  const isOllama = provider === "ollama";

  function reset() {
    setProvider("");
    setApiKey("");
    setBaseUrl("http://localhost:11434");
    setVisible(false);
    setError("");
    setSubmitting(false);
  }

  async function handleSubmit() {
    if (!provider) {
      setError("Select a provider");
      return;
    }
    if (!isOllama && !apiKey) {
      setError("API key is required");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const body: Record<string, string> = { provider };
      if (isOllama) {
        body.baseUrl = baseUrl;
      } else {
        body.apiKey = apiKey;
      }

      const res = await api.post<ConfigResponse>("/api/config/provider", body);
      reset();
      onAdded(res);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add provider";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Provider</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Provider select */}
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Provider</label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select provider..." />
              </SelectTrigger>
              <SelectContent>
                {available.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* API key or base URL */}
          {provider && (
            isOllama ? (
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Base URL</label>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full bg-muted/30 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">API Key</label>
                <div className="relative">
                  <input
                    type={visible ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste your API key"
                    className="w-full bg-muted/30 border border-border rounded-md px-3 py-1.5 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setVisible(!visible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground"
                  >
                    {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )
          )}

          {/* Preview */}
          {provider && selected && !isOllama && (
            <div className="rounded-md bg-muted/30 border border-border px-3 py-2.5">
              <p className="text-xs text-muted-foreground/50 mb-1.5">Will be saved as:</p>
              <p className="text-xs font-mono text-muted-foreground">
                <span className="text-foreground/70">.env</span>
                {" \u2192 "}
                {selected.envVar}=<span className="text-muted-foreground/40">{apiKey ? "\u2022".repeat(Math.min(apiKey.length, 12)) : "..."}</span>
              </p>
              <p className="text-xs font-mono text-muted-foreground mt-1">
                <span className="text-foreground/70">config</span>
                {" \u2192 "}
                {`providers.${provider}.apiKey: `}
                <span className="text-emerald-400">{`"\${env:${selected.envVar}}"`}</span>
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !provider || (!isOllama && !apiKey)}
            >
              {submitting ? "Adding..." : "Add"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
