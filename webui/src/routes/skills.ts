import { createRoute } from "@tanstack/react-router";
import { dashboardLayout } from "./_dashboard.ts";
import { Skills } from "@/pages/Skills.tsx";

export const skillsRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/skills",
  component: Skills,
});
