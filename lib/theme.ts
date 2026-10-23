// Light / dark / system theme. The choice lives in localStorage "sl_theme"; <html class="dark"> is
// what Tailwind's `dark:` variant (see globals.css) and our JS (useTheme) follow.
export const THEME_KEY = "sl_theme";
export type ThemeChoice = "light" | "dark" | "system";
export const THEME_CHOICES: ThemeChoice[] = ["light", "dark", "system"];

export const isChoice = (v: unknown): v is ThemeChoice => v === "light" || v === "dark" || v === "system";

/** Runs in <head> before first paint (static/ISR pages, nothing read on the server): no flash of the wrong theme. */
export const THEME_INIT_SCRIPT = `(function(){var r=document.documentElement,m="light";try{var s=localStorage.getItem("${THEME_KEY}");m=s==="light"||s==="dark"?s:window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){}r.classList.toggle("dark",m==="dark");r.style.colorScheme=m})()`;

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isChoice(v) ? v : "system";
  } catch {
    return "system";
  }
}

export function resolve(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const BAR = { light: "#ffffff", dark: "#020617" };

/** Put the resolved theme on <html> (class, color-scheme, browser bar colour). */
export function applyTheme(choice: ThemeChoice) {
  const m = resolve(choice);
  const r = document.documentElement;
  r.classList.toggle("dark", m === "dark");
  r.style.colorScheme = m;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((el) => {
    // the layout ships one per OS scheme; while the visitor forces a theme both must say the same
    if (choice === "system") {
      const dark = el.media.includes("dark");
      el.content = dark ? BAR.dark : BAR.light;
    } else el.content = BAR[m];
  });
}
