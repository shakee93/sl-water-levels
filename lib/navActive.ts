"use client";

// The one answer to "which main nav item is this page under?", shared by the desktop header, the phone bottom bar and
// the More sheet so exactly one is current. Locale prefix (/si, /ta) is stripped first. River pages (/<river> and
// /<river>/<gauge>) are matched against the real river slug list, never guessed; /history/<river> stays under History.
import { usePathname } from "next/navigation";
import { splitLocale } from "./i18n/config";

export type NavSection = "home" | "basins" | "towns" | "reservoirs" | "news" | "help";

const TOP: Record<string, NavSection> = { flood: "towns", reservoirs: "reservoirs", news: "news", help: "help" };

export function navSection(pathname: string, riverSlugs: readonly string[] = []): NavSection | null {
  const first = splitLocale(pathname || "/").path.split("/")[1] ?? "";
  if (first === "") return "home";
  if (TOP[first]) return TOP[first];
  return riverSlugs.includes(first) ? "basins" : null;
}

export function useNavSection(riverSlugs: readonly string[] = []): NavSection | null {
  return navSection(usePathname() || "/", riverSlugs);
}
