import { createRoute } from "@tanstack/react-router";
import { dashboardLayout } from "./_dashboard.ts";
import { Teams } from "@/pages/Teams.tsx";

export const teamsRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/teams",
  component: Teams,
});
