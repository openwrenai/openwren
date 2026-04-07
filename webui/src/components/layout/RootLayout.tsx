import { Outlet } from "@tanstack/react-router";
import { TopBar } from "./TopBar.tsx";
import { WebSocketContext, useWebSocketConnection } from "@/hooks/useWebSocket.ts";

export function RootLayout() {
  const ws = useWebSocketConnection();

  return (
    <WebSocketContext value={ws}>
      <div className="flex flex-col h-screen overflow-hidden bg-background">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>
    </WebSocketContext>
  );
}
