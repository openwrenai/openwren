import { GitBranch } from "lucide-react";

export function Workflows() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">Workflows</h1>
        <p className="text-muted-foreground/60 mt-1">Active and completed workflow task trees.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-32 text-muted-foreground/40 gap-3">
        <GitBranch className="h-12 w-12" />
        <p>Coming soon.</p>
      </div>
    </div>
  );
}
