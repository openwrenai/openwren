import { useState, useCallback } from "react";
import { Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { ChatSidebar } from "./ChatSidebar.tsx";
import { api } from "@/lib/api.ts";

export function ChatLayout() {
  const params = useParams({ strict: false }) as { sessionId?: string };
  const navigate = useNavigate();
  const [agentId, setAgentId] = useState("atlas");

  const handleNewChat = useCallback(async () => {
    try {
      const res = await api.post<{ id: string }>("/api/sessions", {
        agentId,
        label: "New Chat",
      });
      navigate({ to: "/chat/$sessionId", params: { sessionId: res.id } });
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  }, [agentId, navigate]);

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
