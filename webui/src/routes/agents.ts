import { createRoute } from "@tanstack/react-router";
import { dashboardLayout } from "./_dashboard.ts";
import { Agents } from "@/pages/Agents.tsx";

export const agentsRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/agents",
  component: Agents,
});
