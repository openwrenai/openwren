import { useState, useCallback } from "react";
import { Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { ChatSidebar } from "./ChatSidebar.tsx";

/**
 * Chat layout — session sidebar (left) + chat area (right).
 *
 * "New Chat" navigates to /chat with no sessionId. The Chat page shows a
 * centered input (fresh state). Session is created lazily when the user
 * sends their first message — see Chat.tsx handleSend.
 */
export function ChatLayout() {
  const params = useParams({ strict: false }) as { sessionId?: string };
  const navigate = useNavigate();
  const [agentId, setAgentId] = useState("atlas");

  // Navigate to /chat (no sessionId) — the Chat page handles lazy creation
  const handleNewChat = useCallback(() => {
    navigate({ to: "/chat" });
  }, [navigate]);

  return (
    <>
      <ChatSidebar
        activeSessionId={params.sessionId}
        activeAgentId={agentId}
        onAgentChange={setAgentId}
        onNewChat={handleNewChat}
      />
      <main className="flex-1 overflow-hidden flex flex-col">
        <Outlet />
      </main>
    </>
  );
}
