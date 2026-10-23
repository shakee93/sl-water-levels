"use client";

// Filter chips for the reservoir index. The rows are rendered on the server (so every link is in
// the HTML for search engines) and only hidden here.
import { useState } from "react";

export type FilterItem = { river: string | null; district: string | null; releasing: boolean; node: React.ReactNode; key: string };
export type FilterLabels = { all: string; releasing: string; allDistricts: string; district: string; empty: string };

const chip = (on: boolean) =>
  `inline-flex items-center min-h-9 rounded-full border px-3 text-sm whitespace-nowrap transition ${
    on
      ? "border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950"
      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
  }`;

export function ReservoirFilter({ items, rivers, riverLabels, districts, labels }: { items: FilterItem[]; rivers: string[]; riverLabels: Record<string, string>; districts: string[]; labels: FilterLabels }) {
  const [river, setRiver] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [district, setDistrict] = useState("");
  const shown = items.filter((i) => (!river || i.river === river) && (!releasing || i.releasing) && (!district || i.district === district));
  return (
    <div>
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-2 overflow-x-auto pb-2" role="group">
        <button type="button" className={chip(!river && !releasing)} aria-pressed={!river && !releasing} onClick={() => { setRiver(null); setReleasing(false); }}>{labels.all}</button>
        <button type="button" className={chip(releasing)} aria-pressed={releasing} onClick={() => setReleasing((v) => !v)}>{labels.releasing}</button>
        {rivers.map((r) => (
          <button key={r} type="button" className={chip(river === r)} aria-pressed={river === r} onClick={() => setRiver(river === r ? null : r)}>{riverLabels[r] ?? r}</button>
        ))}
      </div>
      {districts.length > 0 && (
        <select
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          aria-label={labels.district}
          className="mt-1 mb-3 h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-sm text-slate-700 dark:text-slate-300"
        >
          <option value="">{labels.allDistricts}</option>
          {districts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      )}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.key} className="min-w-0" hidden={!shown.includes(i)}>{i.node}</li>
        ))}
      </ul>
      {shown.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400 py-6">{labels.empty}</p>}
    </div>
  );
}
