"use client";
// The "Mark your spot" mini survey on its own, for town pages that have no gauge (and so no "Is this right?" card to sit in). Same card, same
// #mark-spot anchor as the one inside AccuracyFeedback, so the "Flooded where you are? Tell us" pill at the top of the page works on every town page.
import { useI18n } from "../LocaleProvider";
import { fbFor } from "@/lib/i18n/feedback";
import { MarkSpot } from "./MarkSpot";

export function SpotCard({ lat, lon, page, target }: { lat: number; lon: number; page: string; target: string }) {
  const { lang } = useI18n();
  return (
    <section id="mark-spot" className="mt-4 scroll-mt-24 rounded-xl border border-2 border-sky-300 bg-sky-50/70 px-4 pb-4 dark:border-sky-800 dark:bg-sky-950/30 [&>div]:mt-0 [&>div]:border-t-0">
      <MarkSpot ft={fbFor(lang)} lang={lang} lat={lat} lon={lon} page={page} target={target} />
    </section>
  );
}
