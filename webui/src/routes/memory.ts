import { createRoute } from "@tanstack/react-router";
import { dashboardLayout } from "./_dashboard.ts";
import { Memory } from "@/pages/Memory.tsx";

export const memoryRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/memory",
  component: Memory,
});
