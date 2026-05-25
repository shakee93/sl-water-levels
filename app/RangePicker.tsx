"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";

const COOKIE = "sl_days";

const OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "24h" },
  { value: 4, label: "4d" },
  { value: 7, label: "7d" },
  { value: 14, label: "14d" },
];

export const DEFAULT_DAYS = 4;

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

export function RangePicker({ current }: { current: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function select(value: number) {
    if (value === current) return;
    setCookie(COOKIE, String(value));
    const next = new URLSearchParams(params.toString());
    if (value === DEFAULT_DAYS) next.delete("days");
    else next.set("days", String(value));
    const qs = next.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => {
      router.push(url);
    });
  }

  return (
    <div
      role="tablist"
      aria-label="History range"
      className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5 shadow-sm"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === current;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            disabled={isPending}
            onClick={() => select(opt.value)}
            className={`relative px-2.5 py-1 text-xs font-medium tabular-nums rounded-md transition disabled:opacity-60 disabled:cursor-not-allowed ${
              active
                ? "bg-sky-600 text-white shadow-sm"
                : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
      {isPending && (
        <span className="ml-1 pr-1 text-sky-600 dark:text-sky-400" aria-label="Loading">
          <Loader2 className="size-3.5 animate-spin" />
        </span>
      )}
    </div>
  );
}
