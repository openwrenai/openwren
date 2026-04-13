import { createRoute } from "@tanstack/react-router";
import { dashboardLayout } from "./_dashboard.ts";
import { Usage } from "@/pages/Usage.tsx";

export const usageRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/usage",
  component: Usage,
});
