import { createRoute } from "@tanstack/react-router";
import { chatLayout } from "./_chat.ts";
import { Chat } from "@/pages/Chat.tsx";

export const chatRoute = createRoute({
  getParentRoute: () => chatLayout,
  path: "/chat",
  component: Chat,
});
