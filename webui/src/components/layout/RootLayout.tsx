import { Outlet } from "@tanstack/react-router";
import { TopBar } from "./TopBar.tsx";

export function RootLayout() {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
