import { MessageSquare } from "lucide-react";

export function Chat() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 gap-3">
      <MessageSquare className="h-12 w-12" />
      <h1 className="text-xl font-semibold text-foreground">Start a conversation</h1>
      <p>Select an agent and send a message.</p>
    </div>
  );
}
