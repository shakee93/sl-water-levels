"use client";

import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import type { Station } from "@/lib/arcgis";
import { stationPath } from "@/lib/slug";
import { trackEvent } from "@/lib/umami";
import { useI18n } from "./LocaleProvider";
import { riverName } from "@/lib/i18n/format";

const STATION_COOKIE = "sl_station";

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

export function StationPicker({
  stations,
  current,
  id,
}: {
  stations: Station[];
  current: string;
  id?: string;
}) {
  const router = useRouter();
  const { lang, t, p } = useI18n();
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

  // Map station name -> canonical {basin, station} for path building.
  const byStation = useMemo(() => {
    const m = new Map<string, Station>();
    for (const s of stations) m.set(s.station, s);
    return m;
  }, [stations]);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setCookie(STATION_COOKIE, value);
    const hit = byStation.get(value);
    if (!hit) return;
    trackEvent("station_change", { basin: hit.basin?.trim() || "(unknown)", station: hit.station });
    // Preserve days= but drop legacy station= if present.
    const next = new URLSearchParams(window.location.search);
    next.delete("station");
    const qs = next.toString();
    const url = `${p(stationPath(hit.basin, hit.station))}${qs ? `?${qs}` : ""}`;
    startTransition(() => {
      window.dispatchEvent(new Event("sl:nav-start"));
      router.push(url);
    });
  }

  return (
    <div className="relative">
      <select
        id={id}
        value={current}
        onChange={onChange}
        disabled={isPending}
        aria-busy={isPending}
        className="w-full appearance-none rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-11 px-3.5 py-2.5 pr-10 text-base sm:text-sm font-medium text-slate-900 dark:text-slate-100 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {grouped.map(([basin, list]) => (
          <optgroup key={basin} label={riverName(basin, lang)}>
            {list.map((s) => (
              <option key={`${s.basin}|${s.station}`} value={s.station}>
                {s.station}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
        {isPending ? (
          <Loader2 className="size-4 animate-spin text-sky-600 dark:text-sky-400" aria-label={t("common.loading")} />
        ) : (
          <ChevronDown className="size-4 text-slate-400" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
