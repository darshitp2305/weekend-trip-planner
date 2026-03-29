"use client";

/**
 * Reusable UI component for the theme toggle section of the planner.
 * Keeping this logic in its own component makes the page-level containers easier to scan and keeps related rendering and state updates together.
 */


import { useEffect, useState } from "react";

const STORAGE_KEY = "trippify-theme";

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const syncTheme = () => {
      const storedTheme = localStorage.getItem(STORAGE_KEY);
      const nextTheme = storedTheme === "dark" ? "dark" : "light";

      setTheme(nextTheme);
      applyTheme(nextTheme);
      setMounted(true);
    };

    const frameId = window.requestAnimationFrame(syncTheme);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  function handleToggle() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem(STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={
        mounted ? `Switch to ${theme === "dark" ? "light" : "dark"} mode` : "Toggle theme"
      }
      aria-pressed={mounted ? theme === "dark" : false}
      className="fixed right-4 top-4 z-[60] inline-flex h-11 items-center gap-2 rounded-full border border-slate-300/80 bg-white/90 px-3 text-sm font-semibold text-slate-800 shadow-lg backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-100 dark:hover:bg-slate-900 sm:right-6 sm:top-6"
    >
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-sm text-amber-700 dark:bg-slate-800 dark:text-cyan-200">
        {mounted && theme === "dark" ? "☾" : "☀"}
      </span>
      <span>{mounted && theme === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}
