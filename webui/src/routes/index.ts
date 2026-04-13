import { createRoute } from "@tanstack/react-router";
import { dashboardLayout } from "./_dashboard.ts";
import { Dashboard } from "@/pages/Dashboard.tsx";

export const indexRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/",
  component: Dashboard,
});
