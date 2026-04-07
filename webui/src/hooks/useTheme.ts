import { useState, useCallback } from "react";

type Theme = "light" | "dark";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) ?? "dark";
  });

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem("theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme } as const;
}
