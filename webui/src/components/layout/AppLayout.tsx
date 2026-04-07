import { Outlet } from "@tanstack/react-router";
import { Sidebar } from "./Sidebar.tsx";

export function AppLayout() {
  return (
    <>
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </>
  );
}
