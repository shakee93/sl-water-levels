"use client";

// Mounted once in the layout: while the choice is "system", follow OS changes; follow other tabs.
import { useEffect } from "react";
import { applyTheme, readChoice } from "@/lib/theme";

export function ThemeSync() {
  useEffect(() => {
    const sync = () => applyTheme(readChoice());
    sync(); // also fixes the browser-bar colour, which the head script does not touch
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return null;
}
