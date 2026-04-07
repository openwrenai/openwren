import { BarChart3 } from "lucide-react";

export function Usage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">Usage</h1>
        <p className="text-muted-foreground/60 mt-1">Token usage and cost tracking by agent, provider, and day.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-32 text-muted-foreground/40 gap-3">
        <BarChart3 className="h-12 w-12" />
        <p>Coming soon.</p>
      </div>
    </div>
  );
}
