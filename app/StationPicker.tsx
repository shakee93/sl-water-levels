"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import type { Station } from "@/lib/arcgis";

const STATION_COOKIE = "sl_station";

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

export function StationPicker({
  stations,
  current,
}: {
  stations: Station[];
  current: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const grouped = useMemo(() => {
    const m = new Map<string, Station[]>();
    for (const s of stations) {
      const b = s.basin || "(no basin)";
      if (!m.has(b)) m.set(b, []);
      m.get(b)!.push(s);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [stations]);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setCookie(STATION_COOKIE, value);
    const next = new URLSearchParams(params.toString());
    next.set("station", value);
    startTransition(() => {
      router.push(`/?${next.toString()}`);
    });
  }

  return (
    <div className="relative">
      <select
        value={current}
        onChange={onChange}
        disabled={isPending}
        aria-busy={isPending}
        className="w-full appearance-none rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 pr-10 text-sm font-medium text-slate-900 dark:text-slate-100 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {grouped.map(([basin, list]) => (
          <optgroup key={basin} label={basin}>
            {list.map((s) => (
              <option key={`${s.basin}|${s.station}`} value={s.station}>
                {s.station}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
        {isPending ? <Spinner /> : <Chevron />}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin text-sky-600 dark:text-sky-400"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      className="size-4 text-slate-400"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}
