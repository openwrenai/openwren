import { createRootRoute } from "@tanstack/react-router";
import { RootLayout } from "@/components/layout/RootLayout.tsx";

export const rootRoute = createRootRoute({
  component: RootLayout,
});
