"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, MapPin } from "lucide-react";
import { NEAR_GAUGE_KM, distanceKm, formatKm, matchLocation, type GaugePoint } from "@/lib/nearby";
import { stationDisplayName } from "@/lib/displayName";
import { ForgetLink } from "./NearYou";
import { useLocation } from "./useLocation";
import { useI18n } from "./LocaleProvider";

/** Station page: a quiet line under the verdict card, only when we know where the visitor is. */
export function StationNearby({ current, gauges }: { current: string; gauges: GaugePoint[] }) {
  const { loc, forget } = useLocation();
  const { t, p } = useI18n();
  const info = useMemo(() => {
    if (!loc) return null;
    const me = gauges.find((g) => g.station === current);
    const km = me ? distanceKm(loc, { lat: me.latitude, lon: me.longitude }) : null;
    const near = matchLocation(loc, gauges);
    const other = near && near.primary.station !== current ? near.primary : null;
    return { km, other };
  }, [loc, gauges, current]);

  if (!info) return null;
  const close = info.km != null && info.km <= NEAR_GAUGE_KM;
  if (!close && !info.other) return null;

  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
      <span className="inline-flex items-center gap-1.5">
        <MapPin className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
        {close && info.km != null ? t("nearby.about", { km: formatKm(info.km, t) }) : t("nearby.notNearest")}
      </span>
      {info.other && (
        <Link
          href={p(info.other.href)}
          className="inline-flex items-center gap-1 min-h-11 sm:min-h-6 text-sky-700 dark:text-sky-300 hover:underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          {t("nearby.yourNearest", { name: stationDisplayName(info.other.station) })}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
      <ForgetLink onClick={forget} className="ml-auto" />
    </p>
  );
}
