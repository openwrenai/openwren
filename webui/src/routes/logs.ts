import { createRoute } from "@tanstack/react-router";
import { dashboardLayout } from "./_dashboard.ts";
import { Logs } from "@/pages/Logs.tsx";

export const logsRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/logs",
  component: Logs,
});
