import { createRoute } from "@tanstack/react-router";
import { chatLayout } from "./_chat.ts";
import { Chat } from "@/pages/Chat.tsx";

export const chatSessionRoute = createRoute({
  getParentRoute: () => chatLayout,
  path: "/chat/$sessionId",
  component: Chat,
});
