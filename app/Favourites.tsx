"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Clock, Minus, Star } from "lucide-react";
import { formatLevel } from "@/lib/units";
import { stationDisplayName } from "@/lib/displayName";
import {
  STEADY_M_PER_H,
  TIER_DOT,
  tierLabel,
  TIER_TEXT_CLASS,
  type HomeStation,
} from "./tierUi";
import { TimeAgo } from "./TimeAgo";
import { useI18n } from "./LocaleProvider";
import type { TFn } from "@/lib/i18n/translate";

const KEY = "sl_favourites";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener("focus", cb);
  window.addEventListener("sl-favourites", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("focus", cb);
    window.removeEventListener("sl-favourites", cb);
  };
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => (x && typeof x === "object" ? (x as { href?: unknown }).href : null))
      .filter((h): h is string => typeof h === "string");
  } catch {
    return [];
  }
}

function Trend({ t, rateM }: { t: TFn; rateM: number | null }) {
  if (rateM == null) return null;
  if (Math.abs(rateM) < STEADY_M_PER_H) {
    return <Minus className="size-3.5 text-slate-400" aria-label={t("trend.steady")} />;
  }
  return rateM > 0 ? (
    <ArrowUp className="size-3.5 text-orange-600 dark:text-orange-400" aria-label={t("trend.rising")} />
  ) : (
    <ArrowDown className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-label={t("trend.falling")} />
  );
}

export function Favourites({
  stations,
  serverNow,
}: {
  stations: HomeStation[];
  serverNow: number;
}) {
  const { t, p } = useI18n();
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const rows = useMemo(() => {
    const byHref = new Map(stations.map((s) => [s.href, s] as const));
    return parse(raw)
      .map((h) => byHref.get(h))
      .filter((s): s is HomeStation => Boolean(s));
  }, [raw, stations]);

  if (rows.length === 0) return null;

  return (
    <section className="mb-6" aria-labelledby="my-places-heading">
      <h2
        id="my-places-heading"
        className="mb-2 flex items-center gap-1.5 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100"
      >
        <Star className="size-3.5 fill-amber-400 text-amber-500" aria-hidden />
        {t("fav.heading")}
      </h2>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {rows.map((s) => (
          <li key={s.href}>
            <Link
              href={p(s.href)}
              className="group flex items-center gap-3 px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition first:rounded-t-xl last:rounded-b-xl"
            >
              <span
                className={`size-2.5 shrink-0 rounded-full ${TIER_DOT[s.tier]}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {stationDisplayName(s.station)}
                </span>
                <span className={`block truncate text-xs ${TIER_TEXT_CLASS[s.tier]}`}>
                  {tierLabel(t, s.tier)}
                  {s.tier === "stale" && s.ts != null && (
                    <>
                      {" · "}
                      <Clock className="inline size-3 -mt-0.5" aria-hidden />{" "}
                      <TimeAgo ts={s.ts} serverNow={serverNow} short />
                    </>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {formatLevel(s.level, s.unit)}
                {s.tier !== "stale" && <Trend t={t} rateM={s.rate3hM} />}
              </span>
              <ChevronRight className="size-4 shrink-0 text-slate-400 group-hover:text-sky-500 transition" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
