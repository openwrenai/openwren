import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { api } from "@/lib/api.ts";
import type { Agent } from "@/lib/types.ts";

interface OverviewTabProps {
  agent: Agent;
  onUpdated: () => void;
}

export function OverviewTab({ agent, onUpdated }: OverviewTabProps) {
  const [modelPickerTarget, setModelPickerTarget] = useState<"model" | "fallback" | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const form = useForm({
    defaultValues: {
      name: agent.name,
      description: agent.description ?? "",
      model: agent.model ?? "",
      fallback: agent.fallback ?? "",
      useDefaultModel: !agent.model,
      useDefaultFallback: !agent.fallback,
    },
    onSubmit: async ({ value }) => {
      const patch: Record<string, unknown> = {};

      if (value.name !== agent.name) patch.name = value.name;
      if (value.description !== (agent.description ?? "")) patch.description = value.description || null;

      // Model handling
      if (value.useDefaultModel && agent.model) {
        patch.model = null;
      } else if (!value.useDefaultModel && value.model !== (agent.model ?? "")) {
        patch.model = value.model;
      }

      // Fallback handling
      if (value.useDefaultFallback && agent.fallback) {
        patch.fallback = null;
      } else if (!value.useDefaultFallback && value.fallback !== (agent.fallback ?? "")) {
        patch.fallback = value.fallback;
      }

      if (Object.keys(patch).length === 0) return;

      try {
        await api.patch(`/api/agents/${agent.id}`, patch);
        setToast({ type: "success", text: "Changes saved" });
        onUpdated();
      } catch {
        setToast({ type: "error", text: "Failed to save changes" });
      }
      setTimeout(() => setToast(null), 3000);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-6"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-[120px_1fr] gap-y-4 items-center text-sm">
            <label className="text-muted-foreground">Name</label>
            <form.Field name="name">
              {(field) => (
                <input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="bg-muted/30 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring max-w-md"
                />
              )}
            </form.Field>

            <label className="text-muted-foreground">Description</label>
            <form.Field name="description">
              {(field) => (
                <input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="No description"
                  className="bg-muted/30 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring max-w-md"
                />
              )}
            </form.Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-[120px_1fr] gap-y-4 items-center text-sm">
            <label className="text-muted-foreground">Model</label>
            <div className="flex gap-2 items-center">
              <form.Field name="model">
                {(field) => (
                  <form.Field name="useDefaultModel">
                    {(useDefaultField) => (
                      <>
                        <input
                          value={useDefaultField.state.value ? "" : field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={useDefaultField.state.value}
                          placeholder={useDefaultField.state.value ? agent.defaultModel : "provider/model"}
                          className="bg-muted/30 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring max-w-sm disabled:opacity-50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={useDefaultField.state.value}
                          onClick={() => setModelPickerTarget("model")}
                        >
                          Browse
                        </Button>
                      </>
                    )}
                  </form.Field>
                )}
              </form.Field>
            </div>

            <label className="text-muted-foreground">Fallback</label>
            <div className="flex gap-2 items-center">
              <form.Field name="fallback">
                {(field) => (
                  <form.Field name="useDefaultFallback">
                    {(useDefaultField) => (
                      <>
                        <input
                          value={useDefaultField.state.value ? "" : field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={useDefaultField.state.value}
                          placeholder={useDefaultField.state.value ? agent.defaultFallback || "None" : "provider/model"}
                          className="bg-muted/30 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring max-w-sm disabled:opacity-50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={useDefaultField.state.value}
                          onClick={() => setModelPickerTarget("fallback")}
                        >
                          Browse
                        </Button>
                      </>
                    )}
                  </form.Field>
                )}
              </form.Field>
            </div>
          </div>

          <div className="space-y-2 mt-2">
            <form.Field name="useDefaultModel">
              {(field) => (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={field.state.value}
                    onChange={(e) => field.handleChange(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-muted-foreground">
                    Use default model (currently: {agent.defaultModel})
                  </span>
                </label>
              )}
            </form.Field>

            <form.Field name="useDefaultFallback">
              {(field) => (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={field.state.value}
                    onChange={(e) => field.handleChange(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-muted-foreground">
                    Use default fallback (currently: {agent.defaultFallback || "None"})
                  </span>
                </label>
              )}
            </form.Field>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2 justify-end items-center">
        {toast && (
          <span className={`text-sm ${toast.type === "success" ? "text-green-400" : "text-red-400"}`}>
            {toast.text}
          </span>
        )}
        <Button type="button" variant="ghost" onClick={() => form.reset()}>
          Cancel
        </Button>
        <Button type="submit">
          Save
        </Button>
      </div>

      <ModelPicker
        open={modelPickerTarget !== null}
        onClose={() => setModelPickerTarget(null)}
        onSelect={(model) => {
          if (modelPickerTarget === "model") {
            form.setFieldValue("model", model);
            form.setFieldValue("useDefaultModel", false);
          } else if (modelPickerTarget === "fallback") {
            form.setFieldValue("fallback", model);
            form.setFieldValue("useDefaultFallback", false);
          }
        }}
      />
    </form>
  );
}
