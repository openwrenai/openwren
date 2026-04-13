import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.ts";
import "./index.css";

// Apply dark mode from localStorage before first render
const theme = localStorage.getItem("theme") ?? "dark";
document.documentElement.classList.toggle("dark", theme === "dark");

// Grab token from URL if present, save to localStorage, strip from URL
const url = new URL(window.location.href);
const tokenParam = url.searchParams.get("token");
if (tokenParam) {
  localStorage.setItem("ow_token", tokenParam);
  url.searchParams.delete("token");
  window.history.replaceState({}, "", url.pathname + url.hash);
}

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
