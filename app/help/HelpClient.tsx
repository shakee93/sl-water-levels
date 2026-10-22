"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MapPin, Phone } from "lucide-react";
import { DISTRICT_BY_STATION } from "@/lib/districts";
import { DISTRICT_CONTACTS, contactsForDistrict } from "@/lib/help";

const districts = Object.keys(DISTRICT_CONTACTS).sort();

function initialDistrict(station: string | null, district: string | null): string {
  if (station && DISTRICT_BY_STATION[station]) return DISTRICT_BY_STATION[station];
  const hit = contactsForDistrict(district);
  return hit ? hit.district : "";
}

function Inner() {
  const params = useSearchParams();
  const fromUrl = initialDistrict(params.get("station"), params.get("district"));
  const [picked, setPicked] = useState<string | null>(null);
  const district = picked ?? fromUrl;
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
        <h2 id="district-h" className="text-lg font-semibold tracking-tight">Your district</h2>
      </div>
      <select
        aria-label="Choose your district"
        value={district}
        onChange={(e) => setPicked(e.target.value)}
        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-base sm:text-sm"
      >
        <option value="">Choose district…</option>
        {districts.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      {c && (
        <div className="mt-3 space-y-2">
          <CallRow label="District DMC office" number={c.office} tel={c.tel} />
          <CallRow label="District DMC mobile" number={c.mobile} tel={`tel:${c.mobile.replace(/[^\d+]/g, "")}`} />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Office-hours unit, not a 24h line. In danger, call 117.
          </p>
          {stations.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              River gauges here:{" "}
              {stations.map((s, i) => (
                <span key={s}>
                  {i > 0 && ", "}
                  <Link href={`/?station=${encodeURIComponent(s)}`} className="underline decoration-slate-400/40 hover:text-sky-700 dark:hover:text-sky-300">
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

function CallRow({ label, number, tel }: { label: string; number: string; tel: string }) {
  return (
    <a
      href={tel}
      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition"
    >
      <span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">{label}</span>
        <span className="block font-medium tabular-nums">{number}</span>
      </span>
      <Phone className="size-5 text-sky-700 dark:text-sky-300" aria-label="Call" />
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
