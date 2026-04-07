import { Bot } from "lucide-react";

export function Agents() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">Agents</h1>
        <p className="text-muted-foreground/60 mt-1">Manage your AI agents, models, and soul files.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-32 text-muted-foreground/40 gap-3">
        <Bot className="h-12 w-12" />
        <p>Coming soon.</p>
      </div>
    </div>
  );
}
