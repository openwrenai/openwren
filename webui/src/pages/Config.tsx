import { useEffect, useState, useCallback, useRef } from "react";
// Tabs imports kept for when Raw tab is re-enabled
// import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { ChevronDown, ChevronRight, Eye, EyeOff, X, Plus } from "lucide-react";
import { api } from "@/lib/api.ts";
import type { ConfigResponse, ConfigRawResponse } from "@/lib/types.ts";
import { AddProviderDialog } from "@/components/config/AddProviderDialog.tsx";
import { ModelPicker } from "@/components/agents/ModelPicker.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INPUT_CLS =
  "bg-muted/30 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring w-full max-w-md";

const MASK = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

// Provider definitions
const PROVIDERS = [
  { key: "anthropic", label: "Anthropic", field: "apiKey" },
  { key: "openai", label: "OpenAI", field: "apiKey" },
  { key: "google", label: "Google", field: "apiKey" },
  { key: "mistral", label: "Mistral", field: "apiKey" },
  { key: "groq", label: "Groq", field: "apiKey" },
  { key: "xai", label: "xAI", field: "apiKey" },
  { key: "deepseek", label: "DeepSeek", field: "apiKey" },
  { key: "ollama", label: "Ollama", field: "baseUrl" },
  { key: "llmgateway", label: "LLM Gateway", field: "apiKey" },
] as const;

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen(!open)}
      >
        <CardTitle className="text-base flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
          )}
          {title}
        </CardTitle>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Masked input (password toggle)
// ---------------------------------------------------------------------------

function MaskedInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative max-w-md">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={INPUT_CLS}
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tag list (for roles)
// ---------------------------------------------------------------------------

