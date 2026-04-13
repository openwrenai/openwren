import { createRoute } from "@tanstack/react-router";
import { dashboardLayout } from "./_dashboard.ts";
import { Approvals } from "@/pages/Approvals.tsx";

export const approvalsRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/approvals",
  component: Approvals,
});
