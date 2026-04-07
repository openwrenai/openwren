import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root.ts";
import { AppLayout } from "@/components/layout/AppLayout.tsx";

export const dashboardLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "dashboard",
  component: AppLayout,
});