function TagList({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function handleAdd() {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput("");
  }

  return (
    <div className="space-y-2 max-w-md">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 text-xs text-foreground"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-muted-foreground/40 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={placeholder}
          className={INPUT_CLS}
        />
        <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form Row helper
// ---------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <label className="text-muted-foreground text-sm">{label}</label>
      <div>{children}</div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Config page
// ---------------------------------------------------------------------------

export function Config() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [defaults, setDefaults] = useState<Record<string, unknown>>({});
  const [sensitiveKeys, setSensitiveKeys] = useState<string[]>([]);
  const [original, setOriginal] = useState<Record<string, unknown>>({});
  const [toast, setToast] = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Add provider dialog
  const [addProviderOpen, setAddProviderOpen] = useState(false);

  // Model picker
  const [modelPickerTarget, setModelPickerTarget] = useState<"model" | "fallback" | null>(null);

  // Raw tab state
  const [rawContent, setRawContent] = useState("");
  const [rawOriginal, setRawOriginal] = useState("");
  const [rawError, setRawError] = useState("");
  const [rawSaving, setRawSaving] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  function showToast(type: "success" | "error" | "warn", text: string) {
    setToast({ type, text });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  // ---- Fetch ----

  const fetchConfig = useCallback(async () => {
    try {
      const res = await api.get<ConfigResponse>("/api/config");
      setData(res.config);
      setDefaults(res.defaults ?? {});
      setOriginal(structuredClone(res.config));
      setSensitiveKeys(res._meta.sensitiveKeys);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRaw = useCallback(async () => {
    const res = await api.get<ConfigRawResponse>("/api/config/raw");
    setRawContent(res.content);
    setRawOriginal(res.content);
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchRaw();
  }, [fetchConfig, fetchRaw]);

  // ---- Data accessors ----

  /** Get raw value from config (file only, no defaults). */
  function get(key: string): unknown {
    return data[key];
  }

  /** Get string value — falls back to default, then "". */
  function str(key: string): string {
    return (data[key] as string) ?? (defaults[key] as string) ?? "";
  }

  /** Get number value — falls back to default, then 0. */
  function num(key: string): number {
    const v = data[key] ?? defaults[key];
    return typeof v === "number" ? v : 0;
  }

  /** Get boolean value — falls back to default. */
  function bool(key: string): boolean {
    return (data[key] ?? defaults[key]) === true;
  }

  /** Get string array — falls back to default. */
  function arr(key: string): string[] {
    const v = data[key] ?? defaults[key];
    return Array.isArray(v) ? (v as string[]) : [];
  }

  function set(key: string, value: unknown) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  // ---- Save / Cancel ----

  async function handleSave() {
    setSaving(true);
    try {
      // Compute diff
      const toSet: Record<string, unknown> = {};
      const toRemove: string[] = [];

      for (const key of Object.keys(data)) {
        if (JSON.stringify(data[key]) !== JSON.stringify(original[key])) {
          toSet[key] = data[key];
        }
      }
      for (const key of Object.keys(original)) {
        if (!(key in data)) {
          toRemove.push(key);
        }
      }

      if (Object.keys(toSet).length === 0 && toRemove.length === 0) {
        showToast("success", "No changes to save");
        return;
      }

      const res = await api.patch<ConfigResponse>("/api/config", {
        set: toSet,
        remove: toRemove,
      });
      setData(res.config);
      setDefaults(res.defaults ?? {});
      setOriginal(structuredClone(res.config));
      setSensitiveKeys(res._meta.sensitiveKeys);

      // Check if restart-needing keys changed
      const restartKeys = ["gateway.wsToken"];
      const needsRestart = restartKeys.some(
        (k) => JSON.stringify(toSet[k]) !== undefined && k in toSet
      );

      if (needsRestart) {
        showToast("warn", "Saved. Some changes require a restart to take effect.");
      } else {
        showToast("success", "Changes saved");
      }

      // Also refresh raw tab
      fetchRaw();
    } catch {
      showToast("error", "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setData(structuredClone(original));
  }

  // ---- Raw save ----

  async function handleRawSave() {
    setRawSaving(true);
    setRawError("");
    try {
      await api.put("/api/config/raw", { content: rawContent });
      setRawOriginal(rawContent);
      showToast("success", "Raw config saved");
      // Refresh form tab data
      fetchConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      if (msg.includes("400")) {
        setRawError("Invalid JSON5 — please fix syntax errors before saving.");
      } else {
        setRawError(msg);
      }
    } finally {
      setRawSaving(false);
    }
  }

  // ---- Render ----

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Config</h1>
        <p className="text-muted-foreground/60 mt-1">Loading...</p>
      </div>
    );
  }

  const isDirty = JSON.stringify(data) !== JSON.stringify(original);
  const isRawDirty = rawContent !== rawOriginal;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Config</h1>
        <p className="text-muted-foreground/60 mt-1">
          View and edit openwren.json configuration.
        </p>
      </div>

      <div>
        {/* ================================================================ */}
        {/* FORM                                                             */}
        {/* ================================================================ */}
        <div>
          {/* Save/Cancel bar */}
          <div className="flex gap-2 justify-end items-center mb-6">
            {toast && (
              <span
                className={`text-sm ${
                  toast.type === "success"
                    ? "text-green-400"
                    : toast.type === "warn"
                      ? "text-amber-400"
                      : "text-red-400"
                }`}
              >
                {toast.text}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancel}
              disabled={!isDirty}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!isDirty || saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>

          <div className="space-y-4">
            {/* ---- Model Defaults ---- */}
            <Section title="Model Defaults" defaultOpen>
              <div className="grid grid-cols-[140px_1fr] gap-y-4 items-center text-sm">
                <Row label="Default Model">
                  <div className="flex gap-2 items-center">
                    <input
                      value={str("defaultModel")}
                      onChange={(e) => set("defaultModel", e.target.value)}
                      placeholder="provider/model"
                      className={INPUT_CLS}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setModelPickerTarget("model")}
                    >
                      Browse
                    </Button>
                  </div>
                </Row>
                <Row label="Default Fallback">
                  <div className="flex gap-2 items-center">
                    <input
                      value={str("defaultFallback")}
                      onChange={(e) => set("defaultFallback", e.target.value)}
                      placeholder="provider/model"
                      className={INPUT_CLS}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setModelPickerTarget("fallback")}
                    >
                      Browse
                    </Button>
                  </div>
                </Row>
              </div>
            </Section>

            {/* ---- Providers ---- */}
            <Section title="Providers">
              <div className="space-y-3">
                {PROVIDERS.map((p) => {
                  const configKey = `providers.${p.key}.${p.field}`;
                  const val = str(configKey);
                  const isSensitive = sensitiveKeys.includes(configKey);

                  // Only show providers that have a value or were explicitly added
                  if (!val && !(configKey in data)) return null;

                  return (
                    <div key={p.key} className="grid grid-cols-[140px_1fr] gap-y-2 items-center text-sm">
                      <label className="text-muted-foreground">{p.label}</label>
                      {isSensitive || p.field === "apiKey" ? (
                        <MaskedInput
                          value={val}
                          onChange={(v) => set(configKey, v)}
                          placeholder={p.field === "baseUrl" ? "http://localhost:11434" : "API key"}
                        />
                      ) : (
                        <input
                          value={val}
                          onChange={(e) => set(configKey, e.target.value)}
                          placeholder={p.field === "baseUrl" ? "http://localhost:11434" : "API key"}
                          className={INPUT_CLS}
                        />
                      )}
                    </div>
                  );
                })}
                {/* Add provider button */}
                <div className="pt-2">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setAddProviderOpen(true)}>
                    <Plus className="h-3 w-3" /> Add provider
                  </Button>
                </div>
              </div>
            </Section>

            {/* ---- Search ---- */}
            <Section title="Search">
              <div className="grid grid-cols-[140px_1fr] gap-y-4 items-center text-sm">
                <Row label="Provider">
                  <Select
                    value={str("search.provider") || "__none__"}
                    onValueChange={(v) => set("search.provider", v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="max-w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Disabled</SelectItem>
                      <SelectItem value="brave">Brave</SelectItem>
                      <SelectItem value="zenserp">Zenserp</SelectItem>
                      <SelectItem value="searxng">SearxNG</SelectItem>
                    </SelectContent>
                  </Select>
                </Row>
                {str("search.provider") && (
                  <Row label="API Key">
                    <MaskedInput
                      value={str(`search.${str("search.provider")}.apiKey`)}
                      onChange={(v) => set(`search.${str("search.provider")}.apiKey`, v)}
                    />
                  </Row>
                )}
              </div>
            </Section>

            {/* ---- Gateway ---- */}
            <Section title="Gateway">
              <div className="grid grid-cols-[140px_1fr] gap-y-4 items-center text-sm">
                <Row label="WS Token">
                  <MaskedInput
                    value={str("gateway.wsToken")}
                    onChange={(v) => set("gateway.wsToken", v)}
                  />
                </Row>
              </div>
              <p className="text-xs text-amber-400/60 mt-3">
                Changing this invalidates all active dashboard sessions.
              </p>
            </Section>

            {/* ---- Scheduler ---- */}
            <Section title="Scheduler">
              <div className="grid grid-cols-[140px_1fr] gap-y-4 items-center text-sm">
                <Row label="Enabled">
                  <Switch
                    checked={bool("scheduler.enabled")}
                    onCheckedChange={(v) => set("scheduler.enabled", v)}
                  />
                </Row>
                <Row label="Log Retention">
                  <input
                    type="number"
                    value={num("scheduler.runHistory.logRetention")}
                    onChange={(e) => set("scheduler.runHistory.logRetention", Number(e.target.value))}
                    className={INPUT_CLS + " max-w-[120px]"}
                  />
                </Row>
                <Row label="Session Retention">
                  <input
                    type="number"
                    value={num("scheduler.runHistory.sessionRetention")}
                    onChange={(e) => set("scheduler.runHistory.sessionRetention", Number(e.target.value))}
                    className={INPUT_CLS + " max-w-[120px]"}
                  />
                </Row>
              </div>
            </Section>

            {/* ---- Heartbeat ---- */}
            <Section title="Heartbeat">
              <div className="grid grid-cols-[140px_1fr] gap-y-4 items-center text-sm">
                <Row label="Enabled">
                  <Switch
                    checked={bool("heartbeat.enabled")}
                    onCheckedChange={(v) => set("heartbeat.enabled", v)}
                  />
                </Row>
                <Row label="Interval">
                  <input
                    value={str("heartbeat.every")}
                    onChange={(e) => set("heartbeat.every", e.target.value)}
                    placeholder="30m"
                    disabled={!bool("heartbeat.enabled")}
                    className={INPUT_CLS + " max-w-[120px] disabled:opacity-50"}
                  />
                </Row>
                <Row label="Active Start">
                  <input
                    value={str("heartbeat.activeHours.start")}
                    onChange={(e) => set("heartbeat.activeHours.start", e.target.value)}
                    placeholder="08:00"
                    disabled={!bool("heartbeat.enabled")}
                    className={INPUT_CLS + " max-w-[120px] disabled:opacity-50"}
                  />
                </Row>
                <Row label="Active End">
                  <input
                    value={str("heartbeat.activeHours.end")}
                    onChange={(e) => set("heartbeat.activeHours.end", e.target.value)}
                    placeholder="22:00"
                    disabled={!bool("heartbeat.enabled")}
                    className={INPUT_CLS + " max-w-[120px] disabled:opacity-50"}
                  />
                </Row>
              </div>
            </Section>

            {/* ---- Session ---- */}
            <Section title="Session">
              <div className="grid grid-cols-[140px_1fr] gap-y-4 items-center text-sm">
                <Row label="Idle Reset (min)">
                  <input
                    type="number"
                    value={num("session.idleResetMinutes")}
                    onChange={(e) => set("session.idleResetMinutes", Number(e.target.value))}
                    placeholder="0 = disabled"
                    className={INPUT_CLS + " max-w-[120px]"}
                  />
                </Row>
                <Row label="Daily Reset">
                  <input
                    value={str("session.dailyResetTime")}
                    onChange={(e) => set("session.dailyResetTime", e.target.value)}
                    placeholder="04:00 or empty"
                    className={INPUT_CLS + " max-w-[120px]"}
                  />
                </Row>
              </div>
            </Section>

            {/* ---- Agent Loop ---- */}
            <Section title="Agent Loop">
              <div className="grid grid-cols-[140px_1fr] gap-y-4 items-center text-sm">
                <Row label="Max Iterations">
                  <input
                    type="number"
                    value={num("agent.maxIterations")}
                    onChange={(e) => set("agent.maxIterations", Number(e.target.value))}
                    className={INPUT_CLS + " max-w-[120px]"}
                  />
                </Row>
                <Row label="Compaction">
                  <Switch
                    checked={bool("agent.compaction.enabled")}
                    onCheckedChange={(v) => set("agent.compaction.enabled", v)}
                  />
                </Row>
                <Row label="Context Window">
                  <input
                    type="number"
                    value={num("agent.compaction.contextWindowTokens")}
                    onChange={(e) => set("agent.compaction.contextWindowTokens", Number(e.target.value))}
                    className={INPUT_CLS + " max-w-[160px]"}
                  />
                </Row>
                <Row label="Threshold %">
                  <input
                    type="number"
                    value={num("agent.compaction.thresholdPercent")}
                    onChange={(e) => set("agent.compaction.thresholdPercent", Number(e.target.value))}
                    className={INPUT_CLS + " max-w-[120px]"}
                  />
                </Row>
              </div>
            </Section>

            {/* ---- Channel Settings ---- */}
            <Section title="Channel Settings">
              <div className="grid grid-cols-[140px_1fr] gap-y-4 items-center text-sm">
                <Row label="Unauthorized">
                  <Select
                    value={str("channels.unauthorizedBehavior") || "reject"}
                    onValueChange={(v) => set("channels.unauthorizedBehavior", v)}
                  >
                    <SelectTrigger className="max-w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="silent">Silent</SelectItem>
                      <SelectItem value="reject">Reject</SelectItem>
                    </SelectContent>
                  </Select>
                </Row>
                <Row label="Max Messages">
                  <input
                    type="number"
                    value={num("channels.rateLimit.maxMessages")}
                    onChange={(e) => set("channels.rateLimit.maxMessages", Number(e.target.value))}
                    className={INPUT_CLS + " max-w-[120px]"}
                  />
                </Row>
                <Row label="Window (sec)">
                  <input
                    type="number"
                    value={num("channels.rateLimit.windowSeconds")}
                    onChange={(e) => set("channels.rateLimit.windowSeconds", Number(e.target.value))}
                    className={INPUT_CLS + " max-w-[120px]"}
                  />
                </Row>
              </div>
            </Section>

            {/* ---- Timezone ---- */}
            <Section title="Timezone">
              <div className="grid grid-cols-[140px_1fr] gap-y-4 items-center text-sm">
                <Row label="Timezone">
                  <input
                    value={str("timezone")}
                    onChange={(e) => set("timezone", e.target.value)}
                    placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone}
                    className={INPUT_CLS}
                  />
                </Row>
              </div>
            </Section>

            {/* ---- Roles — hidden until proper tooling (autocomplete, descriptions, agent mapping) ---- */}
            {/* <Section title="Roles">
              <div className="space-y-4">
                {["manager", "worker"].map((role) => {
                  const key = `roles.${role}`;
                  return (
                    <div key={role}>
                      <h4 className="text-sm font-medium mb-2 capitalize">{role}</h4>
                      <TagList
                        values={arr(key)}
                        onChange={(v) => set(key, v)}
                        placeholder="Add tool name..."
                      />
                    </div>
                  );
                })}
              </div>
            </Section> */}
          </div>

          {/* Bottom save bar */}
          <div className="flex gap-2 justify-end items-center mt-6">
            {toast && (
              <span
                className={`text-sm ${
                  toast.type === "success"
                    ? "text-green-400"
                    : toast.type === "warn"
                      ? "text-amber-400"
                      : "text-red-400"
                }`}
              >
                {toast.text}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancel}
              disabled={!isDirty}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!isDirty || saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        {/* ================================================================ */}
        {/* RAW TAB — disabled for now, re-enable later                      */}
        {/* ================================================================ */}
        {false && (
        <div className="mt-6">
          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-4 py-2.5 mb-4">
            <p className="text-sm text-amber-400">
              Editing raw config — comments are preserved but invalid JSON5 will be rejected.
            </p>
          </div>

          {rawError && (
            <div className="rounded-md bg-red-500/10 border border-red-500/20 px-4 py-2.5 mb-4">
              <p className="text-sm text-red-400">{rawError}</p>
            </div>
          )}

          <div className="relative">
            <textarea
              value={rawContent}
              onChange={(e) => {
                setRawContent(e.target.value);
                setRawError("");
              }}
              spellCheck={false}
              className="w-full h-[600px] bg-muted/30 border border-border rounded-md px-4 py-3 font-mono text-sm text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-ring leading-relaxed"
            />
          </div>

          <div className="flex gap-2 justify-end items-center mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setRawContent(rawOriginal);
                setRawError("");
              }}
              disabled={!isRawDirty}
            >
              Revert
            </Button>
            <Button onClick={handleRawSave} disabled={!isRawDirty || rawSaving}>
              {rawSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
        )}
      </div>

      {/* Add Provider Dialog */}
      <AddProviderDialog
        open={addProviderOpen}
        onClose={() => setAddProviderOpen(false)}
        configuredProviders={
          PROVIDERS
            .filter((p) => {
              const key = `providers.${p.key}.${p.field}`;
              return !!data[key] || !!defaults[key];
            })
            .map((p) => p.key)
        }
        onAdded={(res) => {
          setData(res.config);
          setDefaults(res.defaults ?? {});
          setOriginal(structuredClone(res.config));
          setSensitiveKeys(res._meta.sensitiveKeys);
          fetchRaw();
          showToast("success", "Provider added");
        }}
      />

      {/* Model Picker */}
      <ModelPicker
        open={modelPickerTarget !== null}
        onClose={() => setModelPickerTarget(null)}
        onSelect={(model) => {
          if (modelPickerTarget === "model") {
            set("defaultModel", model);
          } else if (modelPickerTarget === "fallback") {
            set("defaultFallback", model);
          }
        }}
      />
    </div>
  );
}

