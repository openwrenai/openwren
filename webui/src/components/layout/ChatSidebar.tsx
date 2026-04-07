import { Link } from "@tanstack/react-router";
import { Plus, MessageSquare } from "lucide-react";

export function ChatSidebar() {
  return (
    <aside className="flex flex-col w-60 shrink-0 bg-background text-sidebar-foreground overflow-hidden">
      {/* New chat button */}
      <div className="px-4 pt-5 pb-3">
        <Link
          to="/chat"
          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg bg-sidebar-accent text-sidebar-accent-foreground text-[14px] font-medium no-underline hover:bg-sidebar-accent/80 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Link>
      </div>

      {/* Sessions list */}
      <nav className="flex-1 overflow-y-auto px-4 pt-2">
        <div className="px-3 mb-3">
          <span className="text-[13px] font-medium text-muted-foreground/40">Sessions</span>
        </div>
        <div className="space-y-1 text-sm text-muted-foreground/50">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg">
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span>No sessions yet</span>
          </div>
        </div>
      </nav>
    </aside>
  );
}
