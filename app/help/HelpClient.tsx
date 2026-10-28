"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MapPin, Phone } from "lucide-react";
import { DISTRICT_BY_STATION } from "@/lib/districts";
import { DISTRICT_CONTACTS, contactsForDistrict } from "@/lib/help";
import { districtNear } from "@/lib/nearby";
import { ForgetLink } from "../NearYou";
import { useLocation } from "../useLocation";
import { useI18n } from "../LocaleProvider";

const districts = Object.keys(DISTRICT_CONTACTS).sort();

function initialDistrict(station: string | null, district: string | null): string {
  if (station && DISTRICT_BY_STATION[station]) return DISTRICT_BY_STATION[station];
  const hit = contactsForDistrict(district);
  return hit ? hit.district : "";
}

function Inner() {
  const { t, p } = useI18n();
  const params = useSearchParams() ?? new URLSearchParams();
  const fromUrl = initialDistrict(params.get("station"), params.get("district"));
  const { loc, forget } = useLocation();
  // Only when the link names no district: the visitor's own, worked out on this device.
  const fromLoc = useMemo(() => {
    const d = !fromUrl && loc ? districtNear(loc) : null;
    return d ? (contactsForDistrict(d)?.district ?? "") : "";
  }, [fromUrl, loc]);
  const [picked, setPicked] = useState<string | null>(null);
  const district = picked ?? (fromUrl || fromLoc);
  const c = contactsForDistrict(district);
  const stations = Object.entries(DISTRICT_BY_STATION)
    .filter(([, d]) => d === district)
    .map(([s]) => s);

  return (
    <section aria-labelledby="district-h" className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="grid place-items-center size-9 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300">
          <MapPin className="size-5" />
        </span>
        <h2 id="district-h" className="text-lg font-semibold tracking-tight">{t("help.district.h")}</h2>
      </div>
      <select
        aria-label={t("help.district.aria")}
        value={district}
        onChange={(e) => setPicked(e.target.value)}
        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-base sm:text-sm"
      >
        <option value="">{t("help.district.choose")}</option>
        {districts.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      {fromLoc && picked == null && (
        <p className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>{t("loc.fromYours")}</span>
          <ForgetLink onClick={forget} />
        </p>
      )}

      {c && (
        <div className="mt-3 space-y-2">
          <CallRow t={t} label={t("help.district.office")} number={c.office} tel={c.tel} />
          <CallRow t={t} label={t("help.district.mobile")} number={c.mobile} tel={`tel:${c.mobile.replace(/[^\d+]/g, "")}`} />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("help.district.note")}
          </p>
          {stations.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("help.district.gauges")}{" "}
              {stations.map((s, i) => (
                <span key={s}>
                  {i > 0 && ", "}
                  <Link href={p(`/?station=${encodeURIComponent(s)}`)} className="underline decoration-slate-400/40 hover:text-sky-700 dark:hover:text-sky-300">
                    {s}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function CallRow({ t, label, number, tel }: { t: (k: "help.district.call") => string; label: string; number: string; tel: string }) {
  return (
    <a
      href={tel}
      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition"
    >
      <span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">{label}</span>
        <span className="block font-medium tabular-nums">{number}</span>
      </span>
      <Phone className="size-5 text-sky-700 dark:text-sky-300" aria-label={t("help.district.call")} />
    </a>
  );
}

export function DistrictPicker() {
  return (
    <Suspense fallback={<div className="h-32 rounded-xl border border-slate-200 dark:border-slate-800" />}>
      <Inner />
    </Suspense>
  );
}
