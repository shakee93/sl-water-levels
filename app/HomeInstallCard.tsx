"use client";

// Home page, next to "Your places": a calm, closable card with the install button. Same state as the floating card in
// ReturnShell (InstallProvider), so closing either hides both for 30 days. Nothing in the installed app.
import { Download, Smartphone, X } from "lucide-react";
import { rtFor } from "@/lib/i18n/return";
import { useI18n } from "./LocaleProvider";
import { useInstall } from "./InstallProvider";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";

export function HomeInstallCard() {
  const { lang } = useI18n();
  const rt = rtFor(lang);
  const { canInstall, cardWanted, install, dismissCard } = useInstall();
  if (!canInstall || !cardWanted) return null;
  return (
    <section lang={lang} aria-label={rt("ins.homeTitle")} className="mb-6 flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-sm">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300">
        <Smartphone className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{rt("ins.homeTitle")}</p>
        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{rt("ins.homeBody")}</p>
        <button type="button" onClick={() => install("home_card")} className={`mt-2 inline-flex min-h-11 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200 ${ring}`}>
          <Download className="size-4" aria-hidden /> {rt("ins.btn")}
        </button>
      </div>
      <button type="button" onClick={dismissCard} aria-label={rt("ins.dismiss")} className={`-m-1.5 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
        <X className="size-4" aria-hidden />
      </button>
    </section>
  );
}
