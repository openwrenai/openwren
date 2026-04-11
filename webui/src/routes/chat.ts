import { createRoute } from "@tanstack/react-router";
import { dashboardLayout } from "./_dashboard.ts";
import { Chat } from "@/pages/Chat.tsx";

export const chatRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/chat",
  component: Chat,
});
