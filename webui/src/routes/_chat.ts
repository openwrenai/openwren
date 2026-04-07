import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root.ts";
import { ChatLayout } from "@/components/layout/ChatLayout.tsx";

export const chatLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "chat-layout",
  component: ChatLayout,
});
