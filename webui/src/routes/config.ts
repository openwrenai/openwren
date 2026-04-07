import { createRoute } from "@tanstack/react-router";
import { dashboardLayout } from "./_dashboard.ts";
import { Config } from "@/pages/Config.tsx";

export const configRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/config",
  component: Config,
});
