"use client";

// Theme state for client components. `scheme` is what is actually showing ("light" | "dark"),
// read from <html class="dark"> so it follows the switcher AND the OS (while on "system").
// `choice` is what the visitor picked. On the server both are neutral ("system" / "light").
import { useCallback, useSyncExternalStore } from "react";
import { THEME_KEY, applyTheme, readChoice, type ThemeChoice } from "@/lib/theme";

const EVT = "sl:theme";

function subscribeScheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}
const schemeNow = (): "light" | "dark" => (document.documentElement.classList.contains("dark") ? "dark" : "light");

function subscribeChoice(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** The scheme on screen. Use this (not matchMedia) for anything drawn in JS. */
export function useScheme(): "light" | "dark" {
  return useSyncExternalStore(subscribeScheme, schemeNow, () => "light");
}

export function useTheme() {
  const scheme = useScheme();
  const choice = useSyncExternalStore(subscribeChoice, readChoice, () => "system" as ThemeChoice);
  const setChoice = useCallback((c: ThemeChoice) => {
    try {
      localStorage.setItem(THEME_KEY, c);
    } catch {
      /* storage blocked: applies for this page view only */
    }
    applyTheme(c);
    window.dispatchEvent(new Event(EVT));
  }, []);
  return { choice, scheme, setChoice };
}
