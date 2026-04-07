import { Link, useRouterState } from "@tanstack/react-router";
import { Sun, Moon, MessageSquare, Settings } from "lucide-react";
import { useTheme } from "@/hooks/useTheme.ts";

export function TopBar() {
  const { theme, toggleTheme } = useTheme();
  const routerState = useRouterState();
  const isChatMode = routerState.location.pathname.startsWith("/chat");

  return (
    <header className="flex items-center justify-between h-14 px-5 border-b border-border bg-background shrink-0">
      <Link to="/" className="flex items-center gap-2.5 no-underline">
        <span className="text-primary font-bold text-sm tracking-wide">[OW]</span>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-wider text-foreground uppercase">OpenWren</span>
          <span className="text-[10px] text-muted-foreground/50 tracking-widest uppercase">{isChatMode ? "Chat" : "Dashboard"}</span>
        </div>
      </Link>
      <div className="flex items-center gap-3">
        {isChatMode ? (
          <Link
            to="/"
            className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-card text-[13px] text-muted-foreground hover:text-foreground transition-colors no-underline"
          >
            <Settings className="h-4 w-4" />
            Dashboard
          </Link>
        ) : (
          <Link
            to="/chat"
            className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-card text-[13px] text-muted-foreground hover:text-foreground transition-colors no-underline"
          >
            <MessageSquare className="h-4 w-4" />
            Chat
          </Link>
        )}
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-card text-[13px] text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Health OK
        </div>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-full hover:bg-card text-muted-foreground hover:text-foreground transition-colors"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>
      </div>
    </header>
  );
}
