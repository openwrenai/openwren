import { createRoute } from "@tanstack/react-router";
import { dashboardLayout } from "./_dashboard.ts";
import { Schedules } from "@/pages/Schedules.tsx";

export const schedulesRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/schedules",
  component: Schedules,
});
