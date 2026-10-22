// Number / time / name formatting per locale. Latin digits everywhere; month, weekday and
// am/pm words come from the dictionary.
import { RIVERS } from "../places";
import type { Locale } from "./config";
import type { TFn } from "./translate";

const TZ = "Asia/Colombo";
const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short",
  hour: "numeric", minute: "2-digit", hour12: false,
});
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function colomboParts(ts: number) {
  const o: Record<string, string> = {};
  for (const p of parts.formatToParts(new Date(ts))) o[p.type] = p.value;
  return { y: Number(o.year), m: Number(o.month) - 1, d: Number(o.day), wd: WD.indexOf(o.weekday), h24: Number(o.hour) % 24, min: Number(o.minute) };
}

const list = (t: TFn, k: "date.monthsShort" | "date.monthsLong" | "date.weekdaysShort" | "date.monthInitials") => t(k).split(",");
export const monthsShort = (t: TFn) => list(t, "date.monthsShort");
export const monthsLong = (t: TFn) => list(t, "date.monthsLong");
export const monthInitials = (t: TFn) => list(t, "date.monthInitials");

function h12(h24: number) {
  return { h: h24 % 12 === 0 ? 12 : h24 % 12, ap: h24 < 12 ? "date.am" : "date.pm" } as const;
}

/** "2:35 pm" / "ප.ව. 2:35". */
export function clock(ts: number, t: TFn): string {
  const p = colomboParts(ts);
  const { h, ap } = h12(p.h24);
  return t("date.clock", { h, m: String(p.min).padStart(2, "0"), ap: t(ap) });
}
export function hourTick(ts: number, t: TFn): string {
  const { h, ap } = h12(colomboParts(ts).h24);
  return t("date.hour", { h, ap: t(ap) });
}
export function dayTick(ts: number, t: TFn): string {
  const p = colomboParts(ts);
  return t("date.dayTick", { wd: list(t, "date.weekdaysShort")[p.wd], d: p.d });
}
export function fullStamp(ts: number, t: TFn): string {
  const p = colomboParts(ts);
  return t("date.full", { wd: list(t, "date.weekdaysShort")[p.wd], d: p.d, mon: monthsShort(t)[p.m], time: clock(ts, t) });
}
/** "14 Oct, 2:35 pm" in Sri Lanka time. */
export function shortStamp(ts: number, t: TFn): string {
  const p = colomboParts(ts);
  return t("date.shortUpdated", { d: p.d, mon: monthsShort(t)[p.m], time: clock(ts, t) });
}

// ---- ISO calendar days (UTC) ----
const isoMs = (iso: string) => Date.parse(iso + "T00:00:00Z");
export function shortDay(iso: string, t: TFn): string {
  const d = new Date(isoMs(iso));
  return t("date.short", { d: d.getUTCDate(), mon: monthsShort(t)[d.getUTCMonth()] });
}
export function fullDay(iso: string, t: TFn): string {
  const d = new Date(isoMs(iso));
  return t("date.dayFull", { wd: list(t, "date.weekdaysShort")[d.getUTCDay()], d: d.getUTCDate(), mon: monthsShort(t)[d.getUTCMonth()], y: d.getUTCFullYear() });
}
/** "21 Oct – 18 Nov 2023", "28 Nov 2025", "28 Dec 2024 – 3 Jan 2025". */
export function dayRange(from: string, to: string, t: TFn): string {
  const fy = from.slice(0, 4), ty = to.slice(0, 4);
  if (from === to) return `${shortDay(from, t)} ${fy}`;
  if (fy !== ty) return t("date.range", { a: `${shortDay(from, t)} ${fy}`, b: `${shortDay(to, t)} ${ty}` });
  return `${t("date.range", { a: shortDay(from, t), b: shortDay(to, t) })} ${ty}`;
}

// ---- ages and distances ----
export function formatAge(ts: number, now: number, t: TFn, short = false): string {
  const min = Math.max(0, Math.round((now - ts) / 60_000));
  const sfx = short ? "Old" : "";
  if (min < 1) return t("age.now");
  if (min < 60) return t(`age.min${sfx}` as "age.min", { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return t(`age.h${sfx}` as "age.h", { n: h });
  return t(`age.d${sfx}` as "age.d", { n: Math.round(h / 24) });
}

export function formatKmT(km: number, t: TFn): string {
  if (km < 1) return t("unit.under1km");
  return `${km < 10 ? Math.round(km * 10) / 10 : Math.round(km)} ${t("unit.km")}`;
}

// ---- river names ----
const SI = /[඀-෿]/;
const TA = /[஀-௿]/;
/** "Kelani Ganga" on English pages; "Kelani Ganga · කැලණි ගඟ" on Sinhala / Tamil pages when we know the name. */
export function riverName(basin: string, lang: Locale): string {
  const b = basin.trim();
  if (lang === "en") return b;
  const re = lang === "si" ? SI : TA;
  const alias = RIVERS.find((r) => r.basin === b)?.aliases.filter((a) => re.test(a)).sort((x, y) => y.length - x.length)[0];
  return alias ? `${b} · ${alias}` : b;
}
