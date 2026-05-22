"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type { Station } from "@/lib/arcgis";

export function StationPicker({ stations, current }: { stations: Station[]; current: string }) {
  const router = useRouter();
  const params = useSearchParams();

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
    const next = new URLSearchParams(params.toString());
    next.set("station", e.target.value);
    router.push(`/?${next.toString()}`);
  }

  return (
    <select
      value={current}
      onChange={onChange}
      className="w-full md:w-80 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
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
  );
}
