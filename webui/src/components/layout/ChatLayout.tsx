import { Outlet } from "@tanstack/react-router";
import { ChatSidebar } from "./ChatSidebar.tsx";

export function ChatLayout() {
  return (
    <>
      <ChatSidebar />
      <main className="flex-1 overflow-hidden flex flex-col">
        <Outlet />
      </main>
    </>
  );
}
