import { createRoute } from "@tanstack/react-router";
import { dashboardLayout } from "./_dashboard.ts";
import { Workflows } from "@/pages/Workflows.tsx";

export const workflowsRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/workflows",
  component: Workflows,
});
