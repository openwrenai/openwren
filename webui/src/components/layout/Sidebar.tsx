import { Link, useRouterState } from "@tanstack/react-router";
import {
  Home,
  Bot,
  Users,
  GitBranch,
  Clock,
  Puzzle,
  Brain,
  Settings,
  BarChart3,
  Terminal,
  ShieldCheck,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: "Control",
    items: [
      { label: "Dashboard", path: "/", icon: Home },
      { label: "Workflows", path: "/workflows", icon: GitBranch },
      { label: "Schedules", path: "/schedules", icon: Clock },
      { label: "Approvals", path: "/approvals", icon: ShieldCheck },
    ],
  },
  {
    title: "Agent",
    items: [
      { label: "Agents", path: "/agents", icon: Bot },
      { label: "Teams", path: "/teams", icon: Users },
      { label: "Skills", path: "/skills", icon: Puzzle },
      { label: "Memory", path: "/memory", icon: Brain },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Config", path: "/config", icon: Settings },
      { label: "Usage", path: "/usage", icon: BarChart3 },
      { label: "Logs", path: "/logs", icon: Terminal },
    ],
  },
];

function isActive(currentPath: string, itemPath: string): boolean {
  if (itemPath === "/") return currentPath === "/";
  return currentPath.startsWith(itemPath);
}

export function Sidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <aside className="flex flex-col w-60 shrink-0 bg-background text-sidebar-foreground overflow-hidden">
      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-4 space-y-7 pt-5">
        {navGroups.map((group) => (
          <div key={group.title}>
            <div className="flex items-center justify-between px-3 mb-3">
              <span className="text-[13px] font-medium text-muted-foreground/40">
                {group.title}
              </span>
              <Minus className="h-3 w-3 text-muted-foreground/20" />
            </div>
            <div className="space-y-1.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(currentPath, item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex items-center gap-4 px-3 py-3 rounded-lg text-[14px] transition-colors no-underline",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon className={cn("h-5 w-5 shrink-0", active && "text-red-400/80")} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

    </aside>
  );
}
