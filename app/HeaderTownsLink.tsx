"use client";

// Header "Towns" link: a client island only so it can mark itself current on /flood and /flood/<town>.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { splitLocale } from "@/lib/i18n/config";

export function HeaderTownsLink({ href, label }: { href: string; label: string }) {
  const path = splitLocale(usePathname() || "/").path;
  const active = path === "/flood" || path.startsWith("/flood/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-umami-event="towns_nav_click"
      className={`hidden sm:inline-block rounded-md px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition ${
        active ? "text-sky-700 dark:text-sky-300 font-medium" : "text-slate-700 dark:text-slate-300"
      }`}
    >
      {label}
    </Link>
  );
}
