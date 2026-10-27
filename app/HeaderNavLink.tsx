"use client";

// A header text link that marks itself current (aria-current + the sky colour) from the shared nav section helper.
import Link from "next/link";
import { useNavSection, type NavSection } from "@/lib/navActive";

export function HeaderNavLink({ href, label, section, event }: { href: string; label: string; section: NavSection; event: string }) {
  const active = useNavSection() === section;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-umami-event={event}
      className={`hidden sm:inline-block rounded-md px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition ${
        active ? "text-sky-700 dark:text-sky-300 font-medium" : "text-slate-700 dark:text-slate-300"
      }`}
    >
      {label}
    </Link>
  );
}
