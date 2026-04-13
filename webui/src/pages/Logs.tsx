import { Terminal } from "lucide-react";

export function Logs() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">Logs</h1>
        <p className="text-muted-foreground/60 mt-1">Live log tail with text filtering.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-32 text-muted-foreground/40 gap-3">
        <Terminal className="h-12 w-12" />
        <p>Coming soon.</p>
      </div>
    </div>
  );
}
